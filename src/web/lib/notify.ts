import { Capacitor } from "@capacitor/core";
import { api } from "./api";

export type NotifKind =
  "messaging" | "calls" | "requests" | "likes" | "comments" | "follow" | "gifting" | "wallet";

const KEY = "kp_notif_prefs";
const KINDS: NotifKind[] = [
  "messaging",
  "calls",
  "requests",
  "likes",
  "comments",
  "follow",
  "gifting",
  "wallet",
];

export function getNotifPrefs(): Record<NotifKind, boolean> {
  const fallback = {
    messaging: true,
    calls: true,
    requests: true,
    likes: true,
    comments: true,
    follow: true,
    gifting: true,
    wallet: true,
  };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as object) };
  } catch {
    return fallback;
  }
}

export function setNotifPrefs(next: Record<NotifKind, boolean>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function inferKind(note: {
  kind?: string | null;
  title?: string;
  link?: string;
}): NotifKind {
  if (note.kind && KINDS.includes(note.kind as NotifKind)) return note.kind as NotifKind;
  const blob = `${note.title ?? ""} ${note.link ?? ""}`.toLowerCase();
  if (blob.includes("like")) return "likes";
  if (blob.includes("comment")) return "comments";
  if (blob.includes("follow")) return "follow";
  if (blob.includes("gift")) return "gifting";
  if (blob.includes("call")) return "calls";
  if (blob.includes("wallet") || blob.includes("coin")) return "wallet";
  if (blob.includes("request") || blob.includes("duo") || blob.includes("/requests"))
    return "requests";
  return "messaging";
}

export function notifIdFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 90000) + 1000;
}

async function ensureChannel() {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.createChannel({
    id: "kp",
    name: "KuchuPuchu",
    description: "Messages, calls, and requests",
    importance: 5,
    visibility: 1,
    vibration: true,
    sound: "kp_notify",
  }).catch(() => undefined);
  await LocalNotifications.createChannel({
    id: "kp-calls",
    name: "KuchuPuchu calls",
    description: "Incoming calls",
    importance: 5,
    visibility: 1,
    vibration: true,
    sound: "kp_notify",
  }).catch(() => undefined);
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: "KP_CALL",
        actions: [
          { id: "accept", title: "Accept" },
          { id: "decline", title: "Decline", destructive: true },
        ],
      },
      {
        id: "KP_MSG",
        actions: [{ id: "reply", title: "Reply", input: true }],
      },
    ],
  }).catch(() => undefined);
}

export async function askNotifyPermission() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.requestPermissions();
      await ensureChannel();
      return;
    }
  } catch {
    /* plugin optional */
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => "denied");
  }
}

export type PingExtra = {
  link?: string;
  callId?: string;
  convId?: string;
};

export async function cancelOs(id: number) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    /* ignore */
  }
}

export async function cancelCallOs(callId: string) {
  await cancelOs(notifIdFor(`call-${callId}`));
}

export async function pingOs(kind: NotifKind, title: string, body: string, extra: PingExtra = {}) {
  if (!getNotifPrefs()[kind]) return;
  if (kind !== "calls") {
    try {
      const chime = new Audio("/sounds/notify.wav");
      chime.volume = 0.7;
      void chime.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return;
      await ensureChannel();
      const isCall = kind === "calls";
      const id = extra.callId
        ? notifIdFor(`call-${extra.callId}`)
        : extra.convId
          ? notifIdFor(`msg-${extra.convId}-${Date.now()}`)
          : Date.now() % 100000;
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            channelId: isCall ? "kp-calls" : "kp",
            sound: "kp_notify",
            actionTypeId: isCall ? "KP_CALL" : kind === "messaging" ? "KP_MSG" : undefined,
            extra: { kind, ...extra },
            autoCancel: true,
          },
        ],
      });
      return;
    }
  } catch {
    /* fall through */
  }
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default")
    await Notification.requestPermission().catch(() => "denied");
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: `kp-${kind}` });
    } catch {
      /* unsupported */
    }
  }
}

function extraOf(event: {
  notification?: { extra?: PingExtra & { kind?: string }; inputValue?: string };
  inputValue?: string;
}) {
  return (event.notification?.extra ?? {}) as PingExtra & { kind?: string };
}

function replyText(event: {
  inputValue?: string;
  notification?: { inputValue?: string; extra?: { inputValue?: string } };
}) {
  return String(
    event.inputValue ||
      event.notification?.inputValue ||
      event.notification?.extra?.inputValue ||
      "",
  ).trim();
}

let listening = false;

export async function listenNotifyActions() {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  if (listening) return () => undefined;
  listening = true;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      const extra = extraOf(event);
      const action = String(event.actionId || "").toLowerCase();
      if (action === "accept") {
        window.KpCallBridge?.answerFromNotify?.(String(extra.callId ?? ""));
        return;
      }
      if (action === "decline") {
        window.KpCallBridge?.declineFromNotify?.(String(extra.callId ?? ""));
        return;
      }
      if (action === "reply") {
        const convId = extra.convId || extra.link?.replace("/messages/", "");
        const text = replyText(event);
        if (convId && text) {
          void api(`/api/conversations/${convId}/messages`, {
            method: "POST",
            body: JSON.stringify({ body: text }),
          }).catch(() => undefined);
        }
      }
    });
    return () => undefined;
  } catch {
    listening = false;
    return () => undefined;
  }
}

declare global {
  interface Window {
    KpCallBridge?: {
      answerFromNotify?: (callId: string) => void;
      declineFromNotify?: (callId: string) => void;
    };
  }
}
