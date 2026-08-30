// Realtime broadcast wiring (Step 2). The worker hands events to the
// CHAT_ROOM Durable Object after the REST write lands. The DO itself runs
// only on Cloudflare; here a fake namespace records everything the worker
// would have forwarded, so the wiring, the event shapes and the "no binding
// => plain REST" fallback are all asserted against the real worker code.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk(withDo) {
  const worker = await freshWorker();
  const db = makeD1();
  const broadcasts = [];
  const env = { DB: db, MEDIA: makeR2() };
  if (withDo) {
    env.CHAT_ROOM = {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async (url, init) => {
          broadcasts.push({ room: id.name, url: String(url), body: JSON.parse(init.body) });
          return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200 });
        },
      }),
    };
  }
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/register"))
      headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
  const reg = async (e, u) => {
    const r = await call("POST", "/api/auth/register", {
      email: e,
      password: "secret123",
      username: u,
      displayName: u,
    });
    if (!r.json.user) throw new Error(`register ${u} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  return { db, call, reg, broadcasts };
}

// ---- 1. a send broadcasts message + pokes the other member's list channel ----
{
  const k = await mk(true);
  const a = await k.reg("rt1a@x.com", "rt1a");
  const b = await k.reg("rt1b@x.com", "rt1b");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;

  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "hello realtime", clientId: "rt-1" },
    a.token,
  );
  check("send still succeeds with DO present", sent.status === 201, String(sent.status));

  const msgEv = k.broadcasts.find(
    (x) => x.body.type === "message" && x.body.conversationId === cid,
  );
  check(
    "message event went to the conversation room",
    !!msgEv && msgEv.url.includes("broadcast"),
    JSON.stringify(k.broadcasts.map((x) => x.body.type)),
  );
  check(
    "message event carries the full message the REST route returns",
    msgEv && msgEv.body.message.body === "hello realtime" && msgEv.body.message.clientId === "rt-1",
    msgEv ? JSON.stringify(msgEv.body.message).slice(0, 120) : "none",
  );
  check(
    "the OTHER member's list channel got a conv poke",
    k.broadcasts.some((x) => x.body.type === "conv" && x.room === "user:" + b.user.id),
    JSON.stringify(k.broadcasts.filter((x) => x.body.type === "conv").map((x) => x.url)),
  );
  check(
    "the SENDER did not get a list poke for their own send",
    !k.broadcasts.some((x) => x.body.type === "conv" && x.room === "user:" + a.user.id),
  );
}

// ---- 2. typing and read broadcast on their rooms ----
{
  const k = await mk(true);
  const a = await k.reg("rt2a@x.com", "rt2a");
  const b = await k.reg("rt2b@x.com", "rt2b");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;

  await k.call("POST", `/api/conversations/${cid}/typing`, {}, a.token);
  const typ = k.broadcasts.find((x) => x.body.type === "typing");
  check(
    "typing event has userId + timestamp",
    typ && typ.body.userId === a.user.id && !!typ.body.at,
    typ ? JSON.stringify(typ.body) : "none",
  );

  await k.call("POST", `/api/conversations/${cid}/read`, {}, b.token);
  const read = k.broadcasts.find((x) => x.body.type === "read");
  check(
    "read event has the reader's id",
    read && read.body.userId === b.user.id,
    read ? JSON.stringify(read.body) : "none",
  );
}

// ---- 3. no binding: zero broadcasts, plain REST, sends still work ----
{
  const k = await mk(false);
  const a = await k.reg("rt3a@x.com", "rt3a");
  const b = await k.reg("rt3b@x.com", "rt3b");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "no do here" },
    a.token,
  );
  check("send works without the DO binding", sent.status === 201, String(sent.status));
  check("nothing was broadcast", k.broadcasts.length === 0, String(k.broadcasts.length));
  const ack = await k.call("POST", "/api/push/ack", { mid: "m1" }, a.token);
  check("push ack is now a clean no-op", ack.status === 200 && ack.json.ok === true);
}

// ---- 4. group send pokes every other member's channel ----
{
  const k = await mk(true);
  const a = await k.reg("rt4a@x.com", "rt4a");
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await k.reg(`rt4g${i}@x.com`, `rt4g${i}`)).user.id);
  const g = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "RT", memberIds: ids },
    a.token,
  );
  const gid = g.json.conversation.id;
  await k.call("POST", `/api/conversations/${gid}/messages`, { body: "group ping" }, a.token);
  const pokes = k.broadcasts.filter((x) => x.body.type === "conv");
  check(
    "all three other members were poked exactly once",
    pokes.length === 3 && new Set(pokes.map((p) => p.room)).size === 3,
    JSON.stringify(pokes.map((p) => p.room)),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
