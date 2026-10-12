// H2 option 2 (2026-10-12): a Google-bound account with NO live device must
// prove the bound Google before the self-attested-SIM path hands out a
// session. Unbound accounts and a returning same device keep the old path.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, fakeIdToken, phoneFrom } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
const worker = (await import(`${WORKER}?v=h2a`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const db = makeD1();
const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
const ctx = makeCtx();
let ipSeq = 0;
const call = async (method, path, body, token) => {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/auth/"))
    headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
    j = { _raw: t.slice(0, 120) };
  }
  return { status: res.status, json: j };
};
const reg = makeReg(call);

// ---- bound account, no live device ----
const me = await reg("h2@x.com", "h2me");
const phone = phoneFrom("h2@x.com");
const logout = await call("POST", "/api/auth/logout", {}, me.token);
check("logout clears the only live session", logout.status === 200, `status ${logout.status}`);

const bare = await call("POST", "/api/auth/verify-phone", {
  phone,
  sim: "MATCH",
  deviceId: "dev-attacker",
  deviceName: "strange phone",
});
check(
  "no-live-device + bound account without Google proof -> GOOGLE_REQUIRED",
  bare.status === 200 && bare.json.status === "GOOGLE_REQUIRED",
  `status ${bare.status} ${bare.json.status}`,
);
check("GOOGLE_REQUIRED leaks no session token", !bare.json.token);

const wrong = await call("POST", "/api/auth/verify-phone", {
  phone,
  sim: "MATCH",
  deviceId: "dev-attacker",
  googleIdToken: fakeIdToken("g-someone-else", "other@x.com"),
});
check(
  "a Google proof for the WRONG subject is refused",
  wrong.status === 403 && wrong.json.error?.code === "GOOGLE_MISMATCH",
  `status ${wrong.status} ${wrong.json.error?.code}`,
);

const right = await call("POST", "/api/auth/verify-phone", {
  phone,
  sim: "MATCH",
  deviceId: "dev-attacker",
  googleIdToken: fakeIdToken("g-h2me", "h2@x.com"),
});
check(
  "the bound Google proof completes the login",
  right.status === 200 && right.json.status === "SESSION" && !!right.json.token,
  `status ${right.status} ${right.json.status}`,
);

// ---- the same install returning with a live session keeps the fast path ----
const again = await call("POST", "/api/auth/verify-phone", {
  phone,
  sim: "MATCH",
  deviceId: "dev-attacker",
});
check(
  "same device with a live session still gets a session without Google",
  again.status === 200 && again.json.status === "SESSION",
  `status ${again.status} ${again.json.status}`,
);

// ---- unbound account: SIM-only path unchanged ----
const v = await call("POST", "/api/auth/verify-phone", {
  phone: phoneFrom("h2unbound"),
  sim: "MATCH",
  deviceId: "dev-unbound",
});
// Signup creates PENDING; bind then strip the google_subject to model a
// legacy unbound ACTIVE account.
const bind = await call("POST", "/api/auth/google/bind", {
  phone: phoneFrom("h2unbound"),
  idToken: fakeIdToken("g-unbound", "unbound@x.com"),
  deviceId: "dev-unbound",
  displayName: "unbound",
});
await db
  .prepare("UPDATE users SET google_subject = NULL WHERE id = ?")
  .bind(bind.json.user.id)
  .run();
await call("POST", "/api/auth/logout", {}, bind.json.token);
const unbound = await call("POST", "/api/auth/verify-phone", {
  phone: phoneFrom("h2unbound"),
  sim: "MATCH",
  deviceId: "dev-reinstall",
});
check(
  "unbound account with no live device keeps SIM-only login (SESSION)",
  unbound.status === 200 && unbound.json.status === "SESSION",
  `status ${unbound.status} ${unbound.json.status}`,
);

console.log(lines.join("\n"));
console.log(
  `86 h2-google-proof: ${lines.filter((l) => l.includes("OK")).length} ok / ${
    lines.filter((l) => l.includes("BROKEN")).length
  } broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
