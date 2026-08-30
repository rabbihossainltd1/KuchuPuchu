/**
 * ChatRoom Durable Object — realtime fan-out for one room key.
 *
 * Room keys (the worker decides which room a broadcast targets):
 *   - conversation id  → every open ChatScreen on that conversation
 *   - "user:<userId>"  → that user's chat list / badge channel
 *
 * D1 remains the source of truth. REST handlers write rows exactly as they
 * always did, then hand the resulting event to this object, which pushes it
 * to every live WebSocket. Clients treat events as a trigger to re-sync (or
 * apply the payload directly) — so if the object restarts and sockets drop,
 * nothing is lost: the next REST sync heals the state.
 *
 * HIBERNATION: sockets are accepted via ctx.acceptWebSocket() (tagged with
 * the verified user id), not server.accept(). The object then sleeps while
 * connections stay open server-side — a chat screen left open for an hour
 * costs zero active duration instead of an hour of GB-s billing. /broadcast
 * wakes the object, getWebSockets() fans the frame out, done.
 *
 * Wire format: one JSON string per frame. The worker only ever sends
 * {"type": "hello"|"message"|"typing"|"read"|"conv", ...}; clients send
 * nothing (receive-only), so no client can spoof events into a room — only
 * the worker's /broadcast endpoint can.
 */
export class ChatRoom {
  constructor(
    private ctx: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal: the worker's REST handlers fan events out through here.
    if (url.pathname === "/broadcast") {
      const payload = await request.text();
      let sent = 0;
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          /* the runtime reaps dead sockets; nothing to clean up by hand */
        }
      }
      return Response.json({ ok: true, sent });
    }

    // Client upgrade. The worker route has ALREADY authenticated the token
    // and verified conversation membership before forwarding here — the
    // x-kp-user header is trusted input from our own worker, never the client.
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
        JSON.stringify({ type: "hello", user, listeners: this.ctx.getWebSockets().length }),
      );
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
    }

    return new Response("Not found", { status: 404 });
  }
}
