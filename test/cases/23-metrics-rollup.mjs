// §52 observability, and the constraint that shapes it: D1 bills row READS. These
// tests run the REAL rollup against the sqlite shim — including its two promises:
// cost proportional to new rows (not to table size), and no double-counting when a
// run repeats.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const fresh = async () => await import(`${WORKER}?v=${n++}`);

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const mod = await fresh();
  const env = { DB: makeD1(), MEDIA: makeR2() };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith("/api/auth/register"))
      headers["cf-connecting-ip"] = `203.9.${(ipSeq >> 8) & 255}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await mod.default.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { raw: t };
    }
    return { status: res.status, j };
  };
  const reg = async (tag) => {
    const r = await call("POST", "/api/auth/register", {
      email: `${tag}@x.com`,
      password: "secret123",
      username: tag,
      displayName: tag,
    });
    if (!r.j.user) throw new Error(`register ${tag} failed: ${JSON.stringify(r.j).slice(0, 200)}`);
    return { id: r.j.user.id, token: r.j.token };
  };
  return { mod, env, ctx, call, reg, db: env.DB };
}

const val = async (db, day, key) => {
  const r = await db
    .prepare("SELECT value FROM metrics_daily WHERE day = ? AND key = ?")
    .bind(day, key)
    .first();
  return r?.value ?? null;
};

const today = new Date().toISOString().slice(0, 10);

{
  const { mod, db, call, reg } = await mk();
  const a = await reg("kpa");
  const b = await reg("kpb");
  const conv = await call("POST", "/api/conversations", { userId: b.id }, a.token);
  const convId = conv.j.id || conv.j.conversation?.id;
  check("fixture: 1:1 conversation created", !!convId, JSON.stringify(conv.j).slice(0, 140));

  // A first rollup on a database that already has rows must NOT scan history.
  const first = await mod.rollupMetrics(db);
  const rows0 = await db.prepare("SELECT COUNT(*) c FROM metrics_daily").first();
  const wm0 = await db.prepare("SELECT source, hi FROM metrics_wm ORDER BY source").all();
  check(
    "a first run sets watermarks without backfilling history",
    (await val(db, today, "msg.sent")) === null,
    `msg.sent=${await val(db, today, "msg.sent")}`,
  );
  check(
    "a first run writes only the gauge row",
    rows0.c === 1,
    `rows=${rows0.c} (touched ${first})`,
  );
  check("one watermark per source table", wm0.results.length === 3, JSON.stringify(wm0.results));

  for (const [i, who] of [
    [1, a],
    [2, a],
    [3, b],
  ]) {
    const r = await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { clientId: `c${i}`, body: `m${i}` },
      who.token,
    );
    if (i === 1)
      check(
        "fixture: sends accepted",
        r.status === 200 || r.status === 201,
        JSON.stringify(r.j).slice(0, 140),
      );
  }
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at) VALUES ('m_img','x','y','IMAGE','p',?)",
    )
    .bind(nowIso)
    .run();

  const touched = await mod.rollupMetrics(db);
  check(
    "msg.sent counts exactly the new rows",
    (await val(db, today, "msg.sent")) === 4,
    `got ${await val(db, today, "msg.sent")}`,
  );
  check(
    "msg.media counts by kind, not by guessing",
    (await val(db, today, "msg.media")) === 1,
    `got ${await val(db, today, "msg.media")}`,
  );
  check(
    "msg.text is the complement",
    (await val(db, today, "msg.text")) === 3,
    `got ${await val(db, today, "msg.text")}`,
  );
  check(
    "touched counts (day,key) rows written, not events",
    touched >= 4 && touched <= 12,
    String(touched),
  );

  // The promise that matters most: a repeated run (a retry after a partial failure,
  // a second cron tick inside the same minute, a redeploy) must not recount.
  const again = await mod.rollupMetrics(db);
  check(
    "a second run with nothing new adds no counters",
    (await val(db, today, "msg.sent")) === 4,
    `got ${await val(db, today, "msg.sent")}`,
  );
  const wm1 = await db.prepare("SELECT hi FROM metrics_wm WHERE source = 'messages'").first();
  const maxRow = await db.prepare("SELECT MAX(rowid) m FROM messages").first();
  check(
    "the watermark sits exactly on the last counted row",
    Number(wm1.hi) === Number(maxRow.m),
    `${wm1.hi} vs ${maxRow.m}`,
  );
  check("…and only the gauge is rewritten when idle", again === 1, `touched=${again}`);

  // Cost: an idle rollup stays a handful of statements whatever the table sizes.
  db._stats.reset();
  await mod.rollupMetrics(db);
  check(
    "an idle rollup costs ≤ 6 statements total",
    db._stats.reads + db._stats.writes <= 6,
    `r=${db._stats.reads} w=${db._stats.writes}`,
  );
  check(
    "…and at most one read per source (nothing else is scanned)",
    db._stats.reads <= 5,
    `reads=${db._stats.reads}`,
  );

  // A row stamped yesterday belongs to yesterday, not to the run's clock.
  const y = new Date(Date.now() - 36 * 3600e3).toISOString();
  await db
    .prepare(
      "INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at) VALUES ('m_old','x','y','TEXT','p',?)",
    )
    .bind(y)
    .run();
  await mod.rollupMetrics(db);
  const yDay = y.slice(0, 10);
  check(
    "a day's rows are bucketed by the row's own timestamp",
    (await val(db, yDay, "msg.sent")) === 1,
    `got ${await val(db, yDay, "msg.sent")} for ${yDay}`,
  );
  check(
    "…without disturbing today's counter",
    (await val(db, today, "msg.sent")) === 4,
    `got ${await val(db, today, "msg.sent")}`,
  );

  // Two windows on the SAME day must add up (this is what `value = value + excluded`
  // is for; a gauge-style replace would silently report only the last hour).
  const before = await val(db, today, "msg.sent");
  for (const [i, who] of [
    [10, a],
    [11, a],
  ]) {
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { clientId: `z${i}`, body: `late${i}` },
      who.token,
    );
  }
  await mod.rollupMetrics(db);
  const after = await val(db, today, "msg.sent");
  check(
    "a later window on the same day adds to the day, it does not replace it",
    after === before + 2,
    `${before} -> ${after}`,
  );

  // Calls and error breadcrumbs.
  await db
    .prepare(
      "INSERT INTO calls (id, conv_id, caller_id, callee_id, kind, status, started_at, ended_at, created_at) VALUES ('c1','x','y','z','VOICE','ENDED',?,?,?)",
    )
    .bind(
      new Date(Date.now() + 4000).toISOString(),
      new Date(Date.now() + 70_000).toISOString(),
      nowIso,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO calls (id, conv_id, caller_id, callee_id, kind, status, created_at) VALUES ('c2','x','y','z','VOICE','MISSED',?)",
    )
    .bind(nowIso)
    .run();
  await db
    .prepare("INSERT INTO error_log (id, stack, created_at) VALUES ('e1','fcm_diag token=none',?)")
    .bind(nowIso)
    .run();
  await db
    .prepare(
      "INSERT INTO error_log (id, stack, created_at) VALUES ('e2','CLIENT[abcd] push :: ok',?)",
    )
    .bind(nowIso)
    .run();
  await db
    .prepare("INSERT INTO error_log (id, stack, created_at) VALUES ('e3','Error: boom at f',?)")
    .bind(nowIso)
    .run();
  // The dead table: prod still has it, nothing inserts into it any more. Creating it
  // here makes "no metric reads push_fallback" an assertion about the rollup.
  db._db.exec(
    "CREATE TABLE IF NOT EXISTS push_fallback (mid TEXT, user_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (mid, user_id))",
  );
  await db
    .prepare(
      "INSERT INTO push_fallback (mid, user_id, payload_json, created_at) VALUES ('p1','z','{}',?)",
    )
    .bind(nowIso)
    .run();
  await mod.rollupMetrics(db);
  check(
    "call attempts and outcomes roll up",
    (await val(db, today, "call.attempts")) === 2,
    `got ${await val(db, today, "call.attempts")}`,
  );
  check(
    "…connected is separate from attempted",
    (await val(db, today, "call.connected")) === 1,
    `got ${await val(db, today, "call.connected")}`,
  );
  check(
    "…missed is its own signal",
    (await val(db, today, "call.missed")) === 1,
    `got ${await val(db, today, "call.missed")}`,
  );
  check(
    "call setup latency is a SUM (mean derivable; no percentile is faked)",
    (await val(db, today, "call.setup_s")) === 4,
    `got ${await val(db, today, "call.setup_s")}`,
  );
  check(
    "call duration rolls up",
    (await val(db, today, "call.talk_s")) === 66,
    `got ${await val(db, today, "call.talk_s")}`,
  );
  // The fixture's own push attempt also records an `fcm_diag` breadcrumb, so the
  // assertions here are about the partition — nothing lost, nothing double-counted —
  // rather than a hand-counted per-tag total.
  const rowsToday = await val(db, today, "err.rows");
  const pd = await val(db, today, "err.push_diag");
  const ec = await val(db, today, "err.client");
  const ew = await val(db, today, "err.worker");
  check(
    "every breadcrumb of the day is counted exactly once",
    pd + ec + ew === rowsToday,
    `p=${pd} c=${ec} w=${ew} total=${rowsToday}`,
  );
  check("a worker-side FCM diagnosis lands in the push metric", pd >= 1, `got ${pd}`);
  check(
    "client breadcrumbs and worker errors are separate signals",
    ec >= 1 && ew >= 1,
    `c=${ec} w=${ew}`,
  );
  check(
    "the dead push_fallback table is NOT a metric source (its INSERTs were dropped in R32)",
    (await val(db, today, "push.fallback")) === null,
  );

  // Two live push targets and one that has not checked in for 3 days: the gauge is
  // "accounts with a live device", not "rows in devices".
  db._db.exec(
    `DELETE FROM devices;
     INSERT INTO devices (token, user_id, updated_at) VALUES
       ('t1','${a.id}','${nowIso}'),
       ('t2','${b.id}','${nowIso}'),
       ('t3','${b.id}','${new Date(Date.now() - 3 * 864e5).toISOString()}')`,
  );
  await mod.rollupMetrics(db);
  const g1 = await val(db, today, "dev.active24h");
  await mod.rollupMetrics(db);
  const g2 = await val(db, today, "dev.active24h");
  check("the live-device gauge counts distinct users, fresh rows only", g1 === 2, `got ${g1}`);
  check("…and a gauge re-runs by replacement, never by addition", g2 === 2, `got ${g2}`);

  // Bounded growth: 90 days, and never one row per event.
  await db
    .prepare("INSERT INTO metrics_daily (day, key, value) VALUES ('2000-01-01','msg.sent',9)")
    .run();
  await mod.rollupMetrics(db);
  check("pruned days stay pruned", (await val(db, "2000-01-01", "msg.sent")) === null);
  const shape = await db
    .prepare("SELECT COUNT(*) rows, COUNT(DISTINCT day) days FROM metrics_daily")
    .first();
  check(
    "row count stays ~days×keys (no per-event rows)",
    shape.rows <= shape.days * 20,
    JSON.stringify(shape),
  );
  const keys = await db.prepare("SELECT DISTINCT key FROM metrics_daily").all();
  const keyRe = new RegExp("^[a-z]{3,6}[.][a-z_0-9]{2,14}$");
  check(
    "every key is a short metric name — no ids, emails or tokens can leak in",
    keys.results.every((k) => keyRe.test(k.key)),
    JSON.stringify(keys.results.map((k) => k.key)),
  );
  const vals = await db
    .prepare(
      "SELECT value FROM metrics_daily WHERE typeof(value) <> 'real' AND typeof(value) <> 'integer'",
    )
    .all();
  check(
    "every value is a number",
    vals.results.length === 0,
    JSON.stringify(vals.results).slice(0, 80),
  );
}

{
  const mod = await fresh();
  check(
    "rollups are hourly, not every cron tick (this worker's cron runs every minute)",
    mod.shouldRollupMetrics(new Date("2026-09-02T03:00:00Z")) === true,
  );
  check(
    "…minute 1 and minute 59 do nothing",
    !mod.shouldRollupMetrics(new Date("2026-09-02T03:01:00Z")) &&
      !mod.shouldRollupMetrics(new Date("2026-09-02T03:59:00Z")),
  );
  const src = (await import("node:fs")).readFileSync("src/worker/index.ts", "utf8");
  const flat = src.replace(/\s+/g, " ");
  check("the cron only rolls up behind that gate", flat.includes("if (shouldRollupMetrics(mNow))"));
  check(
    "a metrics failure cannot stop the pruning it shares a cron with",
    src.includes("cron_metrics_error"),
  );
  check(
    "counters accumulate, gauges replace",
    (src.match(/DO UPDATE SET value = value \+ excluded\.value/g) || []).length === 1 &&
      (src.match(/DO UPDATE SET value = excluded\.value/g) || []).length === 1,
  );
  check(
    "watermark and counters are written in one batch (no half-applied day)",
    /await db\.batch\(writes\);/.test(src),
  );
  check(
    "both tables are WITHOUT ROWID (flat and cheap)",
    /PRIMARY KEY \(day, key\)\s*\) WITHOUT ROWID/.test(src) &&
      /metrics_wm \(source TEXT PRIMARY KEY, hi INTEGER NOT NULL\) WITHOUT ROWID/.test(src),
  );
  check(
    "the cron creates its own tables (a deployed-but-idle isolate still rolls up)",
    /if \(shouldRollupMetrics\(mNow\)\) \{\s*\/\/[\s\S]{0,600}?await ensureSchema\(env\.DB\);/.test(
      src,
    ),
  );
  check(
    "…but only on the hour: the every-minute cron must not pay 20 DDL statements per tick",
    !/if \(shouldRollupMetrics\(mNow\)\)[\s\S]{0,4000}?\n\s{4}await ensureSchema/.test(src),
  );
  check(
    "no public route serves metrics (nothing to scrape, no quota to spend)",
    !src.includes('"/api/metrics"') && !src.includes("api/stats"),
  );
  check(
    "the rollup is in the cron log line, so 'no data' is itself visible",
    flat.includes("devices: devs?.meta?.changes ?? 0, metrics,"),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
