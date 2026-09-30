// r104 (web client): the socket routes accept the session token as ?token=
// because a browser WebSocket cannot set request headers (OkHttp can, and the
// Android app keeps using the header). The fallback is scoped to /ws/* ONLY —
// a REST route must never authenticate from the URL (tokens must not ride
// access logs). A fake CHAT_ROOM namespace answers the upgrade the way
// case 09 does, so the assertions run through the real worker route table.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const upgrades = [];
  const env = {
    DB: db,
    MEDIA: makeR2(),
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    CHAT_ROOM: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async (urlOrReq, init) => {
          const req = urlOrReq instanceof Request ? urlOrReq : null;
          upgrades.push({
            room: id.name,
            url: String(req ? req.url : urlOrReq),
            user: req ? req.headers.get("x-kp-user") : init?.headers?.["x-kp-user"],
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }),
    },
  };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token, tokenInQuery) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.7.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token && !tokenInQuery) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const p = tokenInQuery
      ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : path;
    const res = await worker.fetch(new Request(`https://kp.test${p}`, init), env, ctx);
    const text = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    return { status: res.status, json: j };
  };
  const reg = makeReg(call);
  return { db, call, reg, upgrades };
}

{
  const k = await mk();
  const a = await k.reg("r104a@x.com", "r104a");
  const b = await k.reg("r104b@x.com", "r104b");
  const outsider = await k.reg("r104c@x.com", "r104c");

  // ---- the Android path is untouched: header auth on the socket route ----
  const hdr = await k.call("GET", "/ws/user", undefined, a.token);
  check("ws/user with Authorization header still passes", hdr.status === 200, String(hdr.status));

  // ---- the browser path: the same token as ?token= on /ws/* ----
  const q = await k.call("GET", "/ws/user", undefined, a.token, true);
  check("ws/user with ?token= passes (browser path)", q.status === 200, String(q.status));
  check(
    "the upgrade reached the user's own room",
    k.upgrades.some((u) => u.room === `user:${a.user.id}` && u.user === a.user.id),
    JSON.stringify(k.upgrades.map((u) => u.room)),
  );

  // ---- and it is a real session check, not a bypass ----
  const bogus = await k.call("GET", "/ws/user", undefined, "not-a-real-token", true);
  check("ws/user with a bogus ?token= is 401", bogus.status === 401, String(bogus.status));
  const none = await k.call("GET", "/ws/user", undefined);
  check("ws/user with no token at all is 401", none.status === 401, String(none.status));

  // ---- the chat socket: membership still gates the query-token path ----
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;
  const member = await k.call("GET", `/ws/chat/${cid}`, undefined, a.token, true);
  check(
    "ws/chat/<id> with ?token= passes for a member",
    member.status === 200,
    String(member.status),
  );
  check(
    "the chat upgrade carries the member's id",
    k.upgrades.some((u) => u.room === cid && u.user === a.user.id),
  );
  const stranger = await k.call("GET", `/ws/chat/${cid}`, undefined, outsider.token, true);
  check(
    "ws/chat/<id> with ?token= still refuses a non-member",
    stranger.status === 403 || stranger.status === 404,
    String(stranger.status),
  );

  // ---- REST stays header-only: a token in the URL of an API route is inert ----
  const leak = await k.call("GET", "/api/me", undefined, a.token, true);
  check(
    "api/me with ?token= and no header is 401 (no URL auth on REST)",
    leak.status === 401,
    String(leak.status),
  );
  const ok = await k.call("GET", "/api/me", undefined, a.token);
  check("api/me with the header still works", ok.status === 200, String(ok.status));
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`case 48: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);
