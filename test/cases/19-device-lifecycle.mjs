// §16 push-device lifecycle: one row per install, targeted removal, and a
// sign-out that removes exactly the device that signed out.
//
// The behaviour this case exists for: `DELETE /api/devices` used to be
// `DELETE FROM devices WHERE user_id = ?` (account-wide — logging out of the
// phone in your hand silenced the tablet on your desk), and the app never called
// it at all: KpPush.unregister() only deleted the client-side token, so the
// worker kept pushing at a signed-out account.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const worker = await freshWorker();
  const env = { DB: makeD1(), MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.9.${(ipSeq >> 8) & 255}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
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
  const regByTag = makeReg(call);
  const reg = async (tag) => {
    const r = await regByTag(`${tag}@x.com`, tag);
    if (!r.user) throw new Error(`register ${tag} failed: ${JSON.stringify(r)}`);
    return { user: r.user, token: r.token };
  };
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);
  const devices = async (uid) =>
    (
      await q(
        "SELECT token, user_id, device_id, platform, app_version, last_seen_at, updated_at FROM devices WHERE user_id = ? ORDER BY token",
        uid,
      ).all()
    ).results;
  const register = (token, deviceId, tok, extra = {}) =>
    call(
      "POST",
      "/api/devices",
      { token, deviceId, platform: "android", appVersion: "3.8.19", ...extra },
      tok,
    );
  return { env, ctx, worker, call, reg, q, devices, register };
}

async function main() {
  const h = await mk();
  const A = await h.reg("dev-a");
  const B = await h.reg("dev-b");

  {
    const r = await h.register("tokA1", "dev-1", A.token);
    const rows = await h.devices(A.user.id);
    const row = rows[0] ?? {};
    check(
      "registration stores the install identity, not just the token",
      r.status === 200 &&
        row.device_id === "dev-1" &&
        row.platform === "android" &&
        row.app_version === "3.8.19",
      JSON.stringify(row),
    );
    check(
      "…with a last_seen stamp (what the stale prune keys on)",
      !!row.last_seen_at && row.last_seen_at === row.updated_at,
      JSON.stringify({ s: row.last_seen_at, u: row.updated_at }),
    );
  }

  await h.register("tokA2", "dev-2", A.token);
  {
    const rows = await h.devices(A.user.id);
    check("two installs on one account are two rows", rows.length === 2, `${rows.length}`);
    const d = await h.call("DELETE", "/api/devices?deviceId=dev-1", undefined, A.token);
    const after = await h.devices(A.user.id);
    check(
      "removing one device leaves the other one ALONE (old code deleted both)",
      d.json.removed === 1 && after.length === 1 && after[0].device_id === "dev-2",
      JSON.stringify({ removed: d.json.removed, after: after.map((x) => x.device_id) }),
    );
    await h.register("tokB1", "dev-9", B.token);
    const byToken = await h.q("SELECT user_id FROM devices WHERE token = ?", "tokB1").first();
    check(
      "…and a token that moves between accounts follows the newest login",
      byToken?.user_id === B.user.id,
      JSON.stringify(byToken),
    );
    const aRows = await h.devices(A.user.id);
    check("…without touching the previous owner's rows", aRows.length === 1, `${aRows.length}`);
  }

  {
    // Sign-out carries its own install id, so the row goes in the same request
    // (a separate authenticated DELETE after logout is already a 401).
    await h.register("tokA3", "dev-3", A.token);
    const out = await h.call("POST", "/api/auth/logout", { deviceId: "dev-3" }, A.token);
    const rows = await h.devices(A.user.id);
    check(
      "logout removes the signing-out device's push row",
      out.status === 200 && !rows.some((r) => r.device_id === "dev-3"),
      JSON.stringify(rows.map((r) => r.device_id)),
    );
    check(
      "…and keeps every other device of the same account",
      rows.length === 1 && rows[0].device_id === "dev-2",
      JSON.stringify(rows.map((r) => r.device_id)),
    );
    const me = await h.call("GET", "/api/conversations", undefined, A.token);
    check("…while the session itself is still revoked", me.status === 401, `${me.status}`);
  }

  {
    // A revoked session elsewhere (theft, password reset) must not silence the
    // user's other phones: no deviceId → no device rows touched.
    const C = await h.reg("dev-c");
    await h.register("tokC1", "dev-c1", C.token);
    await h.register("tokC2", "dev-c2", C.token);
    await h.call("POST", "/api/auth/logout", {}, C.token);
    const rows = await h.devices(C.user.id);
    check(
      "logout WITHOUT a deviceId leaves devices alone",
      rows.length === 2,
      JSON.stringify(rows.map((r) => r.device_id)),
    );
    // …and the minute cron prunes installs that stopped checking in.
    await h
      .q(
        "UPDATE devices SET updated_at = ? WHERE token = ?",
        new Date(Date.now() - 61 * 864e5).toISOString(),
        "tokC1",
      )
      .run();
    await h.worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, h.env, h.ctx);
    await h.ctx.drain();
    const after = await h.devices(C.user.id);
    check(
      "the cron prunes a device that has not re-registered in 60 days",
      after.length === 1 && after[0].device_id === "dev-c2",
      JSON.stringify(after.map((r) => r.device_id)),
    );
    check(
      "…without ever deleting a row that re-registered recently",
      after.length === 1 && !!after[0].last_seen_at,
      JSON.stringify(after[0]).slice(0, 120),
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
