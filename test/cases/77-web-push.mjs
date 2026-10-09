// Web Push contract (slice H).
//
// The browser doorbell, end to end against the real worker: VAPID-signed
// delivery (RFC 8292), RFC 8291 `aes128gcm` payloads, the subscription
// registry and its cleanup — and the privacy rule the whole slice exists to
// protect: the payload is GENERIC. This case subscribes with a real P-256
// browser-side key pair, intercepts the delivery fetch, then DECRYPTS the
// record with the subscription's own private key and asserts the plaintext is
// exactly the generic doorbell — never the message body, never the sender's
// name. A web doorbell that carried a plaintext preview would be a hole
// straight through the KP1 seal, so that assertion is the heart of the file.
//
// What is pinned against source:
// - the per-user browser cap, the 5xx retirement limit and both TTLs live in
//   `src/worker/index.ts` and are compared here, not re-remembered;
// - the payload is built in exactly ONE place (`webPushToUser`), and this file
//   asserts that place is the only one;
// - the registry is `web_push_subs`, separate from `devices` — the parity plan
//   (§7.4) forbids ever reusing a phone's FCM route as a web subscription, so
//   each registry is asserted NOT to write into the other.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
const here = dirname(fileURLToPath(import.meta.url));
const workerSource = readFileSync(resolve(here, "../../src/worker/index.ts"), "utf8");

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const subtle = globalThis.crypto.subtle;
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const b64urlBytes = (text) => new Uint8Array(Buffer.from(text, "base64url"));
const utf8 = (text) => new TextEncoder().encode(text);

/* ------------------------------------------------------------ crypto sides */

/** The server side's VAPID pair, the way an operator would generate it. */
async function makeVapid() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(b64urlBytes(jwk.x), 1);
  raw.set(b64urlBytes(jwk.y), 33);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, envKey: b64url(pkcs8), raw };
}

/** The browser side of one subscription: a P-256 pair + the 16-byte auth. */
async function makeBrowserSub() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    rawPub: raw,
    authBytes: auth,
    p256dh: b64url(raw),
    auth: b64url(auth),
  };
}

const hkdf = async (ikm, salt, info, bytes) => {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
};

/** The RFC 8291 receiver: decrypt an aes128gcm record with OUR keys. */
async function decryptWebPush(bodyBytes, sub) {
  const salt = bodyBytes.slice(0, 16);
  const idlen = bodyBytes[20];
  const serverPub = bodyBytes.slice(21, 21 + idlen);
  const ciphertext = bodyBytes.slice(21 + idlen);
  const serverKey = await subtle.importKey(
    "raw",
    serverPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: serverKey }, sub.privateKey, 256),
  );
  const info = new Uint8Array([...utf8("WebPush: info"), 0, ...sub.rawPub, ...serverPub]);
  const ikm = await hkdf(ecdh, sub.authBytes, info, 32);
  const cek = await hkdf(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonceB = await hkdf(ikm, salt, utf8("Content-Encoding: nonce\0"), 12);
  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv: nonceB }, aesKey, ciphertext),
  );
  // aes128gcm padding: trailing 0x02 delimiter after zero padding.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  if (padded[end - 1] !== 0x02) throw new Error("missing aes128gcm delimiter");
  return new TextDecoder().decode(padded.slice(0, end - 1));
}

/** Verify the VAPID JWT the way a push service would. */
async function verifyVapidJwt(jwt, vapid) {
  const [head, claims, sig] = jwt.split(".");
  const ok = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    vapid.publicKey,
    b64urlBytes(sig),
    utf8(`${head}.${claims}`),
  );
  return {
    ok,
    header: JSON.parse(Buffer.from(head, "base64url").toString()),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString()),
  };
}

