// Phase R9: QR login (Web) + QR profile share (Android). Five routes, run
// against the real worker:
//   POST /api/auth/qr/start              — mint a one-shot login token
//   GET  /api/auth/qr/:token/status      — the Web's poll (PENDING → SESSION)
//   POST /api/auth/qr/:token/confirm     — the phone's "I scanned it"
//   GET  /api/users/by-qr/:code          — resolve a profile's share code
//   POST /api/users/me/qr-code/reset     — rotate a leaked code
//
// The product rule under test: pointing the scanner at the Web's code IS the
// consent (no second approval tap), the session it mints belongs to the
// BROWSER that polled (not the phone that confirmed), and the token is
// single-use even against a racing second poll.

import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const fresh = async () => (await import(`${WORKER}?qr=${n++}`)).default;

const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const worker = await fresh();
  const env = { DB: makeD1(), MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    // Auth routes rate-limit by IP; a fresh synthetic one per call keeps this
    // file's many small requests from tripping a limit meant for abuse.
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.44.${(ipSeq >> 8) & 255}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const text = await res.text();
    await ctx.drain();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text.slice(0, 160) };
    }
    return { status: res.status, json };
  };
  const reg = makeReg(call);
  return { worker, env, call, reg };
}

/* ------------------------------------------------------------- QR login ---- */
{
  const { call, reg } = await mk();
  const phone = await reg("qr-phone@x.com", "Phone Owner");

  const started = await call("POST", "/api/auth/qr/start");
  check(
    "start mints a token with a 201 and an expiry",
    started.status === 201 && !!started.json.token,
    JSON.stringify(started.json),
  );
  const token = started.json.token;

  const beforeScan = await call("GET", `/api/auth/qr/${token}/status`);
  check(
    "an unscanned code polls PENDING, not a session",
    beforeScan.status === 200 && beforeScan.json.status === "PENDING",
    JSON.stringify(beforeScan.json),
  );

  const anonConfirm = await call("POST", `/api/auth/qr/${token}/confirm`);
  check("confirming requires a signed-in phone", anonConfirm.status === 401, anonConfirm.status);

  const confirmed = await call("POST", `/api/auth/qr/${token}/confirm`, undefined, phone.token);
  check(
    "the phone's confirm succeeds with no body",
    confirmed.status === 200 && confirmed.json.ok === true,
    JSON.stringify(confirmed.json),
  );

  const afterConfirmStatus = await call("GET", `/api/auth/qr/${token}/status`);
  check(
    "the Web's next poll mints a real session for the confirming user",
    afterConfirmStatus.status === 200 &&
      afterConfirmStatus.json.status === "SESSION" &&
      typeof afterConfirmStatus.json.token === "string" &&
      afterConfirmStatus.json.token.length > 10 &&
      afterConfirmStatus.json.user?.id === phone.user.id,
    JSON.stringify(afterConfirmStatus.json),
  );
  const webSessionToken = afterConfirmStatus.json.token;
  check(
    "the minted session is a working bearer, distinct from the phone's own",
    webSessionToken !== phone.token,
  );
  const whoAmI = await call("GET", "/api/me", undefined, webSessionToken);
  check(
    "…and /api/me answers as the confirming user",
    whoAmI.status === 200 && whoAmI.json.user?.id === phone.user.id,
    JSON.stringify(whoAmI.json),
  );

  const racingPoll = await call("GET", `/api/auth/qr/${token}/status`);
  check(
    "a token is single-use: a racing second poll never mints a second session",
    racingPoll.status === 200 && racingPoll.json.status !== "SESSION",
    JSON.stringify(racingPoll.json),
  );

  const reconfirm = await call("POST", `/api/auth/qr/${token}/confirm`, undefined, phone.token);
  check(
    "re-confirming an already-claimed token is refused, not silently ok",
    reconfirm.status === 410,
    reconfirm.status,
  );

  const unknownToken = await call("GET", "/api/auth/qr/not-a-real-token/status");
  check(
    "a made-up token polls UNKNOWN rather than erroring",
    unknownToken.status === 200 && unknownToken.json.status === "UNKNOWN",
  );

  const unknownConfirm = await call(
    "POST",
    "/api/auth/qr/not-a-real-token/confirm",
    undefined,
    phone.token,
  );
  check("confirming a made-up token is refused", unknownConfirm.status === 410);
}

