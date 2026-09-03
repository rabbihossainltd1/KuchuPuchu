// §37 session refresh. The property that matters is asymmetric: a live session must
// be able to extend itself cheaply, and a DEAD one must never be able to — otherwise
// the expiry is decoration and a stolen token is permanent. Both directions are
// executed here against the real worker; the client half is pinned as source shape,
// because there is no Android SDK in this sandbox (CI's assembleDebug is the compile).

import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, phoneFrom, fakeIdToken } from "../helpers/phoneauth.mjs";

installGoogleStub();

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
    const res = await mod.default.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { raw: t };
    }
    return { status: res.status, j, headers: res.headers };
  };
  const reg = async (tag) => {
    const phone = phoneFrom(`${tag}@x.com`);
    await call("POST", "/api/auth/verify-phone", {
      phone,
      sim: "MATCH",
      deviceId: `dev-${tag}`,
    });
    const r = await call("POST", "/api/auth/google/bind", {
      phone,
      idToken: fakeIdToken(`g-${tag}`, `${tag}@x.com`),
      deviceId: `dev-${tag}`,
      displayName: tag,
    });
    if (!r.j.user)
      throw new Error(`REGISTER ${tag} -> ${r.status} ${JSON.stringify(r.j).slice(0, 200)}`);
    return { id: r.j.user.id, token: r.j.token };
  };
  const expiresAt = async () =>
    (await env.DB.prepare("SELECT expires_at FROM sessions LIMIT 1").first())?.expires_at;
  const setExpiry = (iso) => env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(iso).run();
  return { mod, env, call, reg, expiresAt, setExpiry };
}

const DAY = 864e5;

{
  const { env, call, reg, expiresAt, setExpiry } = await mk();
  const u = await reg("rf1");

  // A session that was just minted is nowhere near expiry: the refresh must answer
  // without touching a row, or "keep the session alive" becomes a write per open.
  const before = await expiresAt();
  env.DB._stats.reset();
  const r1 = await call("POST", "/api/auth/refresh", undefined, u.token);
  check(
    "a live session refreshes with 200",
    r1.status === 200,
    `${r1.status} ${JSON.stringify(r1.j).slice(0, 90)}`,
  );
  check(
    "…and says it did not extend (nothing was near expiry)",
    r1.j.extended === false,
    JSON.stringify(r1.j),
  );
  check("…and leaves expires_at exactly as it was", (await expiresAt()) === before);
  check(
    "…costing no write at all (the no-op path must not touch D1 rows)",
    env.DB._stats.writes === 0,
    `w=${env.DB._stats.writes} r=${env.DB._stats.reads}`,
  );
  check(
    "…and at most the two reads the auth path needs",
    env.DB._stats.reads <= 2,
    `r=${env.DB._stats.reads}`,
  );

  // Now push the session near the edge: this is what an app that has been open for
  // 89 days (or a user who comes back after a long quiet spell) looks like.
  await setExpiry(new Date(Date.now() + 3 * DAY).toISOString());
  const r2 = await call("POST", "/api/auth/refresh", undefined, u.token);
  check("a session near expiry IS extended", r2.j.extended === true, JSON.stringify(r2.j));
  const after = await expiresAt();
  check(
    "…to the full TTL from now",
    Math.abs(Date.parse(after) - (Date.now() + 90 * DAY)) < 5 * 60e3,
    `${after} vs ${new Date(Date.now() + 90 * DAY).toISOString()}`,
  );
  const me = await call("GET", "/api/me", undefined, u.token);
  check(
    "the SAME token keeps working after an extension (no rotation, nothing to re-persist)",
    me.status === 200,
    JSON.stringify(me.j).slice(0, 90),
  );

  // The property that keeps expiry honest.
  await setExpiry(new Date(Date.now() - 1000).toISOString());
  const expired = await call("GET", "/api/me", undefined, u.token);
  const dead = await call("POST", "/api/auth/refresh", undefined, u.token);
  check(
    "an expired session gets 401 on ordinary calls",
    expired.status === 401,
    String(expired.status),
  );
  check(
    "…and a refresh cannot resurrect it (that would make TTL decoration)",
    dead.status === 401 && dead.j.error?.code === "UNAUTHENTICATED",
    `${dead.status} ${JSON.stringify(dead.j)}`,
  );
  const stillExpired = await expiresAt();
  check(
    "…leaving the row expired rather than silently slid",
    Date.parse(stillExpired) < Date.now(),
    stillExpired,
  );

  // Logout kills the session; refresh must then be a 401, not a 200-with-no-effect.
  const { call: call2, reg: reg2 } = await mk();
  const v = await reg2("rf2");
  const before2 = await call2("GET", "/api/me", undefined, v.token);
  check("fixture: second account authenticates", before2.status === 200, String(before2.status));
  await call2("POST", "/api/auth/logout", {}, v.token);
  const afterLogout = await call2("POST", "/api/auth/refresh", undefined, v.token);
  check(
    "a logged-out token cannot refresh",
    afterLogout.status === 401,
    String(afterLogout.status),
  );
  check(
    "…and no unauthenticated refresh is possible at all",
    (await call2("POST", "/api/auth/refresh")).status === 401,
  );

  // Hammering the endpoint must be bounded, and the 429 must carry Retry-After (the
  // app's backpressure path reads it; a bare 429 restarts the loop 2s later).
  const { call: call3, reg: reg3 } = await mk();
  const w = await reg3("rf3");
  const codes = [];
  for (let i = 0; i < 16; i++)
    codes.push((await call3("POST", "/api/auth/refresh", undefined, w.token)).status);
  check("refresh is rate-limited", codes.includes(429), codes.join(","));
  const limited = codes.indexOf(429);
  if (limited >= 0) {
    const res = await call3("POST", "/api/auth/refresh", undefined, w.token);
    check(
      "…with a Retry-After the client can honour",
      res.status === 429 && !!res.headers.get("retry-after"),
      `ra=${res.headers.get("retry-after")}`,
    );
  } else {
    check("…with a Retry-After the client can honour", false, "no 429 seen");
  }
}

