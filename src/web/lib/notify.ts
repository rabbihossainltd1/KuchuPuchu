import { Capacitor } from "@capacitor/core";

export type NotifKind =
  "messaging" | "calls" | "requests" | "likes" | "comments" | "follow" | "gifting" | "wallet";

const KEY = "kp_notif_prefs";

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

export async function askNotifyPermission() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.requestPermissions();
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
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 100000,
            title,
            body,
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
