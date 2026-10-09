// Plan §7.2: the browser must never carry its long-lived session token in a
// URL. POST /api/ws/ticket mints a 60-second HMAC ticket bound to the caller,
// and `/ws/*` spends it exactly once. These checks drive the REAL worker
// (auth, expiry, replay, tampering, REST boundary) — the plan made them a
// ship condition for the ticket route.

import { createHmac } from "node:crypto";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const TICKET_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");

function fakeChatRoom() {
  const calls = [];
  return {
    calls,
    binding: {
      idFromName: (name) => ({ toString: () => name }),
      get: () => ({
        fetch: async (req) => {
          calls.push(`${new URL(req.url).pathname}|${req.headers.get("x-kp-user") ?? ""}`);
          return new Response(null, { status: 204 });
        },
      }),
    },
  };
}

async function mk({ withKey = true } = {}) {
  const worker = await freshWorker();
  const db = makeD1();
  const room = fakeChatRoom();
  const env = {
    DB: db,
    MEDIA: makeR2(),
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    CHAT_ROOM: room.binding,
    ...(withKey ? { WS_TICKET_KEY: TICKET_KEY } : {}),
  };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `198.51.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 80) };
    }
    return { status: res.status, json: j };
  };
  // Exactly how a browser opens a socket: NO Authorization header, credential
  // rides the URL (ticket today, legacy token in the fallback check below).
  const openSocket = (path) =>
    worker.fetch(
      new Request(`https://kp.test${path}`, { headers: { upgrade: "websocket" } }),
      env,
      ctx,
    );
  const reg = makeReg(call);
  return { db, env, call, openSocket, reg, room };
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A ticket signed with the WRONG key, same wire shape. */
function forgedTicket(uid) {
  const payload = JSON.stringify({ a: uid, e: Date.now() + 60_000, j: "f".repeat(32) });
  const message = b64url(payload);
  const sig = createHmac("sha256", Buffer.alloc(32, 7)).update(message).digest("base64url");
  return `${message}.${sig}`;
}

// ---- 1. mint: header-auth only, one-time ticket with a 60 s budget ----
{
  const k = await mk();
  const a = await k.reg("ta@x.com", "ta");
  const anon = await k.call("POST", "/api/ws/ticket");
  check("minting a ticket without a session is refused", anon.status === 401, String(anon.status));
  const minted = await k.call("POST", "/api/ws/ticket", {}, a.token);
  check("a signed-in session mints a ticket", minted.status === 200, String(minted.status));
  check("the ticket is payload.signature", /^[^.]+\.[^.]+$/.test(String(minted.json.ticket ?? "")));
  check("the budget is 60 seconds", minted.json.expiresIn === 60, String(minted.json.expiresIn));
  const payload = JSON.parse(
    Buffer.from(String(minted.json.ticket).split(".")[0], "base64url").toString("utf8"),
  );
  check("the ticket is bound to the caller", payload.a === a.user.id, payload.a);
  check(
    "the expiry rides inside the signed payload",
    typeof payload.e === "number" && payload.e > Date.now(),
  );
}

// ---- 2. spend: one ticket opens the socket, replay dies ----
{
  const k = await mk();
  const a = await k.reg("tb@x.com", "tb");
  const minted = await k.call("POST", "/api/ws/ticket", {}, a.token);
  const ticket = String(minted.json.ticket);

  const open1 = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(ticket)}`);
  check(
    "the ticket opens the user socket",
    open1.status !== 401 && open1.status !== 403,
    String(open1.status),
  );
  check(
    "the socket is bound to the ticket's account",
    k.room.calls.length === 1 && k.room.calls[0] === `/connect|${a.user.id}`,
    JSON.stringify(k.room.calls),
  );
  const spent = k.db._db
    .prepare("SELECT COUNT(*) n FROM ws_tickets WHERE user_id = ?")
    .get(a.user.id).n;
  check("spending the ticket is recorded in the ledger", spent === 1, String(spent));

  const replay = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(ticket)}`);
  check("a replayed ticket is refused", replay.status === 401, String(replay.status));
  check(
    "the replay never reached the room",
    k.room.calls.length === 1,
    String(k.room.calls.length),
  );
}

