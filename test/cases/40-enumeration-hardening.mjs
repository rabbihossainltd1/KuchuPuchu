// M1 (audit 2026-09-21): enumeration hardening on the recovery + phone paths.
//
// recovery/start used to answer "no such account" (404 NO_RECOVERY_TARGET)
// vs "wrong Google" (401 GOOGLE_MISMATCH) — distinct codes that let any
// Google account sort numbers into registered/unregistered. Both answers
// are now identical; the precise reason stays in the RECOVERY_DENIED audit
// row. verify-phone and recovery/lookup additionally carry per-phone GLOBAL
// caps (a botnet rotating IPs still shares one budget per targeted number),
// and every lookup leaves an audit trail.

import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, phoneFrom, fakeIdToken } from "../helpers/phoneauth.mjs";

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
        fixedIp ?? `204.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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

// ---- 1. recovery/start: one identical answer ----
{
  const k = await mk();
  const A = await k.reg("m1a@x.com", "m1a");
  const phoneA = phoneFrom("m1a@x.com");
  const good = await k.call(
    "POST",
    "/api/auth/recovery/start",
    { phone: phoneA, idToken: fakeIdToken("g-m1a", "m1a@x.com"), deviceId: "dev-m1-new" },
    undefined,
    "198.51.100.31",
  );
  check("recovery/start works with the bound Google", good.status === 200 && !!good.json.requestId);
  const wrong = await k.call(
    "POST",
    "/api/auth/recovery/start",
    { phone: phoneA, idToken: fakeIdToken("g-stranger", "s@x.com"), deviceId: "dev-m1-new" },
    undefined,
    "198.51.100.31",
  );
  const ghost = await k.call(
    "POST",
    "/api/auth/recovery/start",
    {
      phone: phoneFrom("ghost@x.com"),
      idToken: fakeIdToken("g-x", "x@x.com"),
      deviceId: "dev-m1-g",
    },
    undefined,
    "198.51.100.31",
  );
  const same = (r) =>
    r.status === 404 &&
    r.json?.error?.code === "NO_RECOVERY_TARGET" &&
    r.json?.error?.message === "No recoverable account was found for that number.";
  check(
    "wrong-Google and unknown-number answers are identical (404 NO_RECOVERY_TARGET)",
    same(wrong) && same(ghost),
    `wrong=${wrong.status}/${wrong.json?.error?.code} ghost=${ghost.status}/${ghost.json?.error?.code}`,
  );
  void A;
}

// ---- 2. verify-phone per-phone global cap binds across rotating IPs ----
{
  const k = await mk();
  const phone = phoneFrom("m1b@x.com");
  let saw429 = false;
  for (let i = 0; i < 24 && !saw429; i++) {
    const r = await k.call("POST", "/api/auth/verify-phone", {
      phone,
      sim: "NO_SIM",
      deviceId: "dev-m1-rot",
    });
    if (r.status === 429) saw429 = true;
  }
  check("21+ hits on one number from rotating IPs → 429 (per-phone global)", saw429 === true);
  const row = k.db._db.prepare("SELECT count FROM rate_limits WHERE key = ?").get(`gppv:${phone}`);
  check("the per-phone D1 record exists", (row?.count ?? 0) >= 20, `count=${row?.count}`);
}

// ---- 3. lookup per-phone global cap binds across rotating IPs ----
{
  const k = await mk();
  const phone = phoneFrom("m1c@x.com");
  let saw429 = false;
  for (let i = 0; i < 14 && !saw429; i++) {
    const r = await k.call("POST", "/api/auth/recovery/lookup", { phone });
    if (r.status === 429) saw429 = true;
  }
  check("11+ lookups on one number from rotating IPs → 429 (per-phone global)", saw429 === true);
  const row = k.db._db
    .prepare("SELECT count FROM rate_limits WHERE key = ?")
    .get(`gprlookup:${phone}`);
  check("the per-phone lookup D1 record exists", (row?.count ?? 0) >= 10, `count=${row?.count}`);
}

// ---- 4. every lookup leaves an audit trail ----
{
  const k = await mk();
  const phone = phoneFrom("m1d@x.com");
  await k.call("POST", "/api/auth/recovery/lookup", { phone });
  const row = k.db._db
    .prepare(
      "SELECT meta FROM auth_audit WHERE event = 'RECOVERY_LOOKUP' ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  check(
    "RECOVERY_LOOKUP audit row written (masked number + verdict)",
    !!row?.meta && row.meta.includes('"exists"') && !row.meta.includes(phone),
    row?.meta?.slice(0, 90),
  );
}

// ---- 5. source locks ----
{
  const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
  check(
    "worker — GOOGLE_MISMATCH is gone (one identical recovery/start answer)",
    !src.includes("GOOGLE_MISMATCH"),
  );
  check(
    "worker — per-phone global caps on verify-phone + lookup, lookup audited",
    src.includes("await rateLimitGlobal(db, `gppv:${phone}`, 20);") &&
      src.includes("await rateLimitGlobal(db, `gprlookup:${phone}`, 10);") &&
      src.includes('await audit(db, "RECOVERY_LOOKUP", user?.id ?? null, null, {'),
  );
}

console.log(lines.join("\n"));
console.log(
  `m1 enumeration-hardening: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
