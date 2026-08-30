/**
 * CallSignal Durable Object — WebRTC signalling relay for one call id
 * (CALL_SIGNAL.idFromName(callId)). Holds the caller's and callee's live
 * WebSocket connections and relays ringing/answered/ended state changes,
 * ICE candidates and renegotiation offers the instant the REST handlers
 * write them, replacing the 500ms-4s /api/calls polling. Media never passes
 * through here — audio/video stays peer-to-peer via WebRTC exactly as today.
 *
 * The class body lands in Step 3; this skeleton keeps the wrangler binding
 * and migration resolvable. Signalling endpoints are unchanged in the
 * meantime — the app keeps polling them.
 */
export class CallSignal {
  constructor(_ctx: unknown, _env: unknown) {}

  async fetch(): Promise<Response> {
    return new Response("CallSignal: realtime layer not enabled yet", { status: 503 });
  }
}
