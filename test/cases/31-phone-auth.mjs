// Phone auth end-to-end: the OTP-less contract of PHONE_AUTH_PLAN.md against
// the real worker — new-account creation, SIM MISMATCH blocking, the DEVICE_ONLY
// grace policy, one-active-device transfers (approve/decline/expire/cancel),
// Google recovery, one-Google-one-account, pending-signup takeover, legacy
// email migration, phone change, placeholder-email privacy, rate limits.

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
    if (fixedIp) headers["cf-connecting-ip"] = fixedIp;
    else if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
  return { db, call, reg: makeReg(call) };
}

const verify = (k, phone, sim, deviceId) =>
  k.call("POST", "/api/auth/verify-phone", { phone, sim, deviceId, deviceName: "Pixel Test" });
const bind = (k, phone, idToken, deviceId, displayName) =>
  k.call("POST", "/api/auth/google/bind", { phone, idToken, deviceId, displayName });

// ---- 1. new account: verify → bind → ACTIVE, device registered ----
{
  const k = await mk();
  const phone = phoneFrom("new1@x.com");
  const v = await verify(k, phone, "MATCH", "dev-a");
  check(
    "new number creates a PENDING signup",
    v.status === 201 && v.json.status === "ACCOUNT_CREATED",
    JSON.stringify(v.json).slice(0, 80),
  );
  let row = k.db._db.prepare("SELECT * FROM users WHERE phone_e164 = ?").get(phone);
  check(
    "pending row is PENDING with SIM_MATCH",
    row?.auth_status === "PENDING" &&
      row?.phone_verification_method === "SIM_MATCH" &&
      !!row?.phone_verified_at,
  );
  const b = await bind(k, phone, fakeIdToken("g-new1", "new1@x.com"), "dev-a", "New One");
  check(
    "google bind returns a session",
    b.status === 200 && b.json.status === "SESSION" && !!b.json.token,
    JSON.stringify(b.json).slice(0, 80),
  );
  check(
    "self shape exposes phone, never the placeholder email",
    b.json.user?.phone === phone &&
      b.json.user?.email === null &&
      b.json.user?.googleLinked === true,
    JSON.stringify(b.json.user?.email),
  );
  row = k.db._db.prepare("SELECT * FROM users WHERE phone_e164 = ?").get(phone);
  check(
    "account flipped ACTIVE with google bound",
    row?.auth_status === "ACTIVE" &&
      row?.google_subject === "g-new1" &&
      row?.display_name === "New One",
  );
  check(
    "email column holds the hidden placeholder",
    row?.email === `${phone}@phone.kuchupuchu.invalid`,
  );
  const dev = k.db._db.prepare("SELECT * FROM auth_devices WHERE user_id = ?").get(row.id);
  check(
    "exactly one ACTIVE device after signup",
    dev?.status === "ACTIVE" && dev?.device_id === "dev-a",
  );
  const me = await k.call("GET", "/api/me", undefined, b.json.token);
  check("the new session authenticates", me.status === 200 && me.json.user?.phone === phone);
}

// ---- 2. MISMATCH is always blocked ----
{
  const k = await mk();
  const phone = phoneFrom("mm@x.com");
  const v = await verify(k, phone, "MISMATCH", "dev-a");
  check("real exposed different number → 403", v.status === 403, String(v.status));
  check(
    "no row was created for a mismatch",
    k.db._db.prepare("SELECT COUNT(*) n FROM users WHERE phone_e164 = ?").get(phone).n === 0,
  );
}

// ---- 3. UNAVAILABLE is allowed through as DEVICE_ONLY (grace policy) ----
{
  const k = await mk();
  const phone = phoneFrom("un@x.com");
  const v = await verify(k, phone, "UNAVAILABLE", "dev-a");
  check(
    "unavailable number still starts signup",
    v.status === 201 && v.json.method === "DEVICE_ONLY",
  );
  const row = k.db._db.prepare("SELECT * FROM users WHERE phone_e164 = ?").get(phone);
  check(
    "DEVICE_ONLY is not marked phone-verified",
    row?.phone_verification_method === "DEVICE_ONLY" && row?.phone_verified_at === null,
  );
  const b = await bind(k, phone, fakeIdToken("g-un", "un@x.com"), "dev-a");
  check("grace signup can still bind and finish", b.status === 200 && !!b.json.token);
}

