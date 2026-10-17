const MAX_PARTICIPANTS = 6;
const USER_HEADER = "x-kp-user";

type SignalFrame =
  | { type: "join" }
  | { type: "heartbeat" }
  | { type: "offer" | "answer"; to: string; sdp: string }
  | { type: "candidate"; to: string; candidate: unknown };

type SocketAttachment = { userId: string };

/** Signalling only. Classroom audio/video never enters this Durable Object. */
export class ClassroomSignal {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    const userId = request.headers.get(USER_HEADER)?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return new Response("Forbidden", { status: 403 });

    const current = this.liveUsers();
    if (!current.has(userId) && current.size >= MAX_PARTICIPANTS)
      return new Response("Class full", { status: 409 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies SocketAttachment);
    server.send(JSON.stringify({ type: "roster", participants: [...current] }));
    this.broadcast({ type: "peer-joined", participant: userId }, userId);
    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || typeof raw !== "string" || raw.length > 64_000)
      return socket.close(1008, "Invalid frame");
    let frame: SignalFrame;
    try {
      frame = JSON.parse(raw) as SignalFrame;
    } catch {
      return socket.close(1008, "Invalid JSON");
    }
    if (frame.type === "heartbeat") return socket.send(JSON.stringify({ type: "heartbeat" }));
    if (frame.type === "join") return;
    if (!(frame.type === "offer" || frame.type === "answer" || frame.type === "candidate"))
      return socket.close(1008, "Unknown frame");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(frame.to)) return socket.close(1008, "Invalid peer");
    if (
      (frame.type === "offer" || frame.type === "answer") &&
      (typeof frame.sdp !== "string" || frame.sdp.length > 60_000)
    )
      return socket.close(1008, "Invalid SDP");
    const payload = { ...frame, from: attachment.userId };
    let delivered = false;
    for (const peer of this.state.getWebSockets()) {
      const target = peer.deserializeAttachment() as SocketAttachment | null;
      if (target?.userId === frame.to) {
        peer.send(JSON.stringify(payload));
        delivered = true;
      }
    }
    if (!delivered)
      socket.send(JSON.stringify({ type: "peer-unavailable", participant: frame.to }));
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const stillConnected = this.state.getWebSockets().some((peer) => {
      if (peer === socket) return false;
      return (
        (peer.deserializeAttachment() as SocketAttachment | null)?.userId === attachment.userId
      );
    });
    if (!stillConnected)
      this.broadcast({ type: "peer-left", participant: attachment.userId }, attachment.userId);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  private liveUsers(): Set<string> {
    const users = new Set<string>();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userId) users.add(attachment.userId);
    }
    return users;
  }

  private broadcast(payload: unknown, except = ""): void {
    const text = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userId !== except) socket.send(text);
    }
  }
}
