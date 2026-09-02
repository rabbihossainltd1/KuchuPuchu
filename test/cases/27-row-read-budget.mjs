// D1's free tier counts a row READ for every row a statement LOOKS AT, not just the
// rows it returns. On 2026-09-02 production hit that ceiling before midnight UTC and
// every cron tick after it died with `free tier daily row read limit`: the burner was
// this worker's own bookkeeping — a per-minute stale-RINGING SELECT and per-isolate
// sweeps, all of them `SCAN <table>` full scans over `calls` / `error_log` / `devices`
// / `sessions` / `typing` / `statuses`.
//
// Two invariants hold the fix, and they are different kinds of proof:
//   1. QUERY SHAPE — `EXPLAIN QUERY PLAN` (real SQLite, through the same shim the
//      worker runs on) must say `SEARCH ... USING INDEX` for every cleanup statement.
//      This is the check that fails if someone adds a 7th sweep without an index.
//   2. CADENCE — the age-based DELETEs run at most once per UTC day, behind a marker
//      row, while the reap stays per tick.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { readFileSync } from "node:fs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const fresh = async () => await import(`${WORKER}?v=${n++}`);

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const src = readFileSync("src/worker/index.ts", "utf8");
const day = new Date().toISOString().slice(0, 10);

// Statements the worker issues for cleanup, exactly as written in the source.
const CLEANUP = [
  [
    "calls",
    "SELECT id, caller_id, callee_id, kind FROM calls WHERE status = 'RINGING' AND created_at < ?",
  ],
  ["error_log", "DELETE FROM error_log WHERE created_at < ?"],
  ["devices", "DELETE FROM devices WHERE updated_at < ?"],
  ["sessions", "DELETE FROM sessions WHERE expires_at < ?"],
  ["typing", "DELETE FROM typing WHERE at < ?"],
  ["statuses", "DELETE FROM statuses WHERE expires_at < ?"],
];

/** The worker's own DDL, applied to a real in-memory SQLite the way cron applies it. */
async function seeded() {
  const mod = await fresh();
  const env = { DB: makeD1(), MEDIA: makeR2(), SELF_ORIGIN: "https://kp.test" };
  const ctx = makeCtx();
  // ensureSchema runs inside the request path; one health call gives us the shipped
  // tables AND the shipped indexes, with nothing hand-copied into this test.
  await mod.default.fetch(new Request("https://kp.test/api/health"), env, ctx);
  await ctx.drain();
  const raw = env.DB._db;
  const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const add = (sql, rows) => {
    const st = raw.prepare(sql);
    for (const r of rows) st.run(...r);
  };
  add("INSERT INTO error_log (id, stack, created_at) VALUES (?,?,?)", [
    ...Array.from({ length: 400 }, (_, i) => [`old${i}`, "boom", iso(30)]),
    [`new0`, "fresh", iso(0)],
  ]);
  add("INSERT INTO devices (token, user_id, updated_at) VALUES (?,?,?)", [
    ...Array.from({ length: 400 }, (_, i) => [`dead${i}`, `u${i}`, iso(400)]),
    [`live0`, "u-live", iso(0)],
  ]);
  add(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)",
    Array.from({ length: 400 }, (_, i) => [`h${i}`, `u${i}`, iso(400), iso(400)]),
  );
  add("INSERT INTO typing (conv_id, user_id, at) VALUES (?,?,?)", [
    ...Array.from({ length: 400 }, (_, i) => [`c${i}`, `u${i}`, iso(9)]),
    ["c-live", "u-live", iso(0)],
  ]);
  add(
    "INSERT INTO statuses (id, user_id, kind, media, created_at, expires_at) VALUES (?,?,?,?,?,?)",
    [
      ...Array.from({ length: 400 }, (_, i) => [`s${i}`, `u${i}`, "TEXT", "m", iso(9), iso(9)]),
      ["s-live", "u-live", "TEXT", "m", iso(0), iso(0)],
    ],
  );
  add(
    "INSERT INTO calls (id, caller_id, callee_id, kind, status, created_at) VALUES (?,?,?,?,?,?)",
    [
      ...Array.from({ length: 400 }, (_, i) => [`done${i}`, "a", "b", "audio", "ENDED", iso(9)]),
      ["stale1", "a", "b", "audio", "RINGING", iso(1)],
      ["fresh1", "a", "b", "audio", "RINGING", iso(0)],
    ],
  );
  return { mod, env, ctx, db: env.DB, raw };
}

const plan = (raw, sql, ...bind) =>
  raw
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...bind.map(() => new Date().toISOString()))
    .map((r) => r.detail)
    .join(" | ");

// ------------------------------------------------------- 1. query shape: no full scans
{
  const { raw } = await seeded();
  for (const [table, sql] of CLEANUP) {
    const p = plan(raw, sql, "2026-09-01T00:00:00.000Z");
    check(
      `${table}: cleanup statement seeks on an index, no SCAN`,
      /USING (INDEX|COVERING INDEX)/.test(p) && !new RegExp(`SCAN ${table}\\b`).test(p),
      p,
    );
  }
  // The names themselves, because a rename would otherwise only show up as a plan
  // change on the one platform whose planner we can see.
  for (const idx of [
    "idx_calls_status_created ON calls(status, created_at)",
    "idx_errorlog_created ON error_log(created_at)",
    "idx_devices_updated ON devices(updated_at)",
    "idx_sessions_expires ON sessions(expires_at)",
    "idx_typing_at ON typing(at)",
    "idx_statuses_expires ON statuses(expires_at)",
  ]) {
    check(
      `ensureSchema creates ${idx.split(" ON ")[0]}`,
      src.includes(`CREATE INDEX IF NOT EXISTS ${idx}`),
    );
  }
  const created = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
    .all()
    .map((r) => r.name);
  check(
    "and they really exist after ensureSchema ran",
    ["idx_calls_status_created", "idx_errorlog_created", "idx_devices_updated"].every((i) =>
      created.includes(i),
    ),
    JSON.stringify(created),
  );
}

