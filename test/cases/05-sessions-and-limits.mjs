// Sessions were never cleaned up (the table only grew, one row per login for
// 90 days) and the worker hardcoded limits that contradicted
// src/shared/constants.ts. Both are covered here.

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
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
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
  const reg = makeReg(call);
  return { db, call, reg };
}

// ---- 1. expired sessions are reaped, live ones survive ----
{
  const k = await mk();
  await k.call("GET", "/api/health"); // creates the schema without touching sessions
  const ins = k.db._db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  );
  ins.run("dead1", "u1", new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  ins.run("dead2", "u2", new Date(Date.now() - 864e5).toISOString(), new Date().toISOString());
  ins.run("live1", "u3", new Date(Date.now() + 864e5).toISOString(), new Date().toISOString());
  const count = () => k.db._db.prepare("SELECT COUNT(*) n FROM sessions").get().n;
  check("three seeded sessions", count() === 3, String(count()));

  await k.reg("sa@x.com", "sa");
  check("the two expired rows were reaped on the next login", count() === 2, String(count()));
  check(
    "the live session survived",
    k.db._db.prepare("SELECT token_hash FROM sessions WHERE token_hash = 'live1'").get() !==
      undefined,
  );

  // the sweep is throttled to once an hour per isolate, so a second login
  // must not issue another DELETE
  ins.run("dead3", "u4", new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  k.db._stats.reset();
  await k.reg("sb@x.com", "sb");
  const deletes = k.db._db
    .prepare("SELECT COUNT(*) n FROM sessions WHERE token_hash = 'dead3'")
    .get().n;
  check("the sweep is throttled, not per-login", deletes === 1, `dead3 rows=${deletes}`);
}

// ---- 2. a real session still authenticates, and for 90 days ----
{
  const k = await mk();
  const a = await k.reg("ta@x.com", "ta");
  const me = await k.call("GET", "/api/me", undefined, a.token);
  check(
    "a fresh session authenticates",
    me.status === 200 && me.json.user?.username === "ta",
    String(me.status),
  );
  const row = k.db._db.prepare("SELECT created_at, expires_at FROM sessions LIMIT 1").get();
  const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 864e5;
  check(
    "session TTL is 90 days, matching the shared constant",
    Math.round(days) === 90,
    `${days.toFixed(2)} days`,
  );
}

// ---- 3. the message and bio limits are the shared constants ----
{
  const k = await mk();
  const a = await k.reg("ua@x.com", "ua");
  const b = await k.reg("ub@x.com", "ub");
  const cid = (await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
    .conversation.id;
  const long = "x".repeat(5000);
  const sent = await k.call("POST", `/api/conversations/${cid}/messages`, { body: long }, a.token);
  const stored = k.db._db
    .prepare("SELECT body FROM messages WHERE id = ?")
    .get(sent.json.message.id).body;
  check(
    "message body is capped at MESSAGE_MAX_LENGTH (4000)",
    stored.length === 4000,
    String(stored.length),
  );

  const me = await k.call("PATCH", "/api/me", { about: "y".repeat(500) }, a.token);
  check(
    "bio is capped at BIO_MAX_LENGTH (160)",
    me.json.user?.about?.length === 160,
    String(me.json.user?.about?.length),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