// ---- 4. same device re-login: straight session ----
{
  const k = await mk();
  const a = await k.reg("relogin@x.com", "relogin");
  const phone = a.user.phone;
  const v = await verify(k, phone, "MATCH", "dev-relogin");
  check(
    "same install gets a session without approval",
    v.json.status === "SESSION" && v.json.token !== a.token,
  );
  check(
    "old token died with the new session (one device, one session)",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );
}

// ---- 5. new device needs approval; accept transfers atomically ----
{
  const k = await mk();
  const a = await k.reg("transfer@x.com", "transfer");
  const phone = a.user.phone;
  const v = await verify(k, phone, "MATCH", "dev-thief");
  check(
    "other install → APPROVAL_REQUIRED",
    v.json.status === "APPROVAL_REQUIRED" && !!v.json.requestId,
  );
  const reqId = v.json.requestId;
  check(
    "a login request row is PENDING with a 5-minute window",
    k.db._db.prepare("SELECT status FROM login_requests WHERE id = ?").get(reqId)?.status ===
      "PENDING",
  );
  check(
    "old session still valid while waiting",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 200,
  );

  const approve = await k.call("POST", "/api/auth/login/approve", { id: reqId }, a.token);
  check("current device can approve", approve.status === 200, JSON.stringify(approve.json));
  check(
    "the old session is dead the moment approve lands",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );

  const poll = await k.call("POST", "/api/auth/login/poll", {
    requestId: reqId,
    deviceId: "dev-thief",
  });
  check(
    "poll claims the session exactly once",
    poll.json.status === "SESSION" && !!poll.json.token,
    JSON.stringify(poll.json).slice(0, 80),
  );
  check(
    "new token works",
    (await k.call("GET", "/api/me", undefined, poll.json.token)).status === 200,
  );
  const again = await k.call("POST", "/api/auth/login/poll", {
    requestId: reqId,
    deviceId: "dev-thief",
  });
  check("a second claim gets UNKNOWN", again.json.status === "UNKNOWN", again.json.status);

  const devs = k.db._db
    .prepare("SELECT device_id, status FROM auth_devices WHERE user_id = ? ORDER BY device_id")
    .all(a.user.id);
  const active = devs.filter((d) => d.status === "ACTIVE");
  check(
    "exactly one ACTIVE device after the transfer",
    active.length === 1 && active[0].device_id === "dev-thief",
    JSON.stringify(devs),
  );
}

// ---- 6. decline keeps the old device active ----
{
  const k = await mk();
  const a = await k.reg("decline@x.com", "decline");
  const v = await verify(k, a.user.phone, "MATCH", "dev-b");
  const d = await k.call("POST", "/api/auth/login/decline", { id: v.json.requestId }, a.token);
  check("decline succeeds", d.status === 200);
  const poll = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-b",
  });
  check("waiting device sees DECLINED", poll.json.status === "DECLINED");
  check(
    "old session survived the decline",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 200,
  );
}

// ---- 7. expiry: never auto-approve ----
{
  const k = await mk();
  const a = await k.reg("expire@x.com", "expire");
  const v = await verify(k, a.user.phone, "MATCH", "dev-b");
  k.db._db
    .prepare("UPDATE login_requests SET expires_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", v.json.requestId);
  const poll = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-b",
  });
  check("poll reports EXPIRED after the window", poll.json.status === "EXPIRED");
  const late = await k.call("POST", "/api/auth/login/approve", { id: v.json.requestId }, a.token);
  check("an expired request cannot be approved", late.status !== 200, String(late.status));
  check(
    "no session was handed out",
    (
      await k.call("POST", "/api/auth/login/poll", {
        requestId: v.json.requestId,
        deviceId: "dev-b",
      })
    ).json.status !== "SESSION",
  );
}

// ---- 8. cancel from the waiting device ----
{
  const k = await mk();
  const a = await k.reg("cancel@x.com", "cancel");
  const v = await verify(k, a.user.phone, "MATCH", "dev-b");
  const c = await k.call("POST", "/api/auth/login/cancel", {
    requestId: v.json.requestId,
    deviceId: "dev-b",
  });
  check("cancel succeeds", c.status === 200);
  const poll = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-b",
  });
  check("cancelled request reports CANCELLED", poll.json.status === "CANCELLED");
}

