import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK      " : "BROKEN  "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const media = makeR2();
  const env = { DB: db, MEDIA: media };
  const ctx = makeCtx();
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
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
      j = { _raw: t.slice(0, 60) };
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

// ---- marker: conversations list ----
{
  const k = await mk();
  const me = await k.reg("ma@x.com", "ma");
  const o = await k.reg("mb@x.com", "mb");
  const cid = (await k.call("POST", "/api/conversations", { userId: o.user.id }, me.token)).json
    .conversation.id;

  const r1 = await k.call("GET", "/api/conversations", undefined, me.token);
  check("list -> returns marker", typeof r1.json.marker === "string" && !!r1.json.marker);
  check("list -> unchanged:false on first fetch", r1.json.unchanged !== true);

  const r2 = await k.call(
    "GET",
    `/api/conversations?marker=${encodeURIComponent(r1.json.marker)}`,
    undefined,
    me.token,
  );
  check("list -> unchanged:true with same marker", r2.json.unchanged === true, JSON.stringify(r2.json));
  check("list -> unchanged response skips items", r2.json.items === undefined);

  await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "hello marker" },
    o.token,
  );
  const r3 = await k.call(
    "GET",
    `/api/conversations?marker=${encodeURIComponent(r1.json.marker)}`,
    undefined,
    me.token,
  );
  check("list -> new message breaks marker", r3.json.unchanged !== true && r3.json.items?.length === 1);
  check("list -> unread counted after new message", r3.json.items?.[0]?.unread === 1);
  const r4 = await k.call("POST", `/api/conversations/${cid}/read`, {}, me.token);
  check("read -> 2xx", r4.status < 300);
  const r5 = await k.call(
    "GET",
    `/api/conversations?marker=${encodeURIComponent(r1.json.marker)}`,
    undefined,
    me.token,
  );
  check("list -> read state breaks marker", r5.json.unchanged !== true && r5.json.items?.[0]?.unread === 0);

  // marker stays same across repeat unchanged polls (idempotent)
  const r6 = await k.call(
    "GET",
    `/api/conversations?marker=${encodeURIComponent(r5.json.marker)}`,
    undefined,
    me.token,
  );
  check("list -> newest marker also stable", r6.json.unchanged === true);
}

// ---- marker: messages page ----
{
  const k = await mk();
  const me = await k.reg("mc@x.com", "mc");
  const o = await k.reg("md@x.com", "md");
  const cid = (await k.call("POST", "/api/conversations", { userId: o.user.id }, me.token)).json
    .conversation.id;
  await k.call("POST", `/api/conversations/${cid}/messages`, { body: "one" }, o.token);

  const r1 = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, me.token);
  check("messages -> returns marker + items", !!r1.json.marker && r1.json.items?.length === 1);

  const r2 = await k.call(
    "GET",
    `/api/conversations/${cid}/messages?marker=${encodeURIComponent(r1.json.marker)}`,
    undefined,
    me.token,
  );
  // First re-poll may legitimately change: the delivered-receipts UPDATE ran
  // after the first SELECT, so the second fetch surfaces deliveredAt. The
  // marker must be stable from the THIRD identical fetch on.
  const r2b = await k.call(
    "GET",
    `/api/conversations/${cid}/messages?marker=${encodeURIComponent(r2.json.marker ?? r1.json.marker)}`,
    undefined,
    me.token,
  );
  check(
    "messages -> unchanged:true once settled",
    r2b.json.unchanged === true,
    `${JSON.stringify(r2b.json).slice(0, 80)}`,
  );
  check("messages -> unchanged response skips items", r2b.json.items === undefined);

  await k.call("POST", `/api/conversations/${cid}/messages`, { body: "two" }, o.token);
  const r3 = await k.call(
    "GET",
    `/api/conversations/${cid}/messages?marker=${encodeURIComponent(r1.json.marker)}`,
    undefined,
    me.token,
  );
  check("messages -> new row breaks marker", r3.json.unchanged !== true && r3.json.items?.length === 2);
}

// ---- sticker passthrough for custom emoji ids ----
{
  const k = await mk();
  const me = await k.reg("me@x.com", "me");
  const o = await k.reg("mf@x.com", "mf");
  const cid = (await k.call("POST", "/api/conversations", { userId: o.user.id }, me.token)).json
    .conversation.id;
  const r1 = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "STICKER", body: "kcp_smile_01" },
    me.token,
  );
  check("sticker -> kcp id accepted", r1.status === 201 || r1.json.duplicate === true, `${r1.status} ${JSON.stringify(r1.json).slice(0, 80)}`);
  const r2 = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "STICKER", body: "kcp_way_too_long_for_a_sticker_id" },
    me.token,
  );
  check("sticker -> >16 char id rejected", r2.status >= 400, `${r2.status}`);
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
if (broken) process.exit(1);
