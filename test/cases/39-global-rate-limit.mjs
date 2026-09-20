// M2 (audit 2026-09-21): cross-isolate rate limiting for auth endpoints.
//
// rateLimit() is per-isolate (each edge isolate keeps its own buckets), so a
// caller spread over many isolates got cap x isolates. rateLimitGlobal() is a
// fixed-window counter in D1 (`rate_limits`) — every isolate reads/writes the
// same row, so the cap holds globally. Callers keep the in-memory check first
// (cheap, precise) with the D1 backstop at 2x headroom.

import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, phoneFrom } from "../helpers/phoneauth.mjs";

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
  const call = async (method, path, body, token, fixedIp) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] =
        fixedIp ?? `203.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const buf = Buffer.from(await res.arrayBuffer());
    await ctx.drain();
    let j = {};
    try {
      j = JSON.parse(buf.toString());
    } catch {
      j = {};
    }
    return { status: res.status, json: j, headers: res.headers, body: buf };
  };
  const reg = makeReg(call);
  return { db, call, reg };
}

// ---- 1. hammering from one IP still 429s (in-memory L1) ----
{
  const k = await mk();
  const phone = phoneFrom("m2a@x.com");
  let saw429 = false;
  for (let i = 0; i < 20 && !saw429; i++) {
    const r = await k.call(
      "POST",
      "/api/auth/verify-phone",
      { phone, sim: "NO_SIM", deviceId: "dev-m2" },
      undefined,
      "198.51.100.21",
    );
    if (r.status === 429) saw429 = true;
  }
  check("hammering verify-phone from one IP → 429", saw429 === true);
  const row = k.db._db
    .prepare("SELECT count FROM rate_limits WHERE key = ?")
    .get("gpv:198.51.100.21");
  check(
    "every allowed hit left its mark in D1 (the global record)",
    (row?.count ?? 0) >= 15,
    `count=${row?.count}`,
  );
}

// ---- 2. the D1 record binds even with cold in-memory buckets ----
// Simulates what a second isolate sees: this IP is fresh to the in-memory
// buckets, but D1 already holds a full window (written by "other isolates").
{
  const k = await mk();
  const window = Math.floor(Date.now() / 60_000);
  const other = await k.call(
    "POST",
    "/api/auth/verify-phone",
    { phone: "+8801300000023", sim: "NO_SIM", deviceId: "dev-m2c" },
    undefined,
    "198.51.100.23",
  );
  check("a different IP is unaffected", other.status !== 429, `status=${other.status}`);
  k.db._db
    .prepare("INSERT INTO rate_limits (key, window, count) VALUES (?, ?, ?)")
    .run("gpv:198.51.100.22", window, 30);
  const r = await k.call(
    "POST",
    "/api/auth/verify-phone",
    { phone: "+8801300000022", sim: "NO_SIM", deviceId: "dev-m2b" },
    undefined,
    "198.51.100.22",
  );
  check(
    "a full D1 window 429s on the very first hit from a fresh IP",
    r.status === 429 && r.json?.error?.code === "RATE_LIMITED",
    `status=${r.status} code=${r.json?.error?.code}`,
  );
  check(
    "the 429 carries Retry-After: 60 (the app cools down)",
    r.headers.get("retry-after") === "60",
    `retry-after=${r.headers.get("retry-after")}`,
  );
}

// ---- 3. source locks ----
{
  const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
  check(
    "worker — rate_limits table + rateLimitGlobal (D1 fixed window, INSERT OR REPLACE) + cron prune",
    src.includes("CREATE TABLE IF NOT EXISTS rate_limits (") &&
      src.includes("async function rateLimitGlobal(db: D1Database, key: string, cap: number)") &&
      src.includes("INSERT OR REPLACE INTO rate_limits (key, window, count) VALUES (?, ?, ?)") &&
      src.includes("DELETE FROM rate_limits WHERE window < ?"),
  );
  check(
    "worker — all 8 unauthenticated auth endpoints carry the D1 backstop",
    src.includes("await rateLimitGlobal(db, `gpv:${clientIp(request)}`, 30);") &&
      src.includes("await rateLimitGlobal(db, `ggb:${clientIp(request)}`, 20);") &&
      src.includes("await rateLimitGlobal(db, `glp:${clientIp(request)}`, 300);") &&
      src.includes("await rateLimitGlobal(db, `glc:${clientIp(request)}`, 30);") &&
      src.includes("await rateLimitGlobal(db, `grlookup:${clientIp(request)}`, 20);") &&
      src.includes("await rateLimitGlobal(db, `grs:${clientIp(request)}`, 10);") &&
      src.includes("await rateLimitGlobal(db, `grsp:${phone}`, 10);") &&
      src.includes("await rateLimitGlobal(db, `grc:${clientIp(request)}`, 20);"),
  );
}

console.log(lines.join("\n"));
console.log(
  `m2 global-rate-limit: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
