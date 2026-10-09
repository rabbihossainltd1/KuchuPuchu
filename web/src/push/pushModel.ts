/**
 * The Web Push model (slice H): every rule and every line of copy the browser
 * doorbell owns, DOM-free so the contract case can pin them against the Worker
 * and the service worker.
 *
 * The privacy stance is the whole reason this module exists: a web push is a
 * GENERIC doorbell. The Worker's payload carries a type and nothing else (see
 * `webPushToUser` in `src/worker/index.ts`), so the notification the service
 * worker shows can never quote a message, name a sender or open a chat on its
 * own — it can only knock, and then let the authenticated app fetch whatever
 * it is allowed to show. Every string below is written to stay honest about
 * exactly that.
 */

export const PUSH_KINDS = ["kp.msg", "kp.call"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** The decoded push payload: a kind, and `silent` for a muted-chat knock. */
export type PushPayload = {
  readonly kind: PushKind;
  readonly silent: boolean;
};

/**
 * Parse the wire payload. Anything that is not one of the two known kinds is
 * treated as a message knock — a doorbell that mislabels itself is still a
 * doorbell, and dropping it would lose the wake-up entirely.
 */
export function parsePushPayload(raw: unknown): PushPayload {
  const data = (raw ?? {}) as Record<string, unknown>;
  const kind: PushKind = data.t === "kp.call" ? "kp.call" : "kp.msg";
  return { kind, silent: data.s === 1 };
}

/**
 * Where a notification click lands. The calls doorbell opens the Calls tab
 * ONLY in a build where calls are switched on; everywhere else every knock
 * opens the chat list, because there is no call surface to land in.
 */
export function pushTargetSection(kind: PushKind, callsEnabled: boolean): "chats" | "calls" {
  return kind === "kp.call" && callsEnabled ? "calls" : "chats";
}

/**
 * The notification the service worker shows. The title is the app name and the
 * body names the KIND of activity, never its content — the payload this worker
 * receives cannot carry content in the first place (contract case 77 proves
 * it), and these strings make that limit visible instead of pretending.
 */
export function pushNotificationCopy(kind: PushKind): { title: string; body: string } {
  return {
    title: "KuchuPuchu",
    body:
      kind === "kp.call"
        ? "Call activity on KuchuPuchu — open the app to check."
        : "New message activity on KuchuPuchu — open the app to check.",
  };
}

/** The notification's `tag`: one live card per kind, replaced not stacked. */
export function pushNotificationTag(kind: PushKind): string {
  return kind === "kp.call" ? "kp-call" : "kp-msg";
}

/**
 * Capability read. Split into named booleans so the settings screen can say
 * WHICH piece is missing instead of a shrug; `supported` is the AND of them.
 */
export type PushRuntimeCapability = {
  readonly serviceWorker: boolean;
  readonly pushManager: boolean;
  readonly notification: boolean;
  readonly supported: boolean;
};

export function pushRuntimeCapability(scope: {
  serviceWorker?: unknown;
  PushManager?: unknown;
  Notification?: unknown;
}): PushRuntimeCapability {
  const serviceWorker = typeof scope.serviceWorker === "object" && scope.serviceWorker !== null;
  const pushManager = typeof scope.PushManager === "function";
  const notification = typeof scope.Notification === "function";
  return {
    serviceWorker,
    pushManager,
    notification,
    supported: serviceWorker && pushManager && notification,
  };
}

/** The settings-screen copy. Each line is a fact, not a promise. */
export const PUSH_COPY = Object.freeze({
  heading: "Notifications",
  eyebrow: "WEB PUSH",
  /** Shown when the browser itself cannot do push at all. */
  unsupportedBrowser:
    "This browser does not offer the Web Push building blocks (service worker, PushManager or Notification API), so notifications cannot be turned on here.",
  /** Shown when the server has no VAPID key configured. */
  unsupportedServer:
    "Notifications are not configured on this server yet. Nothing to turn on — check back later.",
  /** Shown when the user said no to the browser permission. */
  permissionDenied:
    "Notification permission is blocked in this browser. Allow notifications for this site in the browser's own settings, then try again.",
  optIn: "Turn on notifications",
  optInBusy: "Turning on…",
  optOut: "Turn off",
  optOutBusy: "Turning off…",
  on: "Notifications are on for this browser.",
  /** The privacy line: the doorbell never carries message content. */
  privacy:
    "A notification here is only a doorbell: it never includes message text, sender names or photos. Opening it loads the actual content through your signed-in session.",
  /** Delivery honesty, straight from the parity plan (§3). */
  delivery:
    "Delivery is best-effort — a browser may be throttled or closed, and a knock can arrive late or not at all. The phone's FCM notifications remain the reliable path.",
  /** A muted chat still updates, silently. */
  muted: "Chats you mute for messages still update here — silently, without a sound.",
  errorGeneric: "That did not work. Check your connection and try again.",
  thisBrowser: "This browser",
  addedAt: "Added",
});
