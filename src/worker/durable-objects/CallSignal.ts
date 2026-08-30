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
export class CallSignal {
  constructor(
    private ctx: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal: the worker's REST handlers relay through here.
    if (url.pathname === "/broadcast") {
      const payload = await request.text();
      let sent = 0;
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          /* hibernation: the runtime tracks liveness, nothing to prune */
        }
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
      server.send(
        JSON.stringify({ type: "hello", user, participants: this.ctx.getWebSockets().length }),
      );
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
    }

    return new Response("Not found", { status: 404 });
  }
}
