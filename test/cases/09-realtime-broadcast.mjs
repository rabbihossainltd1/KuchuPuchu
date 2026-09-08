// Realtime broadcast wiring (Step 2). The worker hands events to the
// CHAT_ROOM Durable Object after the REST write lands. The DO itself runs
// only on Cloudflare; here a fake namespace records everything the worker
// would have forwarded, so the wiring, the event shapes and the "no binding
// => plain REST" fallback are all asserted against the real worker code.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

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
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
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
    if (path.startsWith("/api/auth/"))
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
  const reg = makeReg(call);
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

// ---- 3. offline recipient fetch broadcasts delivery to the sender ----
{
  const k = await mk(true);
  const a = await k.reg("rt3a@x.com", "rt3a");
  const b = await k.reg("rt3b@x.com", "rt3b");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "offline delivery", clientId: "rt-delivered" },
    a.token,
  );
  const mid = sent.json.message.id;
  k.broadcasts.length = 0;

  const fetched = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
  check("offline recipient fetch still succeeds", fetched.status === 200, String(fetched.status));
  const delivered = k.broadcasts.find((x) => x.room === cid && x.body.type === "delivered");
  check(
    "recipient fetch broadcasts delivered event to the room",
    delivered &&
      delivered.body.messageIds.includes(mid) &&
      delivered.body.senderIds.includes(a.user.id) &&
      !!delivered.body.at,
    delivered ? JSON.stringify(delivered.body) : "none",
  );
  check(
    "affected sender's list channel gets a conversation poke",
    k.broadcasts.some(
      (x) =>
        x.room === `user:${a.user.id}` && x.body.type === "conv" && x.body.conversationId === cid,
    ),
    JSON.stringify(k.broadcasts.map((x) => ({ room: x.room, type: x.body.type }))),
  );
  check(
    "fetching recipient is not redundantly poked",
    !k.broadcasts.some((x) => x.room === `user:${b.user.id}` && x.body.type === "conv"),
  );
}

// ---- 4. no binding: zero broadcasts, plain REST, sends still work ----
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

// ---- r31-18: profile + conversation changes fan out live --------------------
{
  const k = await mk(true);
  const a = await k.reg("rt5a@x.com", "rt5a");
  const b = await k.reg("rt5b@x.com", "rt5b");
  const c = await k.reg("rt5c@x.com", "rt5c");
  const stranger = await k.reg("rt5s@x.com", "rt5s");
  await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const g = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "RT5", memberIds: [c.user.id] },
    a.token,
  );
  const gid = g.json.conversation.id;
  k.broadcasts.length = 0;
  await k.call("PATCH", "/api/me", { displayName: "A Renamed" }, a.token);
  const prof = k.broadcasts.filter((x) => x.body.type === "profile");
  const rooms = new Set(prof.map((p) => p.room));
  check(
    "PATCH /api/me (name) → one profile frame per peer sharing ANY conversation (1:1 + group) plus self",
    prof.every((p) => p.body.userId === a.user.id) &&
      rooms.has(`user:${b.user.id}`) &&
      rooms.has(`user:${c.user.id}`) &&
      rooms.has(`user:${a.user.id}`) &&
      !rooms.has(`user:${stranger.user.id}`),
    JSON.stringify([...rooms]),
  );
  k.broadcasts.length = 0;
  await k.call("PATCH", "/api/me", { privLastSeen: "nobody" }, a.token);
  check(
    "a privacy-only PATCH fans out NO profile frame",
    k.broadcasts.filter((x) => x.body.type === "profile").length === 0,
    String(k.broadcasts.length),
  );
  k.broadcasts.length = 0;
  await k.call("PATCH", `/api/conversations/${gid}`, { title: "RT5 renamed" }, a.token);
  const convPokes = k.broadcasts.filter((x) => x.body.type === "conv" && !x.body.msg);
  const pokeRooms = new Set(convPokes.map((p) => p.room));
  check(
    "group rename → conv frame to the chat room AND every member's user channel",
    pokeRooms.has(gid) && pokeRooms.has(`user:${a.user.id}`) && pokeRooms.has(`user:${c.user.id}`),
    JSON.stringify([...pokeRooms]),
  );
}

