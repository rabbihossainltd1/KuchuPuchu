/**
 * Per-socket liveness that SURVIVES hibernation (owner round 31, item 22).
 *
 * Both Durable Objects use hibernatable WebSockets: the object is removed from
 * memory ~10 s after its last event and EVERY in-memory field is discarded —
 * the constructor runs again on the next event. `lastSeen` used to be a plain
 * `Map` field, so a /broadcast that woke a hibernated object saw an empty map,
 * classified every socket as stale (> STALE_MS) and delivered to NONE of them:
 * `sent: 0`. The worker then took the "no live process" branch — a system
 * notification payload (plain OS card, no Reply / Like / Mark-as-read) instead
 * of the app's own card, no realtime frame for the open chat, no in-app tone —
 * for roughly every other message, because a socket heartbeats every 20 s and
 * the object hibernates 10 s after each one. That is the "message notification
 * e reply option nei" report, and a good part of the realtime flakiness.
 *
 * The attachment API is the runtime's own per-socket storage: it lives exactly
 * as long as the socket does, through any number of hibernations (16 KB cap —
 * ours is one number), and is readable from a freshly constructed instance.
 */
export const STALE_MS = 45_000;

type Attachment = { seen?: number };

/** Records "this socket sent a data frame now" — called on connect + every heartbeat. */
export function markSeen(ws: WebSocket) {
  ws.serializeAttachment({ seen: Date.now() } satisfies Attachment);
}

/** Epoch millis of the socket's last inbound data frame; 0 when it never sent one. */
export function seenAt(ws: WebSocket): number {
  try {
    const att = ws.deserializeAttachment() as Attachment | null | undefined;
    const seen = att && typeof att === "object" ? att.seen : undefined;
    return typeof seen === "number" && Number.isFinite(seen) ? seen : 0;
  } catch {
    return 0;
  }
}

/** Alive = heartbeated within STALE_MS (the client heartbeats every 20 s). */
export function isLive(ws: WebSocket, now: number = Date.now()): boolean {
  return seenAt(ws) >= now - STALE_MS;
}
