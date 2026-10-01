// Phone auth end-to-end: the OTP-less contract of PHONE_AUTH_PLAN.md against
// the real worker — new-account creation, SIM MISMATCH blocking, the DEVICE_ONLY
// grace policy, one-active-device transfers (approve/decline/expire/cancel),
// Google recovery, one-Google-one-account, pending-signup takeover, legacy
// email migration, phone change, placeholder-email privacy, rate limits.

import { createHmac } from "node:crypto";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, phoneFrom, fakeIdToken } from "../helpers/phoneauth.mjs";

installGoogleStub();
const OTP_SECRET = "local-test-login-otp-hmac-secret-only";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const events = [];
  const env = {
    DB: db,
    MEDIA: makeR2(),
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    LOGIN_OTP_HMAC_SECRET: OTP_SECRET,
    CHAT_ROOM: {
      idFromName: (name) => ({ name }),
      get: (room) => ({
        fetch: async (_url, init) => {
          events.push({ room: room.name, event: JSON.parse(init.body) });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }),
    },
  };
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
  const runScheduled = async () => {
    await worker.scheduled({ noRetryIfBusy: true }, env, ctx);
    await ctx.drain();
  };
  return { db, call, reg: makeReg(call), events, runScheduled };
}

const verify = (k, phone, sim, deviceId, platform) =>
  k.call("POST", "/api/auth/verify-phone", {
    phone,
    sim,
    deviceId,
    deviceName: "Pixel Test",
    ...(platform ? { platform } : {}),
  });
const bind = (k, phone, idToken, deviceId, displayName, platform) =>
  k.call("POST", "/api/auth/google/bind", {
    phone,
    idToken,
    deviceId,
    displayName,
    ...(platform ? { platform } : {}),
  });
