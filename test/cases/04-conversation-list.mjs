// GET /api/conversations used to run 1 + 5N statements for N chats: the list
// query, then per chat a hidden_json read, a conversation read, a members read
// and one users read per member. Five chats cost 29 D1 round trips, and the
// client polls this every 2.5s.
//
// This checks the statement count AND that the payload is unchanged - a
// batching refactor that quietly drops a field is worse than the N+1.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2() };
  const ctx = makeCtx();
  // The auth routes are rate limited per client IP (that limit is one of the
  // fixes under test), so each registration gets its own address.
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
  return { db, call, reg };
}

// ---- 1. statement count for a realistic chat list ----
{
  const k = await mk();
  const me = await k.reg("la@x.com", "la");
  const others = [];
  for (let i = 0; i < 5; i++) others.push(await k.reg(`lb${i}@x.com`, `lb${i}`));
  const cids = [];
  for (const o of others) {
    const cid = (await k.call("POST", "/api/conversations", { userId: o.user.id }, me.token)).json
      .conversation.id;
    cids.push(cid);
    await k.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { body: `hi from ${o.user.username}` },
      o.token,
    );
  }
  const g = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "Squad", memberIds: others.slice(0, 3).map((o) => o.user.id) },
      me.token,
    )
  ).json.conversation.id;
  await k.call("POST", `/api/conversations/${g}/messages`, { body: "group hi" }, me.token);

  k.db._stats.reset();
  const res = await k.call("GET", "/api/conversations", undefined, me.token);
  const { reads, writes } = k.db._stats;
  const items = res.json.items || [];
  check("all six conversations are returned", items.length === 6, String(items.length));
  check(
    "statement count is constant, not per-chat",
    reads + writes <= 8,
    `${reads} reads + ${writes} writes`,
  );

  // --- payload is unchanged ---
  const solo = items.filter((c) => c.kind === "SOLO");
  check(
    "every SOLO chat has its `other` party filled in",
    solo.every((c) => c.other && c.other.username),
    solo.map((c) => c.other?.username).join(","),
  );
  check(
    "unread counts survived batching",
    items.filter((c) => c.unread === 1).length === 5,
    JSON.stringify(items.map((c) => c.unread)),
  );
  check(
    "group is flagged and has the right members",
    (() => {
      const grp = items.find((c) => c.id === g);
      return grp?.isGroup === true && grp?.members.length === 4 && grp?.title === "Squad";
    })(),
    JSON.stringify({
      t: items.find((c) => c.id === g)?.title,
      m: items.find((c) => c.id === g)?.members.length,
    }),
  );
  check(
    "members carry role and lastReadAt",
    items.every((c) => c.members.every((m) => typeof m.role === "string" && "lastReadAt" in m)),
  );
  check(
    "disappearSeconds and theme are still present",
    items.every((c) => typeof c.disappearSeconds === "number" && typeof c.theme === "string"),
    JSON.stringify({ d: items[0].disappearSeconds, t: items[0].theme }),
  );
  check(
    "no email is leaked in any member payload",
    !JSON.stringify(items).includes("lb0@x.com") && !JSON.stringify(items).includes("la@x.com"),
  );
  check(
    "ordered newest-first",
    (() => {
      const t = items.map((c) => Date.parse(c.lastMessageAt || c.createdAt));
      return t.every((v, i) => i === 0 || t[i - 1] >= v);
    })(),
    items.map((c) => c.lastMessage).join(" | "),
  );

  // the group chat was messaged last, so it must be first
  check("the most recently active chat is first", items[0].id === g, items[0].lastMessage);
}

// ---- 2. count does not grow with the member count ----
{
  const k = await mk();
  const me = await k.reg("ma@x.com", "ma");
  const people = [];
  for (let i = 0; i < 12; i++) people.push(await k.reg(`mb${i}@x.com`, `mb${i}`));
  await k.call(
    "POST",
    "/api/conversations/group",
    { title: "Big", memberIds: people.map((p) => p.user.id) },
    me.token,
  );
  k.db._stats.reset();
  const res = await k.call("GET", "/api/conversations", undefined, me.token);
  const { reads, writes } = k.db._stats;
  check(
    "a 13-member group costs the same handful of statements",
    reads + writes <= 8,
    `${reads} reads + ${writes} writes`,
  );
  check(
    "and still lists all 13 members",
    (res.json.items[0].members || []).length === 13,
    String((res.json.items[0].members || []).length),
  );
}

// ---- 3. an empty list is cheap and correct ----
{
  const k = await mk();
  const me = await k.reg("na@x.com", "na");
  k.db._stats.reset();
  const res = await k.call("GET", "/api/conversations", undefined, me.token);
  check(
    "no chats -> empty list",
    Array.isArray(res.json.items) && res.json.items.length === 0,
    JSON.stringify(res.json.items),
  );
  // 2 of these are the session/user lookup the auth layer always does.
  check(
    "no chats -> the list itself is a single statement",
    k.db._stats.reads + k.db._stats.writes <= 3,
    `${k.db._stats.reads} reads total`,
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
