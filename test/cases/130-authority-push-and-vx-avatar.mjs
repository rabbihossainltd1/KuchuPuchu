// Drive BOTH real workers and separate DBs: registrations after cutover must
// reach FCM via the frozen credential edge, not its stale devices snapshot.
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";
installGoogleStub();
const path = new URL("../../src/worker/index.ts", import.meta.url).href;
const core = (await import((process.env.KP_TEST_CORE_MODULE || path) + "?push=core")).default,
  edge = (await import((process.env.KP_TEST_EDGE_MODULE || path) + "?push=edge")).default;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = randomBytes(32),
  ctx = makeCtx(),
  edgeCtx = makeCtx();
const env = {
  DB: makeD1(),
  MEDIA: makeR2(),
  GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  KP_PUSH_ORIGIN: "https://edge.test",
  FEDERATION_PUSH_KEY: "test-relay-key",
  LARAVEL_BRIDGE_KEY: key.toString("base64url"),
  TURN_URLS: "turn:relay.test:3478",
  TURN_USERNAME: "test",
  TURN_CREDENTIAL: "test",
};
const edgeEnv = {
  DB: makeD1(),
  MEDIA: makeR2(),
  GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  FEDERATION_PUSH_KEY: "test-relay-key",
  FCM_CREDENTIALS: JSON.stringify({
    project_id: "test",
    client_email: "test@test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }),
};
const lines = [],
  sent = [],
  relays = [],
  orig = globalThis.fetch;
const check = (s, ok) => lines.push(`  ${ok ? "OK" : "BROKEN"} ${s}`);
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url === "https://edge.test/api/internal/federation/push") {
    relays.push(JSON.parse(init.body));
    return edge.fetch(new Request(url, init), edgeEnv, edgeCtx);
  }
  if (url.includes("oauth2.googleapis.com/token") && !url.includes("tokeninfo"))
    return Response.json({ access_token: "test-access-token", expires_in: 3600 });
  if (url.includes("fcm.googleapis.com/v1/projects")) {
    sent.push(JSON.parse(init.body));
    return Response.json({ name: "projects/test/messages/test" });
  }
  return orig(input, init);
};
async function call(method, route, body, token, target = core, e = env, c = ctx) {
  const res = await target.fetch(
    new Request("https://core.test" + route, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    e,
    c,
  );
  await ctx.drain();
  await edgeCtx.drain();
  return { status: res.status, json: await res.json() };
}
const reg = makeReg((method, path, body, token) => call(method, path, body, token));
const edgeReg = makeReg((method, path, body, token) =>
  call(method, path, body, token, edge, edgeEnv, edgeCtx),
);
try {
  await edgeReg("edge-snapshot@test.com", "edge_snapshot");
  const kp = await reg("authority-kp@test.com", "authority_kp");
  await call("POST", "/api/devices", { token: "authority-new-device-token" }, kp.token);
  edgeEnv.DB._db
    .prepare("INSERT INTO devices(token,user_id,updated_at) VALUES (?,?,?)")
    .run("stale-legacy-device-token", kp.user.id, new Date().toISOString());
  const relay = (body, auth = "test-relay-key") =>
    call("POST", "/api/internal/federation/push", body, auth, edge, edgeEnv, edgeCtx);
  const body = {
    userId: kp.user.id,
    data: { type: "message", body: "test" },
    deviceTokens: ["authority-new-device-token"],
  };
  let res = await relay(body, "wrong-key");
  check(
    "relay supplied tokens require server authentication",
    res.status === 401 && sent.length === 0,
  );
  for (const invalid of ["not-array", [123], ["short"], Array(101).fill("valid-token-long")]) {
    res = await relay({ ...body, deviceTokens: invalid });
    check(
      "malformed/oversize authority token list is refused",
      res.status === 400 && sent.length === 0,
    );
  }
  res = await relay({ ...body, deviceTokens: [] });
  check(
    "explicit empty authority list cannot fall back to stale legacy devices",
    res.status === 200 && res.json.accepted === false && sent.length === 0,
  );
  res = await relay(body);
  check(
    "authenticated relay sends authority token instead of legacy snapshot",
    res.json.accepted === true && sent.at(-1).message.token === "authority-new-device-token",
  );
  res = await relay({ userId: kp.user.id, data: body.data });
  check(
    "old callers without token list retain backward-compatible edge lookup",
    res.json.accepted === true && sent.at(-1).message.token === "stale-legacy-device-token",
  );
  const sign = (c) => {
    const p = Buffer.from(JSON.stringify(c)).toString("base64url");
    return p + "." + createHmac("sha256", key).update(p).digest("base64url");
  };
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  const claims = {
    sub: "website-avatar-owner",
    handle: "avatar_owner",
    displayName: "Website Avatar",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60000,
    originRealm: "vx",
    avatarUrl: png,
  };
  res = await call("POST", "/api/auth/realm/exchange", { assertion: sign(claims) });
  check(
    "signed website avatar provisions VX identity",
    res.status === 200 && res.json.user.avatarUrl === png,
  );
  const vx = res.json;
  let avatar = await call("GET", "/api/users/" + vx.user.id + "/avatar", null, kp.token);
  check(
    "KP can fetch synced VX photo through normal authorized avatar API",
    avatar.status === 200 && avatar.json.avatarUrl === png && Boolean(avatar.json.avatarRef),
  );
  const oldRef = avatar.json.avatarRef;
  const omit = { ...claims };
  delete omit.avatarUrl;
  res = await call("POST", "/api/auth/realm/exchange", { assertion: sign(omit) });
  avatar = await call("GET", "/api/users/" + vx.user.id + "/avatar", null, kp.token);
  check(
    "older bridge omitting avatar preserves existing photo and immutable identity",
    res.json.user.id === vx.user.id &&
      avatar.json.avatarRef === oldRef &&
      avatar.json.avatarUrl === png,
  );
  res = await call("POST", "/api/auth/realm/exchange", {
    assertion: sign({ ...claims, avatarUrl: "data:text/html;base64,PHNjcmlwdD4=" }),
  });
  check("signed HTML is never accepted as a photo", res.status === 401);
  const conv = await call("POST", "/api/conversations", { userId: kp.user.id }, vx.token);
  sent.length = 0;
  relays.length = 0;
  res = await call(
    "POST",
    "/api/conversations/" + conv.json.conversation.id + "/messages",
    { kind: "TEXT", body: "authority push roundtrip" },
    vx.token,
  );
  check(
    "real authority message relays freshly registered device tokens",
    res.status === 201 &&
      relays.some(
        (x) => x.data.type === "message" && x.deviceTokens.includes("authority-new-device-token"),
      ),
  );
  check(
    "edge delivers actual message push to authority token, not legacy token",
    sent.some(
      (x) =>
        x.message.android.data.type === "message" &&
        x.message.token === "authority-new-device-token",
    ) && !sent.some((x) => x.message.token === "stale-legacy-device-token"),
  );
  sent.length = 0;
  relays.length = 0;
  res = await call(
    "POST",
    "/api/calls",
    { userId: kp.user.id, kind: "AUDIO", offerSdp: "v=0\r\n" },
    vx.token,
  );
  check(
    "real cross-realm incoming call uses authority token through FCM relay",
    res.status === 201 &&
      relays.some(
        (x) => x.data.type === "call" && x.deviceTokens.includes("authority-new-device-token"),
      ) &&
      sent.some(
        (x) =>
          x.message.android.data.type === "call" &&
          x.message.token === "authority-new-device-token" &&
          x.message.android.priority === "HIGH",
      ),
  );
  res = await call("POST", "/api/auth/realm/exchange", {
    assertion: sign({ ...claims, avatarUrl: null }),
  });
  avatar = await call("GET", "/api/users/" + vx.user.id + "/avatar", null, kp.token);
  check(
    "explicit owner photo removal clears photo and reference",
    res.status === 200 && avatar.json.avatarUrl === null && avatar.json.avatarRef === null,
  );
} finally {
  globalThis.fetch = orig;
}
console.log("\n[130] Authority push relay and signed VX photo");
for (const l of lines) console.log(l);
process.exit(lines.some((x) => x.includes("BROKEN")) ? 1 : 0);
