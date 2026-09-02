// §52's "Backend latency" line: the hourly probe against our own /api/health, and the
// rules that keep it honest — sampled inside the hourly gate, capped by a timeout so the
// every-minute reaper can never stall, counted as (samples, ms, errors) so the only
// derived number is a mean over samples that actually happened, and accumulated per hour
// instead of replaced.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { readFileSync } from "node:fs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const fresh = async () => await import(`${WORKER}?v=${n++}`);

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const src = readFileSync("src/worker/index.ts", "utf8");
const toml = readFileSync("wrangler.toml", "utf8");
const day = new Date().toISOString().slice(0, 10);

async function mk() {
  const mod = await fresh();
  const env = { DB: makeD1(), MEDIA: makeR2(), SELF_ORIGIN: "https://kp.test" };
  const ctx = makeCtx();
  // The schema the probe writes into comes from the same ensureSchema the cron calls, so
  // create it by hitting the real handler once.
  await mod.default.fetch(new Request("https://kp.test/api/health"), env, ctx);
  await ctx.drain();
  return { mod, env, ctx, db: env.DB };
}

const val = async (db, key) =>
  (
    await db
      .prepare("SELECT value FROM metrics_daily WHERE day = ? AND key = ?")
      .bind(day, key)
      .first()
  )?.value ?? null;

// -------------------------------------------------------------- against the real handler
{
  const { mod, env, db } = await mk();
  const res = await mod.probeBackendLatency(db, env.SELF_ORIGIN, new Date(), (url, init) =>
    mod.default.fetch(new Request(url, { method: "GET", signal: init?.signal }), env, makeCtx()),
  );
  check("three samples of the real handler are counted", res.count === 3, JSON.stringify(res));
  check("no probe failed", res.errors === 0, JSON.stringify(res));
  check("latency is a non-negative sum", res.sumMs >= 0, String(res.sumMs));
  check(
    "lat.count lands in today's bucket",
    (await val(db, "lat.count")) === 3,
    String(await val(db, "lat.count")),
  );
  check(
    "lat.err is written as 0, so a clean hour is distinguishable from no probe",
    (await val(db, "lat.err")) === 0,
  );
}

// -------------------------------------------------------------- per-hour accumulation
{
  const { mod, env, db } = await mk();
  const f = (url, init) =>
    mod.default.fetch(new Request(url, { method: "GET", signal: init?.signal }), env, makeCtx());
  await mod.probeBackendLatency(db, "https://kp.test", new Date(), f);
  await mod.probeBackendLatency(db, "https://kp.test", new Date(), f);
  const count = await val(db, "lat.count");
  check("a later hour adds to the day instead of replacing it", count === 6, String(count));
  const sum = await val(db, "lat.sum_ms");
  check("sum/count stays a mean over every sample of the day", sum !== null && Number(sum) >= 0);
}

// -------------------------------------------------------------- failure handling
{
  const { mod, db } = await mk();
  const seen = [];
  const res = await mod.probeBackendLatency(
    db,
    "https://kp.test",
    new Date(),
    async (url, init) => {
      seen.push({ url, signal: !!init?.signal });
      return new Response("nope", { status: 503 });
    },
  );
  check(
    "a 503 counts as an error, never as a sample",
    res.count === 0 && res.errors === 3,
    JSON.stringify(res),
  );
  check(
    "every sample gets a timeout signal (the cron must not hang)",
    seen.length === 3 && seen.every((s) => s.signal),
    JSON.stringify(seen),
  );
  check(
    "the probe URL is /api/health on the configured origin",
    seen[0].url === "https://kp.test/api/health",
    seen[0]?.url,
  );
  check(
    "the failure is recorded, not swallowed",
    (await val(db, "lat.err")) === 3,
    String(await val(db, "lat.err")),
  );
  check(
    "a failed hour records zero samples so no mean is implied",
    (await val(db, "lat.count")) === 0,
  );
}

// -------------------------------------------------------------- no origin configured
{
  const { mod, db } = await mk();
  const before = db._stats.writes;
  let called = 0;
  const res = await mod.probeBackendLatency(db, undefined, new Date(), async () => {
    called++;
    return new Response("{}", { status: 200 });
  });
  check("no SELF_ORIGIN means no fetch, no guessing an origin", called === 0, String(called));
  check("and zeros are recorded so the gap is visible", res.count === 0 && res.errors === 0);
  check(
    "it still costs exactly the three counter statements",
    db._stats.writes - before === 3,
    String(db._stats.writes - before),
  );
}

// -------------------------------------------------------------- shape and cost
check("3 samples per hour, not per tick", mod_probe(src, "LAT_SAMPLES = 3"));
check("the probe sits inside the hourly gate", gateOrderOk(src));
check("it is inside the gate's try, so a failure cannot stop the pruning", gateTryOk(src));
check("the timeout is 5s and finite", mod_probe(src, "LAT_TIMEOUT_MS = 5_000"));
check(
  "origin comes from config, never hardcoded in source",
  !src.includes("workers.dev") &&
    toml.includes('SELF_ORIGIN = "https://kuchupuchu-api.kuchupuchu.workers.dev"'),
);
check("Env declares SELF_ORIGIN as optional", /SELF_ORIGIN\?: string;/.test(src));
check("the log line reports the probe", /metrics,\s*\n\s*lat,/.test(src));
check(
  "no new table, and the counters share the rollups' accumulate statement",
  (probeBody(src).match(/counterUpsert\(db, day, "lat\./g) ?? []).length === 3 &&
    (src.match(/DO UPDATE SET value = value \+ excluded\.value/g) || []).length === 1 &&
    !src.includes("CREATE TABLE IF NOT EXISTS metrics_lat"),
);
check("the three keys are latency-shaped counters", keysOk(src));
check(
  "nothing logs a body, a token or a query",
  !/latency.*console\.log\(url/.test(src) && !/lat_(count|sum_ms|err)\"?,\s*JSON/.test(src),
);

function probeBody(s) {
  const i = s.indexOf("export async function probeBackendLatency");
  return s.slice(i, s.indexOf("\n}\n", i));
}
function mod_probe(s, needle) {
  return s.includes(`export const ${needle}`);
}
function gateOrderOk(s) {
  const g = s.indexOf("if (shouldRollupMetrics(mNow))");
  const p = s.indexOf("probeBackendLatency(", g);
  return g > 0 && p > 0 && p - g < 1200;
}
function gateTryOk(s) {
  const t = s.indexOf("if (shouldRollupMetrics(mNow))");
  const tryAt = s.indexOf("try {", t);
  const p = s.indexOf("lat = await probeBackendLatency(", tryAt);
  const cat = s.indexOf("} catch (mErr)", tryAt);
  return tryAt > 0 && p > tryAt && p < cat;
}
function keysOk(s) {
  const b = probeBody(s);
  const keys = ["lat.count", "lat.sum_ms", "lat.err"];
  return (
    keys.every((k) => b.includes(`"${k}"`) || b.includes(`'${k}'`) || b.includes(`, "${k}",`)) &&
    keys.every((k) => /^[a-z]{3,6}[.][a-z_0-9]{2,14}$/.test(k))
  );
}

const broken = lines.filter((l) => l.includes("BROKEN"));
console.log(lines.join("\n"));
console.log(`\n${lines.length - broken.length} OK, ${broken.length} BROKEN`);
if (broken.length) process.exit(1);