// --------------------------------------------------------- 2. cadence: once per day
{
  const { mod, env, ctx, db } = await seeded();
  const seen = [];
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    seen.push(sql);
    return realPrepare(sql);
  };

  await mod.default.scheduled({ noRetryIfBusy: true }, env, ctx);
  await ctx.drain();
  const first = [...seen];
  check(
    "the first tick of the day prunes error_log",
    first.some((s) => /DELETE FROM error_log WHERE created_at < \?/.test(s)),
  );
  check(
    "and devices, and the marker is written as a gauge",
    first.some((s) => /DELETE FROM devices WHERE updated_at < \?/.test(s)) &&
      /ON CONFLICT\(day, key\) DO UPDATE SET value = excluded\.value/.test(src),
  );

  // Age, not a row count: the cron's own path legitimately writes a fresh
  // `error_log` row (a failed push for the call it just reaped), so "how many rows are
  // left" is not the invariant. "nothing older than the window survives, and nothing
  // younger is lost" is.
  const isoOld = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const countOld = (table, col, days) =>
    db._db.prepare(`SELECT count(*) AS c FROM ${table} WHERE ${col} < ?`).get(isoOld(days)).c;
  const afterFirst = {
    errors: countOld("error_log", "created_at", 7),
    devices: countOld("devices", "updated_at", 60),
    keptErrors: db._db.prepare("SELECT count(*) AS c FROM error_log WHERE id = 'new0'").get().c,
    keptDevices: db._db.prepare("SELECT count(*) AS c FROM devices WHERE token = 'live0'").get().c,
    marker: db._db
      .prepare("SELECT value FROM metrics_daily WHERE day = ? AND key = 'prune.done'")
      .get(day)?.value,
  };
  check(
    "every row past the 7-day error window is gone",
    afterFirst.errors === 0,
    `still=${afterFirst.errors}`,
  );
  check(
    "every device past the 60-day window is gone",
    afterFirst.devices === 0,
    `still=${afterFirst.devices}`,
  );
  check(
    "and neither prune touched a row inside its window",
    afterFirst.keptErrors === 1 && afterFirst.keptDevices === 1,
    JSON.stringify(afterFirst),
  );
  check(
    "the day carries a prune marker worth exactly 1",
    afterFirst.marker === 1,
    `marker=${afterFirst.marker}`,
  );

  seen.length = 0;
  await mod.default.scheduled({ noRetryIfBusy: true }, env, ctx);
  await ctx.drain();
  const second = [...seen];
  check(
    "a second tick the same day issues no age-based DELETE at all",
    !second.some((s) => /DELETE FROM (error_log|devices)/.test(s)),
    JSON.stringify(second.filter((s) => /DELETE/.test(s))),
  );
  check(
    "and the marker read is the only thing the prune path costs",
    second.filter((s) => /key = \?/.test(s) || /metrics_daily WHERE day = \?/.test(s)).length === 1,
    `statements=${second.length}`,
  );
  check(
    "the marker value never accumulates to 2",
    db._db.prepare("SELECT value FROM metrics_daily WHERE day = ? AND key = 'prune.done'").get(day)
      ?.value === 1,
  );

  // The whole point of keeping the reap per-tick: a call must still become MISSED
  // promptly even on a tick that skips the prunes.
  check(
    "the stale-RINGING reap still runs on a non-prune tick",
    second.some((s) => /FROM calls WHERE status = 'RINGING'/.test(s)) &&
      db._db.prepare("SELECT status FROM calls WHERE id = 'stale1'").get().status === "MISSED",
    db._db.prepare("SELECT status FROM calls WHERE id = 'stale1'").get().status,
  );
  check(
    "a call that is not stale is left alone by the reap",
    db._db.prepare("SELECT status FROM calls WHERE id = 'fresh1'").get().status === "RINGING",
  );
}

// ------------------------------------------------- 3. the shape that caused the outage
{
  const cron = src.slice(src.indexOf("async scheduled("), src.indexOf("async scheduled(") + 4000);
  check(
    "scheduled() has no inline age-based DELETE: cleanup lives behind the marker",
    !/DELETE FROM (error_log|devices|sessions|typing|statuses)/.test(cron),
  );
  check(
    "pruneAgedRows is exported and used by the cron",
    /export async function pruneAgedRows/.test(src) && /await pruneAgedRows\(env\.DB,/.test(cron),
  );
  check(
    "a failed prune cannot skip the rollups or the probe (own try, own log tag)",
    cron.indexOf("cron_prune_error") > cron.indexOf("cron_metrics_error"),
  );
  check("the log distinguishes 'nothing to prune' from 'did not run'", /pruneRan,/.test(cron));
  const logBody = cron.slice(cron.indexOf('"cron_reap"'), cron.indexOf('"cron_reap"') + 400);
  const payload = logBody.slice(logBody.indexOf("{") + 1, logBody.indexOf("})"));
  const keys = payload
    .split(",")
    .map((k2) => k2.split(":")[0].trim())
    .filter(Boolean);
  check(
    "the cron log carries counts only, never a stack, token or row body (§52)",
    keys.join("|") === "reaped|pruneRan|pruned|devices|metrics|lat" &&
      !/stack|token|sdp|body|text/.test(payload),
    JSON.stringify(keys),
  );
  check(
    "the marker is written through the gauge helper, never the counter helper",
    !/counterUpsert\([^)]*PRUNE_MARKER/.test(src),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
