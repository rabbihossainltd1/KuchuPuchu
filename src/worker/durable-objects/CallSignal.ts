/**
 * CallSignal Durable Object — WebRTC signalling relay for one call id
 * (CALL_SIGNAL.idFromName(callId)). Holds the caller's and callee's live
 * WebSocket connections and relays, the instant the REST handlers write them:
 *
 *   - Ringing → Active → Ended/Declined/Missed state changes
 *   - ICE candidate exchange
 *   - Reoffer/reanswer (screen share, camera-on renegotiation)
 *
 * Media never passes through here — audio/video stays peer-to-peer via
 * WebRTC exactly as before. D1 stays the source of truth; every state change
 * is written by the REST route FIRST, then mirrored to this object. Clients
 * treat the frames as a trigger to run their existing sync logic, so a
 * dropped socket degrades cleanly to polling.
 *
 * HIBERNATION: ctx.acceptWebSocket() (tagged with the verified participant
 * id) keeps the object asleep between frames — a connected call with quiet
 * signalling costs no active duration. /broadcast wakes it and
 * getWebSockets() fans the frame to both participants.
 *
 * Wire format: one JSON string per frame, sent by the worker only — the
 * sockets are receive-only, so neither party can spoof signalling into the
 * other's connection.
 */
const STALE_MS = 45_000;

export class CallSignal {
  /**
   * lastSeen: WebSocket -> last inbound data-frame timestamp (same heartbeat
   * liveness contract as ChatRoom). Only sockets that heartbeated within
   * STALE_MS count as alive, so a frozen/killed participant's half-open socket
   * does not make the worker think signalling was delivered when it never will be.
   */
  private lastSeen = new Map<WebSocket, number>();

  constructor(
    private ctx: DurableObjectState,
    _env: unknown,
  ) {}

  /** Called by the runtime for every inbound data frame on a hibernatable socket. */
  async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer) {
    this.lastSeen.set(ws, Date.now());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal: the worker's REST handlers relay through here.
    if (url.pathname === "/broadcast") {
      const payload = await request.text();
      let sent = 0;
      const now = Date.now();
      const live = this.ctx.getWebSockets();
      for (const ws of live) {
        if ((this.lastSeen.get(ws) ?? 0) < now - STALE_MS) continue;
        try {
          ws.send(payload);
          sent++;
        } catch {
          /* hibernation: the runtime tracks liveness, nothing to prune */
        }
      }
      // Prune closed-socket entries so the map stays bounded.
      if (this.lastSeen.size > live.length) {
        const keep = new Set(live);
        for (const ws of this.lastSeen.keys()) if (!keep.has(ws)) this.lastSeen.delete(ws);
      }
      return Response.json({ ok: true, sent });
    }

    // Participant upgrade. The worker route has ALREADY authenticated the
    // token and verified the socket's user is the caller or the callee.
    if (url.pathname === "/connect") {
      if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const user = request.headers.get("x-kp-user") ?? "anon";
      this.ctx.acceptWebSocket(server, [`user:${user}`]);
      this.lastSeen.set(server, Date.now());
      server.send(
        JSON.stringify({ type: "hello", user, participants: this.ctx.getWebSockets().length }),
      );
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
    }

    return new Response("Not found", { status: 404 });
  }
}
