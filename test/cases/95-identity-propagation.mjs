// Phase R2 — identity payload propagation (plan §13.14).
//
// The plan's rule is that a badge must never be missable in a NESTED feature:
// every API shape, event and push that names an identity carries the normalized
// summary `{id, origin_realm, username, display_name, avatar, roles, linked}`,
// and realm/link facts are always read from the server's own rows — never from
// whatever a client decided to send. This case pins:
//
//   * the summary (and the legacy aliases) on directory, profile, member and
//     call shapes, with provable roles only;
//   * `linked` flipping on BOTH accounts when a link is approved, and back when
//     it is revoked — including the roles it implies;
//   * a client cannot inject origin_realm / linked / roles / senderRealm;
//   * a message carries the sender's realm as of that message, and that marker
//     SURVIVES the sender's account being deleted (neutral surface + truthful
//     origin), which is the plan's deleted-account rule;
//   * WebSocket/DO frames name the sender by immutable id AND realm, for
//     messages and for calls;
//   * push payloads carry the realm the SERVER read from the sender's row;
//   * moderation snapshots keep both realms as of the event (blocks, reports);
//   * bridge assertions may name the communication id + realm, are refused on a
//     mismatch, and the exchange answers with the mapping Laravel stores;
//   * both clients key identity caches by immutable id (a ref/path), so equal
//     usernames in two realms cannot overwrite each other's avatar.

import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const worker = (await import(`${WORKER}?prop=${n++}`)).default;

// A real PKCS8 RSA key so the worker's FCM JWT signing (RS256) succeeds.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FCM_CREDENTIALS = JSON.stringify({
  project_id: "kp-test-proj",
  client_email: "svc@kp-test-proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});

const KEY = randomBytes(32);
const KEY_B64 = KEY.toString("base64url");
const sign = (claims) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", KEY).update(payload).digest("base64url")}`;
};