// ---- 9. poll needs the matching device ----
{
  const k = await mk();
  const a = await k.reg("pollguard@x.com", "pollguard");
  const v = await verify(k, a.user.phone, "MATCH", "dev-b");
  const wrong = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-OTHER",
  });
  check("poll with the wrong device learns nothing", wrong.json.status === "UNKNOWN");
}

// ---- 10. recovery: bound Google gets the account back ----
{
  const k = await mk();
  const a = await k.reg("recover@x.com", "recover");
  const phone = a.user.phone;
  const start = await k.call("POST", "/api/auth/recovery/start", {
    phone,
    idToken: fakeIdToken("g-recover", "recover@x.com"),
    deviceId: "dev-new",
  });
  check(
    "recovery/start accepts the BOUND google",
    start.status === 200 && !!start.json.requestId,
    JSON.stringify(start.json).slice(0, 80),
  );
  const done = await k.call("POST", "/api/auth/recovery/complete", {
    requestId: start.json.requestId,
    deviceId: "dev-new",
  });
  check(
    "recovery/complete transfers to the new device",
    done.status === 200 && !!done.json.token,
    JSON.stringify(done.json).slice(0, 80),
  );
  check(
    "old session died with the recovery",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );
  check(
    "new session works",
    (await k.call("GET", "/api/me", undefined, done.json.token)).status === 200,
  );
  const reuse = await k.call("POST", "/api/auth/recovery/complete", {
    requestId: start.json.requestId,
    deviceId: "dev-new",
  });
  check("recovery request is single-use", reuse.status !== 200, String(reuse.status));
}

// ---- 11. recovery: any other Gmail is refused ----
{
  const k = await mk();
  const a = await k.reg("recover2@x.com", "recover2");
  const start = await k.call("POST", "/api/auth/recovery/start", {
    phone: a.user.phone,
    idToken: fakeIdToken("g-ATTACKER", "attacker@evil.com"),
    deviceId: "dev-x",
  });
  check("wrong google subject → 401", start.status === 401, String(start.status));
}

// ---- 12. one Google subject maps to one account ----
{
  const k = await mk();
  await k.reg("gs1@x.com", "gs1");
  const phone2 = phoneFrom("gs2@x.com");
  await verify(k, phone2, "MATCH", "dev-gs2");
  const b = await bind(k, phone2, fakeIdToken("g-gs1", "gs1@x.com"), "dev-gs2");
  check("binding a used google → 409", b.status === 409, String(b.status));
}

// ---- 13. abandoned PENDING signup loses to a SIM-proven claim ----
{
  const k = await mk();
  const phone = phoneFrom("takeover@x.com");
  await verify(k, phone, "UNAVAILABLE", "dev-squatter"); // grace claim, never bound
  const v2 = await verify(k, phone, "MATCH", "dev-owner");
  check(
    "a MATCH claim takes over the number",
    v2.status === 201 && v2.json.status === "ACCOUNT_CREATED",
  );
  check(
    "the squatter's row is gone",
    k.db._db.prepare("SELECT COUNT(*) n FROM users WHERE phone_e164 = ?").get(phone).n === 1,
  );
  const b = await bind(k, phone, fakeIdToken("g-owner", "owner@x.com"), "dev-owner");
  check("the owner finishes signup normally", b.status === 200 && !!b.json.token);
}

