import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";
installGoogleStub();
const url = new URL("../../src/worker/index.ts", import.meta.url).href;
const core = (await import(url + "?cross=core")).default,
  edge = (await import(url + "?cross=edge")).default;
const coreEnv = {
  DB: makeD1(),
  MEDIA: makeR2(),
  GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  TURN_KEY_ID: "vx-test-key",
  TURN_API_TOKEN: "vx-test-secret",
};
const edgeEnv = {
  DB: makeD1(),
  MEDIA: makeR2(),
  FEDERATED_CORE_ORIGIN: "https://core.test",
  FEDERATED_CALLS: "1",
};
const coreCtx = makeCtx(),
  edgeCtx = makeCtx();
const lines = [];
const check = (name, yes) => lines.push(`  ${yes ? "OK" : "BROKEN"} ${name}`);
async function call(target, method, path, body, token) {
  const req = new Request(`https://${target === "core" ? "core" : "kp"}.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const res = await (target === "core"
    ? core.fetch(req, coreEnv, coreCtx)
    : edge.fetch(req, edgeEnv, edgeCtx));
  const json = await res.json();
  await coreCtx.drain();
  await edgeCtx.drain();
  return { status: res.status, json };
}
const reg = makeReg((...args) => call("core", ...args));
const kp = await reg("cross-kp@x.com", "cross_kp"),
  vx = await reg("cross-vx@x.com", "cross_vx");
await coreEnv.DB.prepare("UPDATE users SET origin_realm = 'vx' WHERE id = ?")
  .bind(vx.user.id)
  .run();
check(
  "the legacy KP edge has no VX user row",
  !(await edgeEnv.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first()),
);
const original = globalThis.fetch;
globalThis.fetch = async (req) =>
  typeof req !== "string" && new URL(req.url).origin === "https://core.test"
    ? core.fetch(req, coreEnv, coreCtx)
    : original(req);
try {
  let r = await call(
    "edge",
    "POST",
    "/api/calls",
    { userId: vx.user.id, kind: "AUDIO", offerSdp: "kp-offer" },
    kp.token,
  );
  check(
    "KP can call a VX-only identity through the shared authority",
    r.status === 201 && r.json.call?.calleeId === vx.user.id,
  );
  const id = r.json.call.id;
  await new Promise((resolve) => setTimeout(resolve, 1800)); // existing anti-phantom grace
  r = await call("core", "GET", "/api/calls/active", null, vx.token);
  check(
    "VX receives the same KP-origin incoming call",
    r.json.items.some((x) => x.id === id && x.incoming === true && x.offerSdp === "kp-offer"),
  );
  r = await call("core", "POST", `/api/calls/${id}/answer`, { answerSdp: "vx-answer" }, vx.token);
  check("VX answers the shared call", r.status === 200);
  r = await call("edge", "GET", "/api/calls/active", null, kp.token);
  check(
    "KP receives VX answer on the same call ID",
    r.json.items.some((x) => x.id === id && x.status === "ACTIVE" && x.answerSdp === "vx-answer"),
  );
  await call(
    "edge",
    "POST",
    `/api/calls/${id}/ice`,
    { candidate: { candidate: "kp-ice", sdpMid: "0", sdpMLineIndex: 0 } },
    kp.token,
  );
  r = await call("core", "GET", `/api/calls/${id}/ice?after=0`, null, vx.token);
  check(
    "KP ICE reaches VX",
    r.json.items.some((x) => x.candidate.candidate === "kp-ice" && x.from === kp.user.id),
  );
  await call(
    "core",
    "POST",
    `/api/calls/${id}/ice`,
    { candidate: { candidate: "vx-ice", sdpMid: "0", sdpMLineIndex: 0 } },
    vx.token,
  );
  r = await call("edge", "GET", `/api/calls/${id}/ice?after=0`, null, kp.token);
  check(
    "VX ICE reaches KP",
    r.json.items.some((x) => x.candidate.candidate === "vx-ice" && x.from === vx.user.id),
  );
  await call("core", "POST", `/api/calls/${id}/end`, {}, vx.token);
  r = await call("edge", "GET", "/api/calls/history", null, kp.token);
  check(
    "VX end reaches KP call history",
    r.json.items.some((x) => x.id === id && x.status === "ENDED"),
  );
  r = await call(
    "core",
    "POST",
    "/api/calls",
    { userId: kp.user.id, kind: "VIDEO", offerSdp: "vx-offer" },
    vx.token,
  );
  check("reverse VX-to-KP call is created", r.status === 201);
  const reverse = r.json.call.id;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  r = await call("edge", "GET", "/api/calls/active", null, kp.token);
  check(
    "KP sees reverse incoming VX call",
    r.json.items.some((x) => x.id === reverse && x.incoming === true && x.offerSdp === "vx-offer"),
  );
  await call("edge", "POST", `/api/calls/${reverse}/answer`, { answerSdp: "kp-answer" }, kp.token);
  r = await call("core", "GET", "/api/calls/active", null, vx.token);
  check(
    "VX receives KP answer",
    r.json.items.some((x) => x.id === reverse && x.answerSdp === "kp-answer"),
  );
  await call("edge", "POST", `/api/calls/${reverse}/end`, {}, kp.token);
  r = await call("core", "GET", "/api/calls/history", null, vx.token);
  check(
    "KP end reaches VX history",
    r.json.items.some((x) => x.id === reverse && x.status === "ENDED"),
  );
  check(
    "no split-brain call rows are written on the legacy KP edge",
    !(await edgeEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calls'",
    ).first()),
  );
} finally {
  globalThis.fetch = original;
}
for (const l of lines) console.log(l);
if (lines.some((x) => x.includes("BROKEN"))) process.exit(1);
console.log("ALL OK");