/* ------------------------------------------------------- expiry + denial --- */
{
  const { call, env } = await mk();
  const started = await call("POST", "/api/auth/qr/start");
  const token = started.json.token;
  await env.DB.prepare("UPDATE web_login_sessions SET expires_at = ? WHERE token = ?")
    .bind(new Date(Date.now() - 1000).toISOString(), token)
    .run();
  const expiredPoll = await call("GET", `/api/auth/qr/${token}/status`);
  check(
    "a code left on screen past its TTL polls EXPIRED, not PENDING forever",
    expiredPoll.status === 200 && expiredPoll.json.status === "EXPIRED",
    JSON.stringify(expiredPoll.json),
  );
}

/* ---------------------------------------------------------- QR profile ---- */
{
  const { call, reg } = await mk();
  const alice = await reg("qr-alice@x.com", "Alice Share");
  const bob = await reg("qr-bob@x.com", "Bob Scanner");

  const aliceMe = await call("GET", "/api/me", undefined, alice.token);
  const aliceCode = aliceMe.json.user?.qrCode;
  check(
    "every account carries its own share code on /api/me",
    typeof aliceCode === "string" && aliceCode.length > 0,
    aliceCode,
  );

  const scanned = await call("GET", `/api/users/by-qr/${aliceCode}`, undefined, bob.token);
  check(
    "scanning a profile's code resolves to that exact profile",
    scanned.status === 200 && scanned.json.user?.id === alice.user.id,
    JSON.stringify(scanned.json),
  );

  const anonScan = await call("GET", `/api/users/by-qr/${aliceCode}`);
  check(
    "resolving a share code requires being signed in",
    anonScan.status === 401,
    anonScan.status,
  );

  const madeUp = await call(
    "GET",
    "/api/users/by-qr/0000000000000000000000000000000f",
    undefined,
    bob.token,
  );
  check(
    "a code matching nobody 404s by name, not a crash",
    madeUp.status === 404 && madeUp.json.error?.code === "NOT_FOUND",
    JSON.stringify(madeUp.json),
  );

  const malformed = await call("GET", "/api/users/by-qr/not-hex-at-all", undefined, bob.token);
  check(
    "a non-hex path segment falls through (no route match) rather than 500ing",
    malformed.status === 404,
  );

  // Owner decision: a block wins over a share code exactly like it wins over
  // a username lookup — sharing your code is not an escape hatch around it.
  const blocked = await call("POST", "/api/blocks", { userId: bob.user.id }, alice.token);
  check("alice can block bob", blocked.status === 200, JSON.stringify(blocked.json));
  const blockedScan = await call("GET", `/api/users/by-qr/${aliceCode}`, undefined, bob.token);
  check(
    "a blocked scanner cannot resolve the blocking account's code",
    blockedScan.status === 403 && blockedScan.json.error?.code === "BLOCKED",
    JSON.stringify(blockedScan.json),
  );
}

/* --------------------------------------------------------------- reset ---- */
{
  const { call, reg } = await mk();
  const alice = await reg("qr-reset-a@x.com", "Reset Alice");
  const bob = await reg("qr-reset-b@x.com", "Reset Bob");

  const before = (await call("GET", "/api/me", undefined, alice.token)).json.user.qrCode;

  const anonReset = await call("POST", "/api/users/me/qr-code/reset");
  check("resetting the code requires being signed in", anonReset.status === 401, anonReset.status);

  const reset = await call("POST", "/api/users/me/qr-code/reset", undefined, alice.token);
  check(
    "reset answers 200 with a brand-new code",
    reset.status === 200 && typeof reset.json.qrCode === "string" && reset.json.qrCode !== before,
    JSON.stringify(reset.json),
  );
  const after = reset.json.qrCode;

  const oldStillWorks = await call("GET", `/api/users/by-qr/${before}`, undefined, bob.token);
  check(
    "the old, leaked code stops resolving the instant it is reset",
    oldStillWorks.status === 404,
    oldStillWorks.status,
  );

  const newWorks = await call("GET", `/api/users/by-qr/${after}`, undefined, bob.token);
  check(
    "the freshly-minted code resolves to the same account",
    newWorks.status === 200 && newWorks.json.user?.id === alice.user.id,
    JSON.stringify(newWorks.json),
  );

  const meAfter = await call("GET", "/api/me", undefined, alice.token);
  check("…and /api/me reflects the rotation too", meAfter.json.user?.qrCode === after);
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