const db = makeD1();
const broadcasts = [];
const pushes = []; // every FCM send body
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("oauth2.googleapis.com/token") && !url.includes("tokeninfo")) {
    return new Response(JSON.stringify({ access_token: "fake-at", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("fcm.googleapis.com/v1/projects")) {
    pushes.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ name: "projects/1/messages/1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
};

const env = {
  DB: db,
  MEDIA: makeR2(),
  GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  TURN_URLS: "turns:relay.test:443",
  TURN_USERNAME: "test",
  TURN_CREDENTIAL: "test-secret",
  LARAVEL_BRIDGE_KEY: KEY_B64,
  FCM_CREDENTIALS,
  SELF_ORIGIN: "https://kp.test",
  CHAT_ROOM: {
    idFromName: (name) => ({ toString: () => name, name }),
    get: (id) => ({
      fetch: async (url, init) => {
        broadcasts.push({ room: id.name, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200 });
      },
    }),
  },
};
const ctx = makeCtx();
const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

let ipSeq = 0;
const call = async (method, path, body, token) => {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/auth/"))
    headers["cf-connecting-ip"] = `203.71.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const response = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
  const text = await response.text();
  await ctx.drain();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text.slice(0, 120) };
  }
  return { status: response.status, json };
};

const reg = makeReg(call);
const A = await reg("prop-a@x.com", "Prop Alpha"); // kp app account
const B = await reg("prop-b@x.com", "Prop Beta"); // second kp account
// A website account through the bridge (the student side of the network).
const vx = await call("POST", "/api/auth/realm/exchange", {
  assertion: sign({
    sub: "prop-laravel-1",
    handle: "prop_student",
    displayName: "Prop Student",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60_000,
  }),
  deviceId: "web-prop",
});
const vxId = vx.json.user?.id;

const SUMMARY_KEYS = [
  "id",
  "origin_realm",
  "username",
  "display_name",
  "avatar",
  "roles",
  "linked",
];
const hasSummary = (row) =>
  !!row && SUMMARY_KEYS.every((key) => key in row) && Array.isArray(row.roles);

// ------------------------------------------------- 1. every shape carries it
const directory = await call("GET", "/api/users?realm=all&q=prop", undefined, A.token);
check(
  "the directory rows carry the normalized identity summary",
  directory.status === 200 &&
    directory.json.users.length >= 2 &&
    directory.json.users.every(hasSummary) &&
    directory.json.users.every((u) => u.origin_realm === (u.originRealm ?? u.origin_realm)),
  JSON.stringify(directory.json.users?.[0] ?? {}).slice(0, 220),
);
const me = await call("GET", "/api/me", undefined, A.token);
check(
  "the signed-in account's own shape carries it too (avatar as a REFERENCE, never a blob)",
  hasSummary(me.json.user) &&
    me.json.user.display_name === me.json.user.displayName &&
    (me.json.user.avatar === null || /^[^/]+@v\d+$/.test(me.json.user.avatar)),
  JSON.stringify(me.json.user ?? {}).slice(0, 200),
);
check(
  "roles are provable only: a website account is a student, an unlinked app account is not",
  hasSummary(vx.json.user) &&
    vx.json.user.roles.includes("student") &&
    me.json.user.roles.length === 0,
  JSON.stringify({ vx: vx.json.user?.roles, app: me.json.user?.roles }),
);
const moderator = await reg("prop-mod@x.com", "Prop Mod");
db._db.prepare("UPDATE users SET moderator = 1 WHERE id = ?").run(moderator.user.id);
const modSeen = await call(
  "GET",
  `/api/users?realm=all&q=${encodeURIComponent(moderator.user.username)}`,
  undefined,
  A.token,
);
check(
  "the moderator flag shows up as a role, on the row the server owns",
  hasSummary(modSeen.json.users?.[0]) && modSeen.json.users[0].roles.includes("moderator"),
  JSON.stringify(modSeen.json.users?.[0]?.roles),
);

// ---------------------------------------------------- 2. linked flips, both sides
check(
  "a fresh app account reports linked: false",
  me.json.user.linked === false && me.json.user.roles.includes("student") === false,
);
const pair = await call("POST", "/api/conversations", { userId: vxId }, A.token);
const convId = pair.json.conversation?.id;
const detail = await call("GET", `/api/conversations/${convId}`, undefined, A.token);
check(
  "member shapes inside a conversation carry the summary (nested surfaces cannot miss a badge)",
  detail.status === 200 &&
    Array.isArray(detail.json.conversation?.members) &&
    detail.json.conversation.members.length >= 2 &&
    detail.json.conversation.members.every((m) => hasSummary(m.user)) &&
    detail.json.conversation.members.some((m) => m.user.origin_realm === "vx"),
  JSON.stringify(detail.json.conversation?.members?.[0] ?? {}).slice(0, 200),
);

const initiated = await call("POST", "/api/links/approvals", { targetRealm: "vx" }, A.token);
const approval = initiated.json.approval ?? {};
const approved = await call(
  "POST",
  `/api/links/approvals/${approval.id}/approve`,
  { code: approval.code, confirm: true },
  vx.json.token,
);
check(
  "the ceremony itself still works",
  approved.status === 200,
  JSON.stringify(approved.json).slice(0, 160),
);
const afterLink = await call("GET", "/api/me", undefined, A.token);
const linkedRow = db._db.prepare("SELECT linked FROM users WHERE id = ?").get(A.user.id);
check(
  "approving a link flips linked on the app account AND implies the student role",
  afterLink.json.user.linked === true &&
    afterLink.json.user.roles.includes("student") &&
    linkedRow.linked === 1,
  JSON.stringify({ user: afterLink.json.user, row: linkedRow }),
);
check(
  "the website side of the same link reads linked too (both sides, one truth)",
  db._db.prepare("SELECT linked FROM users WHERE id = ?").get(vxId).linked === 1,
);
const linkRow = db._db
  .prepare("SELECT id FROM identity_links WHERE a_user_id = ? OR b_user_id = ?")
  .get(A.user.id, A.user.id);
await call("POST", `/api/links/${approved.json.link?.id ?? linkRow?.id ?? ""}/revoke`, {}, A.token);
const afterRevoke = await call("GET", "/api/me", undefined, A.token);
check(
  "revoking clears the flag and the implied role on both accounts",
  afterRevoke.json.user.linked === false &&
    afterRevoke.json.user.roles.includes("student") === false &&
    db._db.prepare("SELECT linked FROM users WHERE id = ?").get(vxId).linked === 0,
  JSON.stringify(afterRevoke.json.user),
);

// ---------------------------------------- 3. a client cannot inject identity facts
const injected = await call(
  "PATCH",
  "/api/me",
  {
    displayName: "Prop Alpha Renamed",
    origin_realm: "vx",
    originRealm: "vx",
    linked: true,
    roles: ["admin", "moderator"],
    realm: "vx",
  },
  A.token,
);
check(
  "PATCH /api/me applies the name and nothing else: no realm, no link, no roles",
  injected.status === 200 &&
    injected.json.user.displayName === "Prop Alpha Renamed" &&
    injected.json.user.origin_realm === "kp" &&
    injected.json.user.linked === false &&
    !injected.json.user.roles.includes("admin") &&
    !injected.json.user.roles.includes("moderator"),
  JSON.stringify(injected.json.user ?? {}).slice(0, 220),
);
const forgedBadge = await call("PATCH", "/api/me", { badge: "kp" }, A.token);
check(
  "a realm can never be worn as a badge choice",
  forgedBadge.status === 400 && forgedBadge.json.error?.code === "BAD_BADGE",
  JSON.stringify(forgedBadge.json).slice(0, 140),
);

// --------------------------- 4. the message snapshot, and surviving deletion
const sent = await call(
  "POST",
  `/api/conversations/${convId}/messages`,
  {
    kind: "TEXT",
    body: "propagation check",
    clientId: "prop-client-1",
    // A malicious/buggy client naming its own identity fields.
    senderRealm: "vx",
    origin_realm: "vx",
    senderName: "Not The Sender",
  },
  A.token,
);
check("the message lands", sent.status === 201, JSON.stringify(sent.json).slice(0, 160));
const stored = db._db
  .prepare("SELECT sender_realm, sender_id FROM messages WHERE client_id = 'prop-client-1'")
  .get();
check(
  "the stored message carries the SENDER's realm from the server's own row",
  stored.sender_realm === "kp" && stored.sender_id === A.user.id,
  JSON.stringify(stored),
);
const page = await call("GET", `/api/conversations/${convId}/messages`, undefined, A.token);
const mine = (page.json.messages ?? page.json.items ?? []).find(
  (m) => m.clientId === "prop-client-1",
);
check(
  "the history page hands out the realm beside the name (and the immutable sender id)",
  !!mine &&
    mine.senderId === A.user.id &&
    mine.senderRealm === "kp" &&
    mine.senderName === "Prop Alpha Renamed",
  JSON.stringify(mine ?? {}).slice(0, 200),
);
// Simulate a future account deletion: the only delete path today cannot leave
// history behind, but the snapshot must be what a reader falls back on.
db._db.prepare("DELETE FROM users WHERE id = ?").run(A.user.id);
const afterDelete = await call(
  "GET",
  `/api/conversations/${convId}/messages`,
  undefined,
  vx.json.token,
);
const orphan = (afterDelete.json.messages ?? afterDelete.json.items ?? []).find(
  (m) => m.clientId === "prop-client-1",
);
check(
  "a deleted sender keeps a NEUTRAL surface and a truthful historical origin marker",
  !!orphan && orphan.senderName === undefined && orphan.senderRealm === "kp",
  JSON.stringify(orphan ?? {}).slice(0, 200),
);
check(
  "and the reused handle cannot inherit that history (ids, not names, are the key)",
  db._db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'propalpha'").get().n === 0,
);

// ------------------------------------------------------------- 5. events
const device = await call(
  "POST",
  "/api/devices",
  { token: "fcm-prop-token", platform: "ANDROID", deviceId: "prop-install" },
  vx.json.token,
);
check(
  "the callee has a push device",
  device.status === 200,
  JSON.stringify(device.json).slice(0, 120),
);
broadcasts.length = 0;
const B2 = B; // the surviving account
const conv2 = (await call("POST", "/api/conversations", { userId: vxId }, B2.token)).json
  .conversation.id;
await call(
  "POST",
  `/api/conversations/${conv2}/messages`,
  { kind: "TEXT", body: "frame check" },
  B2.token,
);
const frame = broadcasts.find((b) => b.body?.type === "message");
check(
  "the message frame names the sender by immutable id AND realm",
  !!frame &&
    frame.body.message?.senderId === B2.user.id &&
    frame.body.message?.senderRealm === "kp" &&
    frame.room === conv2,
  JSON.stringify(frame?.body ?? {}).slice(0, 200),
);
broadcasts.length = 0;
const callStart = await call("POST", "/api/calls", { userId: vxId, kind: "AUDIO" }, B2.token);
const callFrame = broadcasts.find((b) => b.body?.type === "call" && b.body?.fromId);
check(
  "the call ring frame carries the caller's realm with the immutable id",
  !!callFrame && callFrame.body.fromRealm === "kp" && callFrame.body.fromId === B2.user.id,
  JSON.stringify(callFrame?.body ?? {}).slice(0, 160),
);
// The ring push sits behind the 700ms anti-phantom gate, so it settles with
// the drain above — read it BEFORE the hangup flips the row to ENDED.
const callPush = pushes.find((p) => p.message?.android?.data?.type === "call");
check(
  "the same rule holds for the ringing push (server-read realm, no badge field from the client)",
  !!callPush && callPush.message.android.data.fromRealm === "kp",
  JSON.stringify(callPush?.message?.android?.data ?? {}).slice(0, 200),
);
await call(
  "POST",
  `/api/calls/${callStart.json.call?.id ?? ""}/end`,
  { reason: "hangup" },
  B2.token,
);

// --------------------------------------------------------------- 6. pushes
pushes.length = 0;
await call(
  "POST",
  `/api/conversations/${conv2}/messages`,
  { kind: "TEXT", body: "push check", origin_realm: "vx", senderRealm: "vx" },
  B2.token,
);
const messagePush = pushes.find((p) => p.message?.android?.data?.type === "message");
const data = messagePush?.message?.android?.data ?? {};
check(
  "the message push carries the realm and username the SERVER read from the sender",
  data.type === "message" &&
    data.fromId === B2.user.id &&
    data.kp_from_realm === "kp" &&
    data.kp_from_username === B2.user.username,
  JSON.stringify(data).slice(0, 240),
);
check(
  "a client-supplied realm in the body never reaches the card",
  JSON.stringify(messagePush ?? {}).includes("vx") === false,
  JSON.stringify(messagePush ?? {}).slice(0, 200),
);

// --------------------------------------------------------- 7. moderation snapshots
const blocked = await call("POST", "/api/blocks", { userId: B2.user.id }, vx.json.token);
const blockRow = db._db
  .prepare("SELECT owner_id, target_id, owner_realm, target_realm FROM blocks WHERE owner_id = ?")
  .get(vxId);
check(
  "a block keeps BOTH realms as they were at event time",
  blocked.status === 200 && blockRow?.owner_realm === "vx" && blockRow?.target_realm === "kp",
  JSON.stringify(blockRow ?? {}),
);
const blocklist = await call("GET", "/api/blocks", undefined, vx.json.token);
check(
  "the blocklist hands the snapshot out beside the live shape",
  blocklist.status === 200 && blocklist.json.users?.[0]?.realm_at_event === "kp",
  JSON.stringify(blocklist.json.users?.[0] ?? {}).slice(0, 200),
);
await call("POST", "/api/reports", { userId: B2.user.id, reason: "spam" }, vx.json.token);
const report = db._db
  .prepare(
    "SELECT realm, actor_id, subject_id, detail_json FROM realm_audit WHERE action = 'moderation.report'",
  )
  .get();
check(
  "a report is audited with the realm of BOTH sides at event time",
  !!report &&
    report.realm === "vx" &&
    report.actor_id === vxId &&
    report.subject_id === B2.user.id &&
    JSON.parse(report.detail_json).targetRealm === "kp",
  JSON.stringify(report ?? {}),
);

// --------------------------------------------------------- 8. bridge assertions
const withIdentity = await call("POST", "/api/auth/realm/exchange", {
  assertion: sign({
    sub: "prop-laravel-1",
    handle: "prop_student",
    displayName: "Prop Student",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60_000,
    communicationId: vxId,
    originRealm: "vx",
  }),
  deviceId: "web-prop-2",
});
check(
  "an assertion that NAMES the communication id + realm is accepted and answered with the mapping",
  withIdentity.status === 200 &&
    withIdentity.json.communicationId === vxId &&
    withIdentity.json.origin_realm === "vx",
  JSON.stringify(withIdentity.json).slice(0, 200),
);
const wrongId = await call("POST", "/api/auth/realm/exchange", {
  assertion: sign({
    sub: "prop-laravel-1",
    handle: "prop_student",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60_000,
    communicationId: "not-this-account",
  }),
});
check(
  "an assertion naming somebody ELSE's communication id is refused, not silently ignored",
  wrongId.status === 409 && wrongId.json.error?.code === "IDENTITY_MISMATCH",
  JSON.stringify(wrongId.json).slice(0, 160),
);
const wrongRealm = await call("POST", "/api/auth/realm/exchange", {
  assertion: sign({
    sub: "prop-laravel-1",
    handle: "prop_student",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60_000,
    originRealm: "kp",
  }),
});
check(
  "an assertion naming a realm this bridge cannot sign for is refused",
  wrongRealm.status === 409 && wrongRealm.json.error?.code === "REALM_MISMATCH",
  JSON.stringify(wrongRealm.json).slice(0, 160),
);

// -------------------------------------------------------------- 9. cache keys
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
const avatars = read("web/src/messaging/avatars.ts");
check(
  "the web avatar cache is keyed by the immutable ref (id@version), never a username",
  /cache\.set\(ref,/.test(avatars) &&
    /avatarRef/.test(avatars) &&
    !/cache\.set\([^)]*username/.test(avatars),
);
const androidCache = read("native-android/app/src/main/java/app/kuchupuchu/android/Cache.kt");
check(
  "the phone cache is keyed by the request path (immutable ids), never a display name",
  /fun put\(path: String/.test(androidCache) && /cacheFileName\(path/.test(androidCache),
);
const androidUi = read("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt");
check(
  "the phone resolves avatars by id and version, exactly like the web ref",
  /ref\.substringBefore\("@v"\)/.test(androidUi) &&
    /Api\.get\("\/api\/users\/\$ownerId\/avatar"/.test(androidUi) &&
    /AvatarRefs\.get\(ctx, ref\)/.test(androidUi),
);

// ------------------------------------------------- 10. the web doorbell
// The browser doorbell is the strictest surface of all: its payload names NO
// identity, so there is no field for a badge to be forged in, and its copy is
// a constant in the app — never composed from anything a client sent.
const pushModel = read("web/src/push/pushModel.ts");
check(
  "the web push payload parses only the three coarse flags (no identity, no realm)",
  /data\.t === "kp\.call"/.test(pushModel) &&
    /data\.s === 1/.test(pushModel) &&
    /data\.m === 1/.test(pushModel) &&
    /origin_?[Rr]ealm|username|displayName/.test(pushModel) === false,
);
check(
  "the doorbell copy is app-owned text, never built from a wire field",
  /title: "KuchuPuchu"/.test(pushModel) && !/\$\{[^}]*payload/.test(pushModel),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