const otpHash = (requestId, code) =>
  createHmac("sha256", OTP_SECRET).update(`${requestId}:${code}`).digest("hex");

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
    "approval records consent without signing out the current device",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 200,
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
  check(
    "successful same-platform claim replaces the old session",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
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

// ---- 5a. six-digit OTP is delivered only in the approval card and claims once ----
{
  const k = await mk();
  const a = await k.reg("otp@x.com", "otp");
  const v = await verify(k, a.user.phone, "MATCH", "dev-otp-new");
  check(
    "new-device request advertises OTP without returning the code",
    v.json.otpAvailable === true && !v.json.otp,
  );
  const msg = k.db._db
    .prepare(
      "SELECT * FROM messages WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .get(v.json.requestId);
  const meta = JSON.parse(msg?.meta_json || "{}");
  check(
    "six-digit code exists only in approval-card metadata",
    /^\d{6}$/.test(meta.otp || "") &&
      !msg.body.includes(meta.otp) &&
      !k.db._db
        .prepare("SELECT last_message FROM conversations WHERE id = ?")
        .get(msg.conv_id)
        ?.last_message?.includes(meta.otp),
  );
  check(
    "request stores a keyed verifier, not the plaintext code",
    k.db._db
      .prepare("SELECT otp_hash, otp_attempts FROM login_requests WHERE id = ?")
      .get(v.json.requestId)?.otp_hash === otpHash(v.json.requestId, meta.otp) &&
      k.db._db.prepare("SELECT otp_hash FROM login_requests WHERE id = ?").get(v.json.requestId)
        ?.otp_hash !== meta.otp,
  );
  // Leading zeroes are valid six-digit codes, not an integer to be trimmed.
  const code = "012345";
  k.db._db
    .prepare("UPDATE login_requests SET otp_hash = ?, otp_attempts = 0 WHERE id = ?")
    .run(otpHash(v.json.requestId, code), v.json.requestId);
  k.db._db
    .prepare("UPDATE messages SET meta_json = json_set(meta_json, '$.otp', ?) WHERE id = ?")
    .run(code, msg.id);
  const wrongDevice = await k.call("POST", "/api/auth/login/otp", {
    requestId: v.json.requestId,
    deviceId: "dev-not-otp",
    otp: code,
  });
  check("OTP request is bound to the requested device", wrongDevice.json.status === "UNKNOWN");
  const done = await k.call("POST", "/api/auth/login/otp", {
    requestId: v.json.requestId,
    deviceId: "dev-otp-new",
    otp: code,
  });
  check(
    "correct leading-zero OTP returns a session",
    done.json.status === "SESSION" && !!done.json.token,
  );
  check(
    "new OTP session authenticates",
    (await k.call("GET", "/api/me", undefined, done.json.token)).status === 200,
  );
  check(
    "OTP claim replaces the same-platform old bearer",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );
  const finished = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(msg.id).meta_json,
  );
  const req = k.db._db
    .prepare("SELECT status, otp_hash FROM login_requests WHERE id = ?")
    .get(v.json.requestId);
  check(
    "successful OTP consumes request verifier and redacts the card",
    req.status === "CLAIMED" &&
      req.otp_hash === null &&
      finished.status === "CLAIMED" &&
      !finished.otp,
  );
  const replay = await k.call("POST", "/api/auth/login/otp", {
    requestId: v.json.requestId,
    deviceId: "dev-otp-new",
    otp: code,
  });
  check("a consumed OTP cannot be replayed", replay.json.status === "UNKNOWN");
}

// ---- 5b. five wrong codes disable OTP only; approval remains an alternative ----
{
  const k = await mk();
  const a = await k.reg("otplock@x.com", "otplock");
  const v = await verify(k, a.user.phone, "MATCH", "dev-otp-lock");
  const msg = k.db._db
    .prepare(
      "SELECT * FROM messages WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .get(v.json.requestId);
  const intended = "111111";
  k.db._db
    .prepare("UPDATE login_requests SET otp_hash = ?, otp_attempts = 0 WHERE id = ?")
    .run(otpHash(v.json.requestId, intended), v.json.requestId);
  k.db._db
    .prepare("UPDATE messages SET meta_json = json_set(meta_json, '$.otp', ?) WHERE id = ?")
    .run(intended, msg.id);
  let fifth;
  for (let i = 0; i < 5; i++) {
    fifth = await k.call("POST", "/api/auth/login/otp", {
      requestId: v.json.requestId,
      deviceId: "dev-otp-lock",
      otp: "999999",
    });
  }
  const locked = k.db._db
    .prepare("SELECT status, otp_attempts, otp_hash FROM login_requests WHERE id = ?")
    .get(v.json.requestId);
  const lockedMeta = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(msg.id).meta_json,
  );
  check(
    "fifth incorrect code exhausts OTP",
    fifth?.json.status === "OTP_LOCKED" && locked.otp_attempts === 5,
  );
  check(
    "lockout erases code but leaves request open for approval",
    locked.status === "PENDING" &&
      locked.otp_hash === null &&
      !lockedMeta.otp &&
      lockedMeta.otpLocked === 1,
  );
  const lockUpdate = k.events
    .filter(({ event }) => event.type === "message" && event.message?.id === msg.id)
    .at(-1)?.event.message;
  check(
    "OTP lock broadcasts a redacted card update to connected clients",
    lockUpdate?.meta?.status === "PENDING" &&
      lockUpdate.meta.otpLocked === 1 &&
      !lockUpdate.meta.otp,
  );
  check(
    "current device stays signed in while awaiting approval",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 200,
  );
  const approved = await k.call(
    "POST",
    "/api/auth/login/approve",
    { id: v.json.requestId },
    a.token,
  );
  const claim = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-otp-lock",
  });
  check(
    "approval still succeeds after OTP lockout",
    approved.status === 200 && claim.json.status === "SESSION",
  );
}