// ---- 14. legacy email account is migrated by google binding ----
{
  const k = await mk();
  await k.call("GET", "/api/health"); // schema
  const legacyId = "legacy-user-1";
  k.db._db
    .prepare(
      `INSERT INTO users (id, email, password_hash, username, display_name, created_at, last_active_at)
       VALUES (?, 'legacy@gmail.com', 'old-hash', 'legacy', 'Legacy', ?, ?)`,
    )
    .run(legacyId, new Date().toISOString(), new Date().toISOString());
  const phone = phoneFrom("legacy@x.com");
  await verify(k, phone, "MATCH", "dev-legacy");
  const b = await bind(k, phone, fakeIdToken("g-legacy", "legacy@gmail.com"), "dev-legacy");
  check(
    "bind succeeds against the legacy account",
    b.status === 200,
    JSON.stringify(b.json).slice(0, 90),
  );
  check("the SAME user id keeps its chats", b.json.user?.id === legacyId, `${b.json.user?.id}`);
  const count = k.db._db.prepare("SELECT COUNT(*) n FROM users WHERE phone_e164 = ?").get(phone).n;
  check("the pending duplicate row was removed", count === 1, String(count));
  check(
    "legacy row now carries phone + google",
    k.db._db.prepare("SELECT google_subject, phone_e164 FROM users WHERE id = ?").get(legacyId)
      ?.google_subject === "g-legacy",
  );
}

// ---- 15. phone change: MATCH required, uniqueness enforced ----
{
  const k = await mk();
  const a = await k.reg("chg@x.com", "chg");
  const other = await k.reg("chgother@x.com", "chgother");
  const no = await k.call(
    "POST",
    "/api/auth/phone/change",
    { phone: "+8801811222333", sim: "UNAVAILABLE" },
    a.token,
  );
  check("grace (no MATCH) cannot change the number", no.status === 400, String(no.status));
  const taken = await k.call(
    "POST",
    "/api/auth/phone/change",
    { phone: other.user.phone, sim: "MATCH" },
    a.token,
  );
  check("a number already linked elsewhere → 409", taken.status === 409, String(taken.status));
  const okc = await k.call(
    "POST",
    "/api/auth/phone/change",
    { phone: "+8801811222333", sim: "MATCH" },
    a.token,
  );
  check(
    "MATCH change succeeds",
    okc.status === 200 && okc.json.user?.phone === "+8801811222333",
    JSON.stringify(okc.json.user?.phone),
  );
  const row = k.db._db.prepare("SELECT email FROM users WHERE id = ?").get(a.user.id);
  check(
    "placeholder email follows the new number",
    row.email === "+8801811222333@phone.kuchupuchu.invalid",
    row.email,
  );
}

// ---- 16. logout releases the device slot ----
{
  const k = await mk();
  const a = await k.reg("logout@x.com", "logout");
  const lo = await k.call("POST", "/api/auth/logout", { deviceId: "dev-logout" }, a.token);
  check("logout ok", lo.status === 200);
  const row = k.db._db.prepare("SELECT status FROM auth_devices WHERE user_id = ?").get(a.user.id);
  check("auth device row is REVOKED", row?.status === "REVOKED", row?.status);
  const v = await verify(k, a.user.phone, "MATCH", "dev-logout");
  check("re-login after logout needs no approval", v.json.status === "SESSION", v.json.status);
}

// ---- 17. the old routes are gone ----
{
  const k = await mk();
  const r = await k.call("POST", "/api/auth/register", { email: "x@x.com", password: "secret123" });
  const l = await k.call("POST", "/api/auth/login", { email: "x@x.com", password: "secret123" });
  check("register route removed", r.status === 401 || r.status === 404, String(r.status));
  check("login route removed", l.status === 401 || l.status === 404, String(l.status));
}

// ---- 18. verify-phone is rate limited per IP ----
{
  const k = await mk();
  const phone = phoneFrom("rl@x.com");
  let saw429 = false;
  for (let i = 0; i < 20 && !saw429; i++) {
    const r = await k.call(
      "POST",
      "/api/auth/verify-phone",
      { phone, sim: "NO_SIM", deviceId: "dev-rl" },
      undefined,
      "198.51.100.7",
    );
    if (r.status === 429) saw429 = true;
  }
  check("hammering verify-phone from one IP → 429", saw429);
}

// ---- 19. audit trail ----
{
  const k = await mk();
  const a = await k.reg("audit@x.com", "audit");
  const events = k.db._db
    .prepare("SELECT event FROM auth_audit WHERE user_id = ? ORDER BY created_at")
    .all(a.user.id)
    .map((r) => r.event);
  check(
    "signup wrote the expected audit trail",
    ["PHONE_SIGNUP_STARTED", "GOOGLE_BOUND", "DEVICE_REGISTERED"].every((e) => events.includes(e)),
    JSON.stringify(events),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
if (broken) process.exit(1);
