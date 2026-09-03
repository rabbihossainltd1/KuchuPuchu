// Phone-auth test plumbing (PHONE_AUTH_PLAN.md §8).
//
// The email/password register route is gone; every case that needs a user now
// drives the real flow: /api/auth/verify-phone (SIM MATCH) →
// /api/auth/google/bind. Two problems that creates are solved HERE, once:
//
//  1. Google ID tokens. The worker verifies them against Google's tokeninfo
//     endpoint. Tests have no network, so installGoogleStub() answers that
//     ONE endpoint for our deterministic fake.<base64url> tokens — the
//     worker's real verification path (aud/iss/exp checks) runs unchanged.
//  2. Phone uniqueness. phoneFrom(seed) hashes any string into a unique valid
//     BD mobile, so tests can keep using emails as their uniqueness seed.

import { createHash } from "node:crypto";

/** Must match GOOGLE_WEB_CLIENT_ID in every case's env object. */
export const TEST_WEB_CLIENT_ID = "kp-test-web-client";

let installed = false;

/** Idempotent global fetch stub for oauth2.googleapis.com/tokeninfo. */
export function installGoogleStub() {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const token = new URL(url).searchParams.get("id_token") ?? "";
      const payload = decodeFake(token);
      if (!payload) return new Response("invalid_token", { status: 400 });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return real(input, init);
  };
}

/** A fake ID token carrying exactly the fields the worker validates. */
export function fakeIdToken(sub, email, overrides = {}) {
  const payload = {
    iss: "https://accounts.google.com",
    aud: TEST_WEB_CLIENT_ID,
    sub,
    email,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  return `fake.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeFake(token) {
  if (!token.startsWith("fake.")) return null;
  try {
    return JSON.parse(Buffer.from(token.slice(5), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Deterministic unique +8801XXXXXXXXX from any seed string. */
export function phoneFrom(seed) {
  const h = createHash("md5").update(String(seed)).digest();
  const second = 3 + (h[0] % 7);
  let rest = "";
  for (let i = 1; i <= 8; i++) rest += String(h[i] % 10);
  return `+8801${second}${rest}`;
}

/**
 * Drop-in for the old register helper. Same (email, username) signature, same
 * { token, user } return — callers do not change. `call` is the case's own
 * request helper (it already handles per-registration client IPs).
 */
export function makeReg(call, opts = {}) {
  return async (e, u) => {
    const phone = opts.phone ?? phoneFrom(e);
    const deviceId = `dev-${u}`;
    const v = await call("POST", "/api/auth/verify-phone", {
      phone,
      sim: "MATCH",
      deviceId,
      deviceName: "test-device",
    });
    if (!v.json.status || !["ACCOUNT_CREATED", "BIND_REQUIRED"].includes(v.json.status))
      throw new Error(`verify-phone ${u} -> ${v.status} ${JSON.stringify(v.json)}`);
    const b = await call("POST", "/api/auth/google/bind", {
      phone,
      idToken: fakeIdToken(`g-${u}`, e),
      deviceId,
      displayName: u,
    });
    if (!b.json.user) throw new Error(`google/bind ${u} -> ${b.status} ${JSON.stringify(b.json)}`);
    return b.json;
  };
}
