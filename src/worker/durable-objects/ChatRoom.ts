/**
 * ChatRoom Durable Object — realtime fan-out for one room key.
 *
 * One object per conversation id (CHAT_ROOM.idFromName(convId)) and per user
 * list channel (CHAT_ROOM.idFromName("user:<userId>")). The class body lands
 * in Step 2 (WebSocket upgrade + broadcast); this skeleton exists so the
 * wrangler binding and migration in wrangler.toml resolve to a real export.
 * No REST behavior depends on it: without a live socket nothing is sent, and
 * the worker's broadcast helper no-ops unless the binding is present.
 */
export class ChatRoom {
  constructor(_ctx: unknown, _env: unknown) {}

  async fetch(): Promise<Response> {
    return new Response("ChatRoom: realtime layer not enabled yet", { status: 503 });
  }
}