async function main() {
  /* ---------------------------------------------------- source-pinned rules */

  const limit = workerSource.match(/const WEB_PUSH_SUB_LIMIT = (\d+);/)?.[1];
  const failureLimit = workerSource.match(/const WEB_PUSH_FAILURE_LIMIT = (\d+);/)?.[1];
  const ttlMsg = workerSource.match(/const WEB_PUSH_TTL_MESSAGE_S = (\d+);/)?.[1];
  const ttlCall = workerSource.match(/const WEB_PUSH_TTL_CALL_S = (\d+);/)?.[1];
  check("per-user browser cap is 8", limit === "8", String(limit));
  check("5xx retirement limit is 5", failureLimit === "5", String(failureLimit));
  check("message doorbell TTL is 60 s", ttlMsg === "60", String(ttlMsg));
  check("call doorbell TTL is 300 s", ttlCall === "300", String(ttlCall));
  check(
    "the generic payload is built in exactly one place",
    (workerSource.match(/const payload = JSON\.stringify\(silent \? \{ t: kind, s: 1 \}/g) ?? [])
      .length === 1,
  );
  check(
    "the silent flag rides as s:1",
    workerSource.includes("JSON.stringify(silent ? { t: kind, s: 1 } : { t: kind })"),
  );
  check(
    "web subscriptions live in their OWN registry, not devices",
    workerSource.includes("CREATE TABLE IF NOT EXISTS web_push_subs") &&
      workerSource.includes("idx_web_push_user"),
  );

  /* ------------------------------------------------------------- scaffolding */

  const worker = await freshWorker();
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const vapid = await makeVapid();

  // Every delivery this case observes lands here, keyed by endpoint number.
  const captured = [];
  const endpointModes = new Map();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://push.kp.test/")) {
      const which = Number(new URL(url).pathname.split("/").pop());
      captured.push({
        which,
        url,
        headers: init.headers,
        body: new Uint8Array(init.body),
      });
      return new Response("", { status: endpointModes.get(which) ?? 201 });
    }
    return realFetch(input, init);
  };

  try {
    const ctx = makeCtx();
    let ipSeq = 0;
    const call = async (method, path, body, token, extra = {}) => {
      const headers = { "content-type": "application/json", ...(extra.headers ?? {}) };
      if (path.startsWith("/api/auth/"))
        headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
      if (token) headers.authorization = `Bearer ${token}`;
      const init = { method, headers };
      if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
      const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
      const text = await res.text();
      await ctx.drain(); // settle waitUntil work (the deliveries) before asserting
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { _raw: text.slice(0, 80) };
      }
      return { status: res.status, json };
    };
    const reg = makeReg(call);
    const endpointFor = (which) => `https://push.kp.test/sub/${which}`;

    const a = await reg("wpa@x.com", "Web Push Alice");
    const b = await reg("wpb@x.com", "Web Push Bruno");

    /* ----------------------------------------------------- capability gates */

    const unauth = await call("GET", "/api/push/web");
    check(
      "the registry sits behind the session gate",
      unauth.status === 401,
      String(unauth.status),
    );

    const cold = await call("GET", "/api/push/web", undefined, a.token);
    check(
      "no VAPID key configured ⇒ supported:false and no public key",
      cold.status === 200 && cold.json.supported === false && cold.json.publicKey === null,
    );
    const coldSub = await makeBrowserSub();
    const coldPost = await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(1), p256dh: coldSub.p256dh, auth: coldSub.auth },
      a.token,
    );
    check(
      "subscribing without VAPID answers 503",
      coldPost.status === 503,
      String(coldPost.status),
    );

    env.VAPID_PRIVATE_KEY = vapid.envKey;
    const warm = await call("GET", "/api/push/web", undefined, a.token);
    check(
      "configured ⇒ supported:true and the DERIVED public key",
      warm.status === 200 &&
        warm.json.supported === true &&
        warm.json.publicKey === b64url(vapid.raw),
    );

    /* ------------------------------------------------------ subscription rules */

    const badEndpoint = await call(
      "POST",
      "/api/push/web",
      { endpoint: "http://insecure.example/sub", p256dh: coldSub.p256dh, auth: coldSub.auth },
      a.token,
    );
    check(
      "a non-https endpoint is refused",
      badEndpoint.status === 400,
      String(badEndpoint.status),
    );

    const badKeys = await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(1), p256dh: "AAAA", auth: coldSub.auth },
      a.token,
    );
    check("malformed keys are refused", badKeys.status === 400, String(badKeys.status));

    const subA1 = await makeBrowserSub();
    const ok1 = await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(1), p256dh: subA1.p256dh, auth: subA1.auth },
      a.token,
    );
    check("a valid subscription is accepted", ok1.status === 201, String(ok1.status));
    const list1 = await call("GET", "/api/push/web", undefined, a.token);
    check(
      "GET lists only my own subscriptions",
      list1.json.subscriptions.length === 1 &&
        list1.json.subscriptions[0].endpoint === endpointFor(1),
      JSON.stringify(list1.json.subscriptions),
    );

    const subA1renewed = await makeBrowserSub();
    const renew = await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(1), p256dh: subA1renewed.p256dh, auth: subA1renewed.auth },
      a.token,
    );
    const rowsAfterRenew = db._db
      .prepare("SELECT p256dh FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(1));
    check(
      "re-subscribing the same endpoint replaces the row (no duplicate)",
      renew.status === 201 &&
        rowsAfterRenew.length === 1 &&
        rowsAfterRenew[0].p256dh === subA1renewed.p256dh,
    );

    for (let which = 2; which <= 9; which += 1) {
      const sub = await makeBrowserSub();
      await call(
        "POST",
        "/api/push/web",
        { endpoint: endpointFor(which), p256dh: sub.p256dh, auth: sub.auth },
        a.token,
      );
    }
    const capped = db._db
      .prepare("SELECT endpoint FROM web_push_subs WHERE user_id = ? ORDER BY created_at")
      .all(a.user.id);
    check(
      `the ${limit}-browser cap evicts the oldest`,
      capped.length === 8 && !capped.some((row) => row.endpoint === endpointFor(1)),
      `${capped.length} rows`,
    );

    const othersDelete = await call(
      "DELETE",
      "/api/push/web",
      { endpoint: endpointFor(2) },
      b.token,
    );
    check(
      "nobody deletes someone else's subscription",
      othersDelete.status === 404,
      String(othersDelete.status),
    );
    const mineDelete = await call("DELETE", "/api/push/web", { endpoint: endpointFor(2) }, a.token);
    const goneRow = db._db
      .prepare("SELECT endpoint FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(2));
    check(
      "DELETE removes my own row",
      mineDelete.status === 200 && mineDelete.json.ok === true && goneRow.length === 0,
    );

    // Clean the registry back to a single known subscription for delivery tests.
    for (const row of db._db
      .prepare("SELECT endpoint FROM web_push_subs WHERE user_id = ?")
      .all(a.user.id)) {
      await call("DELETE", "/api/push/web", { endpoint: row.endpoint }, a.token);
    }
    const subDelivery = await makeBrowserSub();
    await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(10), p256dh: subDelivery.p256dh, auth: subDelivery.auth },
      a.token,
    );

    /* ------------------------------------------------ the generic-payload gate */

    const conv = await call("POST", "/api/conversations", { userId: a.user.id }, b.token);
    const convId = conv.json.conversation.id;
    const SECRET = "ZEBRA-SECRET-PLAINTEXT-77";
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: SECRET },
      b.token,
    );
    const messagePush = captured.filter((entry) => entry.which === 10);
    check(
      "a message fans out exactly one web doorbell",
      messagePush.length === 1,
      `${messagePush.length} sends`,
    );

    if (messagePush.length === 1) {
      const entry = messagePush[0];
      const authHeader = String(entry.headers.authorization ?? "");
      check(
        "the Authorization header is a WebPush JWT",
        authHeader.startsWith("WebPush "),
        authHeader.slice(0, 20),
      );
      const jwt = await verifyVapidJwt(authHeader.slice("WebPush ".length), vapid);
      check(
        "the VAPID JWT is ES256-signed by the configured key",
        jwt.ok && jwt.header.alg === "ES256",
      );
      check(
        "the JWT audience is the push service's origin",
        jwt.claims.aud === "https://push.kp.test",
        jwt.claims.aud,
      );
      check(
        "the JWT carries a contact subject and a bounded expiry",
        String(jwt.claims.sub).startsWith("mailto:") &&
          jwt.claims.exp > Math.floor(Date.now() / 1000),
      );
      check(
        "the record is aes128gcm with the VAPID key advertised",
        entry.headers["content-encoding"] === "aes128gcm" &&
          String(entry.headers["crypto-key"]).includes(`p256ecdsa=${b64url(vapid.raw)}`),
      );
      check(
        "the message doorbell TTL is the pinned 60 s",
        String(entry.headers.ttl) === ttlMsg,
        String(entry.headers.ttl),
      );
      const plaintext = await decryptWebPush(entry.body, subDelivery);
      check(
        "the payload is EXACTLY the generic doorbell",
        plaintext === '{"t":"kp.msg"}',
        plaintext,
      );
      check("the payload carries no message body", !plaintext.includes(SECRET));
      check("the payload carries no sender name", !plaintext.includes("Web Push Bruno"));
    }

    /* --------------------------------------------------- muted ⇒ silent knock */

    await call("POST", `/api/conversations/${convId}/mute`, { msg: true }, a.token);
    captured.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "muted ping" },
      b.token,
    );
    const mutedPush = captured.filter((entry) => entry.which === 10);
    const mutedText =
      mutedPush.length === 1 ? await decryptWebPush(mutedPush[0].body, subDelivery) : "";
    check(
      "a message-muted chat still knocks, silently (s:1)",
      mutedText === '{"t":"kp.msg","s":1}',
      mutedText,
    );
    await call("POST", `/api/conversations/${convId}/mute`, { msg: false }, a.token);

    /* ------------------------------------------------ hidden ⇒ no knock at all */

    await call("POST", `/api/conversations/${convId}/hide`, { hidden: true }, a.token);
    captured.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "hidden ping" },
      b.token,
    );
    check(
      "a hidden chat gets NO web knock",
      captured.filter((entry) => entry.which === 10).length === 0,
      `${captured.length} sends`,
    );
    await call("POST", `/api/conversations/${convId}/hide`, { hidden: false }, a.token);

    /* ------------------------------------------------------- registry cleanup */

    const subGone = await makeBrowserSub();
    endpointModes.set(11, 410);
    await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(11), p256dh: subGone.p256dh, auth: subGone.auth },
      a.token,
    );
    captured.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "prune me" },
      b.token,
    );
    const prunedRow = db._db
      .prepare("SELECT endpoint FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(11));
    check(
      "a 410 from the push service retires the subscription at once",
      captured.some((entry) => entry.which === 11) && prunedRow.length === 0,
    );

    const subFlaky = await makeBrowserSub();
    endpointModes.set(12, 500);
    await call(
      "POST",
      "/api/push/web",
      { endpoint: endpointFor(12), p256dh: subFlaky.p256dh, auth: subFlaky.auth },
      a.token,
    );
    captured.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "flaky one" },
      b.token,
    );
    const flakyFailures = db._db
      .prepare("SELECT failures FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(12))[0]?.failures;
    check("a 5xx bumps the failure counter", flakyFailures === 1, String(flakyFailures));

    db._db
      .prepare("UPDATE web_push_subs SET failures = ? WHERE endpoint = ?")
      .run(4, endpointFor(12));
    captured.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "flaky last" },
      b.token,
    );
    const retiredRow = db._db
      .prepare("SELECT endpoint FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(12));
    check(
      `the ${failureLimit}th 5xx retires the subscription`,
      captured.some((entry) => entry.which === 12) && retiredRow.length === 0,
    );

    endpointModes.set(10, 201);
    db._db.prepare("UPDATE web_push_subs SET failures = 3 WHERE endpoint = ?").run(endpointFor(10));
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "healing" },
      b.token,
    );
    const healedFailures = db._db
      .prepare("SELECT failures FROM web_push_subs WHERE endpoint = ?")
      .all(endpointFor(10))[0]?.failures;
    check("a success resets the failure counter", healedFailures === 0, String(healedFailures));

    /* --------------------------------------------------------- call doorbells */

    captured.length = 0;
    const startCall = await call(
      "POST",
      "/api/calls",
      { userId: a.user.id, kind: "AUDIO", offerSdp: "v=0\r\n" },
      b.token,
    );
    const callId = startCall.json.call?.id;
    check(
      "the call starts RINGING",
      startCall.status === 201 && startCall.json.call?.status === "RINGING",
    );
    const ringKnocks = captured.filter((entry) => entry.which === 10);
    const ringText =
      ringKnocks.length === 1 ? await decryptWebPush(ringKnocks[0].body, subDelivery) : "";
    check("a RINGING call rings the browser doorbell", ringText === '{"t":"kp.call"}', ringText);
    check("the ring payload names no caller", !ringText.includes("Web Push Bruno"));
    check(
      "the call doorbell TTL is the pinned 300 s",
      ringKnocks.length === 1 && String(ringKnocks[0].headers.ttl) === ttlCall,
      ringKnocks.length === 1 ? String(ringKnocks[0].headers.ttl) : "no knock",
    );

    captured.length = 0;
    // A caller hanging up only counts as a MISSED call once the ring has lived
    // past the anti-phantom window (PHANTOM_RING_MS); backdate the row so the
    // test does not have to sleep it out.
    db._db
      .prepare("UPDATE calls SET created_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 5_000).toISOString(), callId);
    await call("POST", `/api/calls/${callId}/end`, {}, b.token);
    const missedKnocks = captured.filter((entry) => entry.which === 10);
    const missedText =
      missedKnocks.length === 1 ? await decryptWebPush(missedKnocks[0].body, subDelivery) : "";
    check(
      "hanging up on a ring knocks once more: the missed-call doorbell",
      missedText === '{"t":"kp.call"}',
      missedText,
    );
    const missedRow = db._db
      .prepare("SELECT status FROM calls WHERE id = ?")
      .all(callId)[0]?.status;
    check("the row is MISSED", missedRow === "MISSED", String(missedRow));

    /* ------------------------------------------------------- registry isolation */

    await call("POST", "/api/devices", { token: "fcm-token-77" }, a.token);
    const subsAfterFcm = db._db.prepare("SELECT COUNT(*) AS c FROM web_push_subs").all()[0]?.c;
    check(
      "registering an FCM device never creates a web subscription",
      subsAfterFcm === 1,
      String(subsAfterFcm),
    );
    const devicesAfterWeb = db._db
      .prepare("SELECT COUNT(*) AS c FROM devices WHERE token LIKE 'https://push.kp.test%'")
      .all()[0]?.c;
    check(
      "a web subscription never lands in the FCM devices registry",
      devicesAfterWeb === 0,
      String(devicesAfterWeb),
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  for (const line of lines) console.log(line);
  const broken = lines.filter((line) => line.includes("BROKEN")).length;
  process.exitCode = broken ? 1 : 0;
}

main().catch((error) => {
  console.error("77-web-push crashed:", error);
  process.exitCode = 1;
});
