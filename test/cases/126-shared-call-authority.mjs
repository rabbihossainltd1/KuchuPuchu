import worker from "../../src/worker/index.ts";
import { CallSignal } from "../../src/worker/durable-objects/CallSignal.ts";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";
const lines = [];
const check = (s, ok) => lines.push(`  ${ok ? "OK" : "BROKEN"} ${s}`);
const original = globalThis.fetch;
const seen = [];
globalThis.fetch = async (req) => {
  seen.push({
    path: new URL(req.url).pathname,
    query: new URL(req.url).search,
    auth: req.headers.get("authorization"),
    method: req.method,
    body: req.method === "POST" ? await req.text() : "",
  });
  return new Response('{"items":[]}', { headers: { "content-type": "application/json" } });
};
try {
  const env = { FEDERATED_CORE_ORIGIN: "https://core.test", FEDERATED_CALLS: "1" },
    ctx = { waitUntil() {} };
  for (const [method, path] of [
    ["POST", "/api/calls"],
    ["GET", "/api/calls/active"],
    ["GET", "/api/calls/history"],
    ["POST", "/api/calls/abc/answer"],
    ["POST", "/api/calls/abc/end"],
    ["POST", "/api/calls/abc/decline"],
    ["GET", "/api/calls/abc/ice?after=42"],
    ["POST", "/api/calls/abc/ice"],
    ["GET", "/api/calls/abc/reachability"],
    ["POST", "/api/calls/group"],
    ["POST", "/api/calls/abc/join"],
    ["POST", "/api/calls/abc/peer"],
  ]) {
    const res = await worker.fetch(
      new Request("https://kp.test" + path, {
        method,
        headers: { authorization: "Bearer core-only-session" },
        ...(method === "POST" ? { body: '{"userId":"vx-only-user"}' } : {}),
      }),
      env,
      ctx,
    );
    const got = seen.at(-1);
    check(
      `${method} ${path} uses the shared core, preserving the caller session`,
      res.status === 200 &&
        got.path === path.split("?")[0] &&
        got.auth === "Bearer core-only-session" &&
        got.method === method &&
        (method !== "POST" || got.body.includes("vx-only-user")),
    );
  }
  check(
    "ICE monotonic cursor survives federation",
    seen.some((x) => x.query === "?after=42"),
  );
} finally {
  globalThis.fetch = original;
}
// The DO counts ONLY authenticated sockets tagged with the callee, not caller devices.
const socket = (tag, age = 0) => ({
  tag,
  attachment: { seen: Date.now() - age },
  serializeAttachment(x) {
    this.attachment = x;
  },
  deserializeAttachment() {
    return this.attachment;
  },
});
const caller = socket("user:caller"),
  callee = socket("user:callee", 60000);
const state = { getWebSockets: (tag) => [caller, callee].filter((s) => !tag || s.tag === tag) };
const room = new CallSignal(state, {});
let r = await room.fetch(new Request("https://call-signal/live?user=callee"));
check("a caller socket and a stale callee do not fake ringing", (await r.json()).live === 0);
await room.webSocketMessage(callee, "hb");
r = await room.fetch(new Request("https://call-signal/live?user=callee"));
check("a live authenticated callee confirms signalling receipt", (await r.json()).live === 1);
r = await room.fetch(new Request("https://call-signal/live"));
check("existing unfiltered liveness remains compatible", (await r.json()).live === 2);
installGoogleStub();
const db = makeD1(),
  ctx = makeCtx(),
  env = {
    DB: db,
    MEDIA: makeR2(),
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    TURN_KEY_ID: "test",
    TURN_API_TOKEN: "test",
  };
const call = async (method, path, body, token) => {
  const res = await worker.fetch(
    new Request("https://core.test" + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    ctx,
  );
  const json = await res.json();
  await ctx.drain();
  return { status: res.status, json };
};
const reg = makeReg(call),
  a = await reg("ring-a@x.com", "ring_a"),
  b = await reg("ring-b@x.com", "ring_b"),
  c = await reg("ring-c@x.com", "ring_c");
const created = await call(
  "POST",
  "/api/calls",
  { userId: b.user.id, kind: "AUDIO", offerSdp: "test-offer" },
  a.token,
);
check("test call is created", created.status === 201);
const id = created.json.call.id;
let target = "",
  queries = 0;
env.CALL_SIGNAL = {
  idFromName: (x) => x,
  get: () => ({
    fetch: async (req) => {
      queries++;
      target = new URL(req.url).searchParams.get("user");
      return Response.json({ live: 1 });
    },
  }),
};
let v = await call("GET", `/api/calls/${id}/reachability?user=${a.user.id}`, null, a.token);
check(
  "caller cannot substitute its own id for callee receipt",
  v.status === 200 && v.json.received === true && target === b.user.id,
);
const before = queries;
v = await call("GET", `/api/calls/${id}/reachability`, null, c.token);
check("nonparticipants cannot inspect call reachability", v.status === 403 && queries === before);
v = await call("GET", "/api/calls/missing/reachability", null, a.token);
check("unknown call is rejected", v.status === 404);
for (const s of lines) console.log(s);
if (lines.some((x) => x.includes("BROKEN"))) process.exit(1);
console.log("ALL OK");
