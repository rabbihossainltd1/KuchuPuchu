import { Capacitor } from "@capacitor/core";

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
    sound: "default",
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

export async function pingOs(kind: NotifKind, title: string, body: string) {
  if (!getNotifPrefs()[kind]) return;
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return;
      await ensureChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 100000,
            title,
            body,
            channelId: "kp",
            extra: { kind },
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