// ---- r32-28: the recipient coming back online IS delivery ------------------
// A message sent while the recipient was offline (no device token → no FCM
// accept → delivered_at NULL) used to stay on ONE tick until the recipient
// opened that exact chat. Now the recipient's chat-list poll (the first
// request of a returning app) and its /ws/user connect stamp everything
// waiting for it and tell the sender at once.
{
  const k = await mk(true);
  const a = await k.reg("rt6a@x.com", "rt6a");
  const b = await k.reg("rt6b@x.com", "rt6b");
  const c = await k.reg("rt6c@x.com", "rt6c");
  const ab = (await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
    .conversation.id;
  const cb = (await k.call("POST", "/api/conversations", { userId: c.user.id }, b.token)).json
    .conversation.id;
  const m1 = (
    await k.call(
      "POST",
      `/api/conversations/${ab}/messages`,
      { body: "while you were away 1" },
      a.token,
    )
  ).json.message.id;
  const m2 = (
    await k.call(
      "POST",
      `/api/conversations/${ab}/messages`,
      { body: "while you were away 2" },
      a.token,
    )
  ).json.message.id;
  const m3 = (
    await k.call("POST", `/api/conversations/${cb}/messages`, { body: "from c" }, c.token)
  ).json.message.id;
  // b's OWN message must never be stamped by b's return.
  const mine = (
    await k.call("POST", `/api/conversations/${ab}/messages`, { body: "b's own" }, b.token)
  ).json.message.id;
  const pendingBefore = k.db._db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE delivered_at IS NULL AND id IN (?,?,?)")
    .get(m1, m2, m3).n;
  check(
    "offline recipient: the three inbound rows start undelivered",
    pendingBefore === 3,
    String(pendingBefore),
  );

  k.broadcasts.length = 0;
  const list = await k.call("GET", "/api/conversations", undefined, b.token);
  check("returning recipient's list poll succeeds", list.status === 200, String(list.status));
  const stamped = k.db._db
    .prepare("SELECT id, delivered_at FROM messages WHERE id IN (?,?,?,?)")
    .all(m1, m2, m3, mine);
  const at = (id) => stamped.find((r) => r.id === id)?.delivered_at ?? null;
  check(
    "r32-28: the list poll stamps EVERY undelivered inbound message across all of the recipient's chats — never the recipient's own",
    !!at(m1) && !!at(m2) && !!at(m3) && at(mine) === null,
    JSON.stringify(stamped),
  );
  const deliveredAB = k.broadcasts.find((x) => x.room === ab && x.body.type === "delivered");
  const deliveredCB = k.broadcasts.find((x) => x.room === cb && x.body.type === "delivered");
  check(
    "r32-28: each affected room gets ONE delivered frame with the exact ids + sender ids",
    !!deliveredAB &&
      deliveredAB.body.messageIds.length === 2 &&
      deliveredAB.body.messageIds.includes(m1) &&
      deliveredAB.body.messageIds.includes(m2) &&
      deliveredAB.body.senderIds.length === 1 &&
      deliveredAB.body.senderIds[0] === a.user.id &&
      !!deliveredCB &&
      deliveredCB.body.messageIds.length === 1 &&
      deliveredCB.body.messageIds[0] === m3 &&
      deliveredCB.body.senderIds[0] === c.user.id &&
      deliveredAB.body.at === deliveredCB.body.at,
    JSON.stringify(k.broadcasts.map((x) => ({ room: x.room, body: x.body }))),
  );
  check(
    "r32-28: every sender's list channel is poked (a sender on the chat list re-reads its ticks) WITHOUT msg:1 (no false in-app message sound); the recipient itself is not",
    k.broadcasts.some(
      (x) =>
        x.room === `user:${a.user.id}` &&
        x.body.type === "conv" &&
        x.body.conversationId === ab &&
        x.body.receipt === 1 &&
        x.body.msg === undefined,
    ) &&
      k.broadcasts.some(
        (x) =>
          x.room === `user:${c.user.id}` && x.body.type === "conv" && x.body.conversationId === cb,
      ) &&
      !k.broadcasts.some((x) => x.room === `user:${b.user.id}`),
    JSON.stringify(k.broadcasts.map((x) => x.room)),
  );
  // Second poll with nothing waiting: silent (no frames, no writes).
  k.broadcasts.length = 0;
  await k.call("GET", "/api/conversations", undefined, b.token);
  check(
    "r32-28: a poll with no backlog broadcasts nothing",
    k.broadcasts.length === 0,
    String(k.broadcasts.length),
  );
  // The /ws/user handshake stamps too (a socket coming up before any poll).
  const m4 = (
    await k.call("POST", `/api/conversations/${ab}/messages`, { body: "away again" }, a.token)
  ).json.message.id;
  k.broadcasts.length = 0;
  const ws = await k.call("GET", "/ws/user", undefined, b.token);
  const m4At = k.db._db
    .prepare("SELECT delivered_at FROM messages WHERE id = ?")
    .get(m4).delivered_at;
  check(
    "r32-28: connecting the user channel stamps the backlog as delivered and tells the sender",
    // (the fake namespace cannot answer an upgrade — the status is not the point)
    !!m4At &&
      k.broadcasts.some(
        (x) => x.room === ab && x.body.type === "delivered" && x.body.messageIds[0] === m4,
      ),
    `status=${ws.status} at=${m4At} frames=${JSON.stringify(k.broadcasts.map((x) => x.body.type))}`,
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