{
  const api = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Api.kt",
    "utf8",
  );
  const act = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
    "utf8",
  );
  const login = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
    "utf8",
  );
  const flat = api.replace(/\s+/g, " ");
  check(
    "a 401 tries exactly one refresh, then one retry of the same request",
    flat.includes("if (resp.code == 401 && allowRefresh && refreshSession())") &&
      flat.includes("return executeJson(req, allowRefresh = false)"),
  );
  check(
    "the retry cannot refresh again (loop prevention is structural)",
    flat.includes("private fun executeJson(req: Request, allowRefresh: Boolean = true)"),
  );
  check(
    "refresh is single-flight (N parallel 401s send one request)",
    /refreshing\.compareAndSet\(false, true\)/.test(api),
  );
  check(
    "…and the in-flight flag is released on every path",
    api.includes("refreshing.set(false)") && /finally \{\s*refreshing\.set\(false\)/.test(api),
  );
  check(
    "…throttled to one attempt per minute per process",
    /System\.currentTimeMillis\(\) - lastRefreshTry < 60_000/.test(api),
  );
  check(
    "sign-out only happens after the refresh has failed",
    flat.indexOf("allowRefresh && refreshSession()") < flat.indexOf("token = null"),
  );
  check(
    "the refresh never rewrites the stored token (nothing to get out of sync)",
    !/saveToken\([^)]*refresh/i.test(api) && api.includes("resp.isSuccessful"),
  );
  check(
    "an app coming to the foreground keeps its session alive",
    /Thread \{ runCatching \{ Api\.refreshSession\(\) \} \}\.start\(\)/.test(act),
  );
  check(
    "…off the main thread (onResume is not a network thread)",
    act.indexOf("Api.refreshSession()") > act.indexOf("override fun onResume"),
  );
  check(
    "the login/register path never calls it (§37 is about living sessions, not signing in)",
    !/refreshSession/.test(login),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