// ---- 3. tamper and forgery die closed ----
{
  const k = await mk();
  const a = await k.reg("tc@x.com", "tc");
  const ticket = String((await k.call("POST", "/api/ws/ticket", {}, a.token)).json.ticket);

  const [message, sig] = ticket.split(".");
  const payload = JSON.parse(Buffer.from(message, "base64url").toString("utf8"));
  payload.e = Date.now() + 86_400_000; // smuggle a longer budget
  const tampered = `${b64url(JSON.stringify(payload))}.${sig}`;
  const res = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(tampered)}`);
  check("a tampered payload is refused", res.status === 401, String(res.status));

  const forged = forgedTicket(a.user.id);
  const res2 = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(forged)}`);
  check("a foreign-key signature is refused", res2.status === 401, String(res2.status));

  const garbage = await k.openSocket(`/ws/user?ticket=${encodeURIComponent("not-a-ticket")}`);
  check("garbage is refused", garbage.status === 401, String(garbage.status));
  check(
    "nothing forged ever reached the room",
    k.room.calls.length === 0,
    String(k.room.calls.length),
  );
}

// ---- 4. the 60-second budget is real ----
{
  const k = await mk();
  const a = await k.reg("td@x.com", "td");
  const ticket = String((await k.call("POST", "/api/ws/ticket", {}, a.token)).json.ticket);

  const realNow = Date.now;
  Date.now = () => realNow() + 61_000; // just past the budget
  try {
    const late = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(ticket)}`);
    check("an expired ticket is refused", late.status === 401, String(late.status));
  } finally {
    Date.now = realNow;
  }
  check(
    "the expired ticket never reached the room",
    k.room.calls.length === 0,
    String(k.room.calls.length),
  );
}

// ---- 5. tickets open sockets ONLY — REST stays header-disciplined ----
{
  const k = await mk();
  const a = await k.reg("te@x.com", "te");
  const ticket = String((await k.call("POST", "/api/ws/ticket", {}, a.token)).json.ticket);

  const rest = await k.call("GET", `/api/me?ticket=${encodeURIComponent(ticket)}`);
  check("a ticket never authenticates a REST route", rest.status === 401, String(rest.status));

  const open = await k.openSocket(`/ws/user?ticket=${encodeURIComponent(ticket)}`);
  check("the REST probe did not spend the ticket", open.status !== 401, String(open.status));
}

// ---- 6. the legacy query-token fallback keeps working ----
{
  const k = await mk();
  const a = await k.reg("tf@x.com", "tf");
  const legacy = await k.openSocket(`/ws/user?token=${encodeURIComponent(a.token)}`);
  check(
    "the legacy ?token= path still opens the socket",
    legacy.status !== 401,
    String(legacy.status),
  );
  check(
    "the legacy path binds the same account",
    k.room.calls[0] === `/connect|${a.user.id}`,
    JSON.stringify(k.room.calls),
  );
  const bare = await k.openSocket("/ws/user");
  check("no credential at all is still refused", bare.status === 401, String(bare.status));
}

// ---- 7. the spent ledger purges itself ----
{
  const k = await mk();
  const a = await k.reg("tg@x.com", "tg");
  k.db._db
    .prepare("INSERT INTO ws_tickets (jti, user_id, expires_at) VALUES (?, ?, ?)")
    .run("0".repeat(32), "ghost", Date.now() - 120_000);
  const ticket = String((await k.call("POST", "/api/ws/ticket", {}, a.token)).json.ticket);
  await k.openSocket(`/ws/user?ticket=${encodeURIComponent(ticket)}`);
  const ghosts = k.db._db
    .prepare("SELECT COUNT(*) n FROM ws_tickets WHERE user_id = 'ghost'")
    .get().n;
  check("the lazy purge removes dead tickets on spend", ghosts === 0, String(ghosts));
}

// ---- 8. fail-closed when the key is not provisioned ----
{
  const k = await mk({ withKey: false });
  const a = await k.reg("th@x.com", "th");
  const minted = await k.call("POST", "/api/ws/ticket", {}, a.token);
  check("without a key the ticket route answers 503", minted.status === 503, String(minted.status));
}

console.log(`Case 80 — WS tickets (plan §7.2)`);
for (const l of lines) console.log(l);
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`  ${lines.length - broken}/${lines.length} checks passed`);
if (broken > 0) process.exitCode = 1;