// ---- 5c. one Android + one Web session coexist; cross-client approval replaces only its slot ----
{
  const k = await mk();
  const a = await k.reg("platformslots@x.com", "platformslots");
  const phone = a.user.phone;
  const now = new Date().toISOString();
  k.db._db
    .prepare(
      "INSERT INTO devices (token, user_id, updated_at, device_id, platform, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("fcm-android-slot", a.user.id, now, "dev-platformslots", "android", now);

  const webId = "web-browser-one";
  const webReq = await verify(k, phone, "UNAVAILABLE", webId, "WEB");
  check(
    "Web login is platform-tagged and requires approval on a different install",
    webReq.json.status === "APPROVAL_REQUIRED" &&
      k.db._db
        .prepare("SELECT new_device_platform FROM login_requests WHERE id = ?")
        .get(webReq.json.requestId)?.new_device_platform === "WEB",
  );
  const webApproval = await k.call(
    "POST",
    "/api/auth/login/approve",
    { id: webReq.json.requestId },
    a.token,
  );
  const web = await k.call("POST", "/api/auth/login/poll", {
    requestId: webReq.json.requestId,
    deviceId: webId,
  });
  check(
    "Android can approve a Web login",
    webApproval.status === 200 && web.json.status === "SESSION",
  );
  check(
    "first Web claim preserves the Android session",
    (await k.call("GET", "/api/me", undefined, a.token)).status === 200,
  );
  check(
    "Web claim preserves the Android FCM registration",
    !!k.db._db.prepare("SELECT token FROM devices WHERE token = ?").get("fcm-android-slot"),
  );

  const androidReq = await verify(k, phone, "MATCH", "dev-android-two", "ANDROID");
  check(
    "live Web session is an eligible approver without FCM",
    androidReq.json.status === "APPROVAL_REQUIRED" && androidReq.json.deviceGone === false,
  );
  const androidApproval = await k.call(
    "POST",
    "/api/auth/login/approve",
    { id: androidReq.json.requestId },
    web.json.token,
  );
  const android2 = await k.call("POST", "/api/auth/login/poll", {
    requestId: androidReq.json.requestId,
    deviceId: "dev-android-two",
  });
  check(
    "Web can approve a new Android login",
    androidApproval.status === 200 && android2.json.status === "SESSION",
  );
  check(
    "Android replacement leaves Web usable",
    (await k.call("GET", "/api/me", undefined, web.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );

  const webRelogin = await verify(k, phone, "UNAVAILABLE", webId, "WEB");
  check(
    "same Web install replaces only Web without approval",
    webRelogin.json.status === "SESSION",
  );
  check(
    "same-platform Web replacement keeps Android",
    (await k.call("GET", "/api/me", undefined, android2.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, web.json.token)).status === 401,
  );

  const webTwoId = "web-browser-two";
  const webTwoReq = await verify(k, phone, "UNAVAILABLE", webTwoId, "WEB");
  const approvedFromAndroid = await k.call(
    "POST",
    "/api/auth/login/approve",
    { id: webTwoReq.json.requestId },
    android2.json.token,
  );
  const webTwo = await k.call("POST", "/api/auth/login/poll", {
    requestId: webTwoReq.json.requestId,
    deviceId: webTwoId,
  });
  check(
    "a second Web device replaces only the Web slot",
    webTwoReq.json.status === "APPROVAL_REQUIRED" &&
      approvedFromAndroid.status === 200 &&
      webTwo.json.status === "SESSION" &&
      (await k.call("GET", "/api/me", undefined, android2.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, webRelogin.json.token)).status === 401,
  );

  const active = k.db._db
    .prepare("SELECT device_id, platform FROM auth_devices WHERE user_id = ? AND status = 'ACTIVE'")
    .all(a.user.id);
  check(
    "at most one active auth device per platform",
    active.length === 2 &&
      active.filter((d) => d.platform === "ANDROID").length === 1 &&
      active.filter((d) => d.platform === "WEB").length === 1,
    JSON.stringify(active),
  );
  const listed = await k.call("GET", "/api/auth/devices", undefined, webTwo.json.token);
  check(
    "device list exposes both canonical platforms",
    listed.json.items.some((d) => d.platform === "ANDROID") &&
      listed.json.items.some((d) => d.platform === "WEB"),
  );

  const webOut = await k.call(
    "POST",
    "/api/auth/logout",
    { deviceId: "dev-android-two" },
    webTwo.json.token,
  );
  check(
    "Web logout trusts its bearer device, not a supplied Android ID",
    webOut.status === 200 &&
      (await k.call("GET", "/api/me", undefined, android2.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, webTwo.json.token)).status === 401,
  );
  const webThreeReq = await verify(k, phone, "UNAVAILABLE", "web-browser-three", "WEB");
  await k.call(
    "POST",
    "/api/auth/login/approve",
    { id: webThreeReq.json.requestId },
    android2.json.token,
  );
  const webThree = await k.call("POST", "/api/auth/login/poll", {
    requestId: webThreeReq.json.requestId,
    deviceId: "web-browser-three",
  });
  const androidOut = await k.call("POST", "/api/auth/logout", {}, android2.json.token);
  check(
    "Android logout leaves the Web session signed in",
    androidOut.status === 200 &&
      (await k.call("GET", "/api/me", undefined, webThree.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, android2.json.token)).status === 401,
  );
}

// ---- 5d. concurrent OTP/approval and duplicate polls have one side-effect-free winner ----
{
  const k = await mk();
  const a = await k.reg("loginrace@x.com", "loginrace");
  const v = await verify(k, a.user.phone, "MATCH", "dev-login-race");
  const card = k.db._db
    .prepare(
      "SELECT * FROM messages WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .get(v.json.requestId);
  const code = JSON.parse(card.meta_json).otp;
  const [approved, otp] = await Promise.all([
    k.call("POST", "/api/auth/login/approve", { id: v.json.requestId }, a.token),
    k.call("POST", "/api/auth/login/otp", {
      requestId: v.json.requestId,
      deviceId: "dev-login-race",
      otp: code,
    }),
  ]);
  let winner = otp.json.status === "SESSION" ? otp : null;
  if (!winner) {
    const poll = await k.call("POST", "/api/auth/login/poll", {
      requestId: v.json.requestId,
      deviceId: "dev-login-race",
    });
    if (poll.json.status === "SESSION") winner = poll;
  }
  const raceReq = k.db._db
    .prepare("SELECT status, claim_id, otp_hash FROM login_requests WHERE id = ?")
    .get(v.json.requestId);
  check(
    "OTP and approval race returns one final bearer",
    !!winner?.json.token &&
      [200, 409].includes(approved.status) &&
      ["SESSION", "APPROVED", "UNKNOWN"].includes(otp.json.status),
  );
  check(
    "race produces one guarded CLAIMED row and erases OTP",
    raceReq.status === "CLAIMED" && !!raceReq.claim_id && raceReq.otp_hash === null,
  );
  check(
    "race winner authenticates; original same-platform bearer is revoked",
    !!winner?.json.token &&
      (await k.call("GET", "/api/me", undefined, winner.json.token)).status === 200 &&
      (await k.call("GET", "/api/me", undefined, a.token)).status === 401,
  );

  const second = await verify(k, a.user.phone, "MATCH", "dev-poll-race");
  await k.call("POST", "/api/auth/login/approve", { id: second.json.requestId }, winner.json.token);
  const polls = await Promise.all([
    k.call("POST", "/api/auth/login/poll", {
      requestId: second.json.requestId,
      deviceId: "dev-poll-race",
    }),
    k.call("POST", "/api/auth/login/poll", {
      requestId: second.json.requestId,
      deviceId: "dev-poll-race",
    }),
  ]);
  const sessions = polls.filter((r) => r.json.status === "SESSION");
  const others = polls.filter((r) => r.json.status === "UNKNOWN");
  check(
    "two simultaneous polls produce exactly one session result",
    sessions.length === 1 && others.length === 1,
  );
  const dbSessions = k.db._db
    .prepare("SELECT device_id FROM sessions WHERE user_id = ?")
    .all(a.user.id);
  const activeDevices = k.db._db
    .prepare("SELECT device_id FROM auth_devices WHERE user_id = ? AND status = 'ACTIVE'")
    .all(a.user.id);
  check(
    "losing poll leaves no extra session/device side effects",
    dbSessions.length === 1 &&
      dbSessions[0].device_id === "dev-poll-race" &&
      activeDevices.length === 1 &&
      activeDevices[0].device_id === "dev-poll-race",
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
  k.db._db
    .prepare(
      "UPDATE messages SET meta_json = json_set(meta_json, '$.expiresAt', ?) WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .run("2020-01-01T00:00:00.000Z", v.json.requestId);
  const cardRow = k.db._db
    .prepare(
      "SELECT id, conv_id, meta_json FROM messages WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .get(v.json.requestId);
  const rawCode = JSON.parse(cardRow.meta_json).otp;
  const messagePage = await k.call(
    "GET",
    `/api/conversations/${cardRow.conv_id}/messages`,
    undefined,
    a.token,
  );
  const redactedCard = (messagePage.json.items || []).find((item) => item.id === cardRow.id);
  check(
    "message API suppresses an expired code before scheduled cleanup",
    redactedCard?.meta?.status === "EXPIRED" &&
      !redactedCard.meta.otp &&
      JSON.parse(
        k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(cardRow.id).meta_json,
      ).otp === rawCode,
  );
  await k.runScheduled();
  const poll = await k.call("POST", "/api/auth/login/poll", {
    requestId: v.json.requestId,
    deviceId: "dev-b",
  });
  check(
    "scheduled cleanup expires the unattended request; poll reports EXPIRED",
    poll.json.status === "EXPIRED",
  );
  const expiredReq = k.db._db
    .prepare("SELECT status, otp_hash FROM login_requests WHERE id = ?")
    .get(v.json.requestId);
  const expiredCard = k.db._db
    .prepare(
      "SELECT meta_json FROM messages WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?",
    )
    .get(v.json.requestId);
  check(
    "scheduled expiry clears the verifier and card code",
    expiredReq.status === "EXPIRED" &&
      expiredReq.otp_hash === null &&
      !JSON.parse(expiredCard.meta_json).otp,
  );
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
  check(
    "M1: wrong google subject → 404 NO_RECOVERY_TARGET (identical to unknown number)",
    start.status === 404 && start.json?.error?.code === "NO_RECOVERY_TARGET",
    `${start.status} ${start.json?.error?.code}`,
  );
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
  const lo = await k.call(
    "POST",
    "/api/auth/logout",
    { deviceId: "web-not-this-session" },
    a.token,
  );
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

// ---- 19. the approval arrives as a chat message from the official account ----
{
  const k = await mk();
  const a = await k.reg("botmsg@x.com", "botmsg");
  const v = await verify(k, a.user.phone, "MATCH", "dev-b");
  check("approval still required", v.json.status === "APPROVAL_REQUIRED", v.json.status);
  await new Promise((r) => setTimeout(r, 200)); // sendApprovalMessage runs via ctx.waitUntil
  const msg = k.db._db.prepare("SELECT * FROM messages WHERE kind = 'LOGIN_APPROVAL'").get();
  check(
    "LOGIN_APPROVAL message from the official account",
    !!msg && msg.sender_id === "kp_official_bot",
    msg ? `from ${msg.sender_id}` : "none",
  );
  const meta = msg ? JSON.parse(msg.meta_json || "{}") : {};
  check(
    "card meta carries requestId/device/status",
    meta.requestId === v.json.requestId &&
      meta.deviceName === "Pixel Test" &&
      meta.status === "PENDING",
    JSON.stringify(meta).slice(0, 80),
  );
  const unread = k.db._db
    .prepare("SELECT unread FROM members WHERE user_id = ? AND conv_id = ?")
    .get(a.user.id, msg.conv_id);
  check(
    "the approval is unread in the user's chat list",
    unread?.unread >= 1,
    JSON.stringify(unread),
  );

  await k.call("POST", "/api/auth/login/approve", { id: v.json.requestId }, a.token);
  const metaAfter = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(msg.id).meta_json || "{}",
  );
  check(
    "card status flips to APPROVED and its one-time code is cleared",
    metaAfter.status === "APPROVED" &&
      !metaAfter.otp &&
      k.db._db.prepare("SELECT otp_hash FROM login_requests WHERE id = ?").get(v.json.requestId)
        ?.otp_hash === null,
    metaAfter.status,
  );
  const follow = k.db._db
    .prepare(
      "SELECT body FROM messages WHERE conv_id = ? AND kind = 'TEXT' AND sender_id = 'kp_official_bot' ORDER BY created_at DESC LIMIT 1",
    )
    .get(msg.conv_id);
  check(
    "bot posted the outcome message",
    !!follow?.body?.includes("approved"),
    follow?.body?.slice(0, 40),
  );
}

// ---- 20. deviceGone: unreachable previous install → Google path flag ----
{
  const k = await mk();
  const a = await k.reg("gone@x.com", "gone");
  const v1 = await verify(k, a.user.phone, "MATCH", "dev-b");
  check("no push rows → deviceGone true", v1.json.deviceGone === true, String(v1.json.deviceGone));
  k.db._db
    .prepare("INSERT INTO devices (token, user_id, updated_at, last_seen_at) VALUES (?, ?, ?, ?)")
    .run("fcm-live", a.user.id, new Date().toISOString(), new Date().toISOString());
  const v2 = await verify(k, a.user.phone, "MATCH", "dev-c");
  check(
    "fresh handle → deviceGone false",
    v2.json.deviceGone === false,
    String(v2.json.deviceGone),
  );
  k.db._db
    .prepare("UPDATE devices SET last_seen_at = ? WHERE token = ?")
    .run(new Date(Date.now() - 30 * 86_400_000).toISOString(), "fcm-live");
  const v3 = await verify(k, a.user.phone, "MATCH", "dev-d");
  check("stale handle → deviceGone true", v3.json.deviceGone === true, String(v3.json.deviceGone));
}

// ---- 21. audit trail ----
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
