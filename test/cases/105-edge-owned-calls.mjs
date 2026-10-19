// The slice-J edge owns the call protocol while the core cannot open a call.
//
// After the cutover the live sessions live in the core's database, and the
// core holds no TURN keys, so its POST /api/calls refuses with
// CALL_RELAY_UNAVAILABLE. The edge holds the relay keys, so the call routes
// stay on the edge - and the edge, whose own database is frozen, borrows the
// caller's identity from the core (the authority) exactly the way the relay
// route already does.
//
// Asserts: a call is created locally for a session only the core knows; the
// ring carries the authority's name; the core is asked WHO the caller is and
// never asked to create the call; the call's own routes (answer, ice, active)
// stay on the edge; the APK download comes from the edge's own bucket; and a
// session nobody knows is still refused.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN  "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk(envExtra = {}) {
  const worker = await freshWorker();
  const db = makeD1();
  const media = makeR2();
  const env = {
    DB: db,
    MEDIA: media,
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    // The edge holds the relay keys (the core does not).
    TURN_KEY_ID: "turn-key",
    TURN_API_TOKEN: "turn-secret",
    ...envExtra,
  };
  const ctx = makeCtx();
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
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
    return { status: res.status, json: j, text: t };
  };
  const reg = makeReg(call);
  return { db, env, media, call, reg };
}

/** Answer the core host: /api/me vouches for the caller, everything else 404s. */
async function withCore(fn, user) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://core.test/")) {
      const headers = init?.headers ?? {};
      seen.push({ url, auth: String(headers.Authorization ?? headers.authorization ?? "") });
      if (url === "https://core.test/api/me")
        return new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  try {
    return await fn(seen);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- 1. the edge creates the call for a session only the core knows ----
{
  const k = await mk();
  const callee = await k.reg("edge-callee@x.com", "edge_callee");
  // The cutover: from here on this deployment proxies to the core.
  k.env.FEDERATED_CORE_ORIGIN = "https://core.test";
  const caller = { id: "u-core-caller", displayName: "Core Caller", username: "corecaller" };

  await withCore(async (seen) => {
    const created = await k.call(
      "POST",
      "/api/calls",
      { userId: callee.user.id, kind: "AUDIO", offerSdp: "v=0 offer" },
      "core-session-token",
    );
    check(
      "a call is created on the edge for a session the core owns",
      created.status === 201 && !!created.json.call?.id,
      JSON.stringify(created.json).slice(0, 160),
    );
    check(
      "the refusal the core used to answer is gone",
      created.json.error?.code !== "CALL_RELAY_UNAVAILABLE",
      JSON.stringify(created.json.error ?? null),
    );
    check(
      "the core is asked only who the caller is",
      seen.length === 1 && seen[0].url === "https://core.test/api/me",
      JSON.stringify(seen),
    );
    check(
      "the core is asked with the caller's own bearer",
      seen.length === 1 && seen[0].auth.includes("core-session-token"),
      JSON.stringify(seen),
    );
    const row = k.db._db
      .prepare("SELECT caller_id, callee_id, status FROM calls WHERE id = ?")
      .get(created.json.call?.id);
    check(
      "the call row lives in the edge's own database",
      !!row && row.caller_id === "u-core-caller" && row.callee_id === callee.user.id,
      JSON.stringify(row ?? null),
    );
  }, caller);
}

// ---- 2. the call's own routes stay on the edge ----
{
  const k = await mk();
  const callee = await k.reg("edge-callee2@x.com", "edge_callee2");
  k.env.FEDERATED_CORE_ORIGIN = "https://core.test";
  const caller = { id: "u-core-caller2", displayName: "Core Caller", username: "corecaller2" };

  await withCore(async (seen) => {
    const created = await k.call(
      "POST",
      "/api/calls",
      { userId: callee.user.id, kind: "AUDIO", offerSdp: "v=0 offer" },
      "core-session-token",
    );
    const callId = created.json.call?.id;
    const active = await k.call("GET", "/api/calls/active", undefined, "core-session-token");
    check(
      "the active-call poll is answered by the edge",
      active.status === 200 && active.json.items?.length === 1,
      JSON.stringify(active.json).slice(0, 160),
    );
    // The callee is a local user, so it signs in with its own session.
    const answered = await k.call(
      "POST",
      `/api/calls/${callId}/answer`,
      { answerSdp: "v=0 answer" },
      callee.token,
    );
    check(
      "the callee answers the edge-owned call",
      answered.status === 200 || answered.status === 201,
      `${answered.status} ${JSON.stringify(answered.json).slice(0, 120)}`,
    );
    const stranger = await k.call(
      "POST",
      `/api/calls/${callId}/answer`,
      { answerSdp: "v=0 nope" },
      "core-session-token",
    );
    check(
      "a non-participant cannot answer the edge-owned call",
      stranger.status === 403,
      `${stranger.status} ${JSON.stringify(stranger.json).slice(0, 120)}`,
    );
    check(
      "no call route was ever handed to the core",
      seen.every((s) => s.url === "https://core.test/api/me"),
      JSON.stringify(seen.map((s) => s.url)),
    );
  }, caller);
}

// ---- 3. the APK download comes from the edge's own bucket ----
{
  const k = await mk();
  await k.media.put("apk/kuchupuchu-latest.apk", Buffer.from("edge-apk"));
  k.env.FEDERATED_CORE_ORIGIN = "https://core.test";
  await withCore(async (seen) => {
    const dl = await k.call("GET", "/download/apk");
    check(
      "the edge serves the newest APK from its own bucket",
      dl.status === 200 && dl.text === "edge-apk",
      `${dl.status} ${dl.text?.slice(0, 40)}`,
    );
    check(
      "the APK download is never proxied to the core",
      seen.length === 0,
      JSON.stringify(seen.map((s) => s.url)),
    );
  });
}

// ---- 4. a session nobody knows is still refused ----
{
  const k = await mk();
  const callee = await k.reg("edge-callee3@x.com", "edge_callee3");
  k.env.FEDERATED_CORE_ORIGIN = "https://core.test";
  await withCore(async (seen) => {
    const refused = await k.call(
      "POST",
      "/api/calls",
      { userId: callee.user.id, kind: "AUDIO", offerSdp: "v=0 offer" },
      "stranger-token",
    );
    check(
      "a session the core does not know keeps the refusal",
      refused.status === 401,
      `${refused.status} ${JSON.stringify(refused.json).slice(0, 120)}`,
    );
  });
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(broken === 0 ? "\nALL OK" : `\n${broken} BROKEN`);
if (broken) process.exit(1);
