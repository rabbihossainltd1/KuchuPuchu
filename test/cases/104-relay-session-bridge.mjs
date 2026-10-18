// The relay host holds the TURN keys but not the sessions the app signs in
// with: it runs the same code against its own database. SESSION_AUTHORITY_URL
// names the deployment that owns those sessions, and the relay route asks it
// who the caller is instead of refusing a signed-in client.
//
// Asserts: an unknown session is refused when no authority is configured; a
// session the authority recognises is served relay credentials; the authority
// is asked once, with the caller's own bearer; a session this deployment
// already knows never reaches the authority; and the authority URL is a
// deployment constant, never something a request can choose.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk(envExtra = {}) {
  const worker = await freshWorker();
  const db = makeD1();
  const env = {
    DB: db,
    MEDIA: makeR2(),
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    TURN_URLS: "turns:relay.test:443",
    TURN_USERNAME: "test",
    TURN_CREDENTIAL: "test-secret",
    ...envExtra,
  };
  const ctx = makeCtx();
  const call = async (method, path, body, token, extraHeaders) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    Object.assign(headers, extraHeaders || {});
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
  const reg = makeReg(call);
  return { db, env, call, reg };
}

/** Run [fn] with a fetch that answers the authority host and records the calls. */
async function withAuthority(fn) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://authority.test/")) {
      const headers = init?.headers ?? {};
      seen.push({ url, auth: String(headers.Authorization ?? headers.authorization ?? "") });
      return new Response(JSON.stringify({ user: { id: "u-foreign" } }), {
        status: 200,
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

// ---- 1. no authority configured: an unknown session is still refused ----
{
  const k = await mk();
  const refused = await k.call("GET", "/api/config/ice", undefined, "foreign-session-token");
  check(
    "without SESSION_AUTHORITY_URL an unknown session is refused",
    refused.status === 401 && refused.json.error?.code === "UNAUTHENTICATED",
    JSON.stringify(refused),
  );
}

// ---- 2. the authority recognises the session: relay credentials are served ----
{
  const k = await mk({ SESSION_AUTHORITY_URL: "https://authority.test" });
  await withAuthority(async (seen) => {
    const served = await k.call("GET", "/api/config/ice", undefined, "foreign-session-token");
    check(
      "a session the authority recognises is served relay credentials",
      served.status === 200 && served.json.ice?.urls?.[0] === "turns:relay.test:443",
      JSON.stringify(served),
    );
    check(
      "the authority is asked once, carrying the caller's own bearer",
      seen.length === 1 && seen[0].auth.includes("foreign-session-token"),
      JSON.stringify(seen),
    );
  });
}

// ---- 3. a session this deployment knows never reaches the authority ----
{
  const k = await mk({ SESSION_AUTHORITY_URL: "https://authority.test" });
  const a = await k.reg("bridge-a@x.com", "bridge_a");
  await withAuthority(async (seen) => {
    const served = await k.call("GET", "/api/config/ice", undefined, a.token);
    check(
      "a locally known session is served without asking the authority",
      served.status === 200 &&
        served.json.ice?.urls?.[0] === "turns:relay.test:443" &&
        seen.length === 0,
      `${JSON.stringify(served)} ${JSON.stringify(seen)}`,
    );
  });
}

// ---- 4. the authority is a deployment constant, not a request value ----
{
  const k = await mk({ SESSION_AUTHORITY_URL: "https://authority.test" });
  await withAuthority(async (seen) => {
    const spoofed = await k.call("GET", "/api/config/ice", undefined, "foreign-session-token", {
      "x-session-authority": "https://spoof.test",
    });
    check(
      "a request cannot choose the authority host",
      spoofed.status === 200 &&
        seen.length === 1 &&
        seen[0].url.startsWith("https://authority.test/"),
      `${JSON.stringify(spoofed)} ${JSON.stringify(seen)}`,
    );
  });
}

// ---- 5. an authority that refuses the session keeps the refusal ----
{
  const k = await mk({ SESSION_AUTHORITY_URL: "https://authority.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://authority.test/"))
      return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    return realFetch(input, init);
  };
  const refused = await k.call("GET", "/api/config/ice", undefined, "foreign-session-token");
  globalThis.fetch = realFetch;
  check(
    "an authority that does not know the session keeps the refusal",
    refused.status === 401 && refused.json.error?.code === "UNAUTHENTICATED",
    JSON.stringify(refused),
  );
}

// ---- 6. the slice-J edge: the core that owns the sessions is asked ----
{
  const k = await mk({ FEDERATED_CORE_ORIGIN: "https://core.test" });
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://core.test/")) {
      const headers = init?.headers ?? {};
      seen.push({ url, auth: String(headers.Authorization ?? headers.authorization ?? "") });
      return new Response(JSON.stringify({ user: { id: "u-core" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  const served = await k.call("GET", "/api/config/ice", undefined, "core-session-token");
  globalThis.fetch = realFetch;
  check(
    "a session the core owns is served relay credentials",
    served.status === 200 && served.json.ice?.urls?.[0] === "turns:relay.test:443",
    JSON.stringify(served),
  );
  check(
    "the core is asked only about the caller, never proxied the relay route",
    seen.length === 1 &&
      seen[0].url === "https://core.test/api/me" &&
      seen[0].auth.includes("core-session-token"),
    JSON.stringify(seen),
  );
}

// ---- 7. a core that does not know the session keeps the refusal ----
{
  const k = await mk({ FEDERATED_CORE_ORIGIN: "https://core.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://core.test/"))
      return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    return realFetch(input, init);
  };
  const refused = await k.call("GET", "/api/config/ice", undefined, "core-session-token");
  globalThis.fetch = realFetch;
  check(
    "a core that does not know the session keeps the refusal",
    refused.status === 401 && refused.json.error?.code === "UNAUTHENTICATED",
    JSON.stringify(refused),
  );
}

// ---- 8. an unreachable core keeps the refusal (no crash, no leak) ----
{
  const k = await mk({ FEDERATED_CORE_ORIGIN: "https://core.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://core.test/")) throw new TypeError("network down");
    return realFetch(input, init);
  };
  const refused = await k.call("GET", "/api/config/ice", undefined, "core-session-token");
  globalThis.fetch = realFetch;
  check(
    "an unreachable core keeps the refusal",
    refused.status === 401 && refused.json.error?.code === "UNAUTHENTICATED",
    JSON.stringify(refused),
  );
}

// ---- 9. the health answer keeps the core's capabilities but reports this
//         deployment's relay (the core holds no TURN keys) ----
{
  const k = await mk({ FEDERATED_CORE_ORIGIN: "https://core.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://core.test/"))
      return new Response(
        JSON.stringify({
          ok: true,
          service: "KuchuPuchu",
          capabilities: { push: true, turn: false, realtime: true, media: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    return realFetch(input, init);
  };
  const health = await k.call("GET", "/api/health");
  globalThis.fetch = realFetch;
  check(
    "the health answer reports this deployment's relay and keeps the core's own capabilities",
    health.status === 200 &&
      health.json.capabilities?.turn === true &&
      health.json.capabilities?.push === true &&
      health.json.capabilities?.media === true,
    JSON.stringify(health),
  );
}

console.log(lines.join("\n"));
