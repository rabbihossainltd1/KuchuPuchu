import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const worker = (await import(`${WORKER}?nicknames=${n++}`)).default;
const db = makeD1();
const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
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
    headers["cf-connecting-ip"] = `203.30.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
    json = { _raw: text.slice(0, 100) };
  }
  return { status: response.status, json };
};
const reg = makeReg(call);
const A = await reg("nick-a@x.com", "Nick A");
const B = await reg("nick-b@x.com", "Nick B");
const C = await reg("nick-c@x.com", "Nick C");
const D = await reg("nick-d@x.com", "Nick D");
const users = (detail) => (detail?.members ?? []).map((member) => member.user);
const userIn = (detail, id) => users(detail).find((user) => user.id === id);

const direct = await call("POST", "/api/conversations", { userId: B.user.id }, A.token);
const directId = direct.json.conversation?.id;
const globalBefore = await call("GET", `/api/users/${B.user.id}`, undefined, A.token);
const first = await call(
  "PUT",
  `/api/conversations/${directId}/nicknames/${B.user.id}`,
  { nickname: "  🌿 Bestie\n" },
  A.token,
);
const detailA = await call("GET", `/api/conversations/${directId}`, undefined, A.token);
const detailB = await call("GET", `/api/conversations/${directId}`, undefined, B.token);
const globalAfter = await call("GET", `/api/users/${B.user.id}`, undefined, A.token);
check(
  "a 1:1 nickname is stored in that conversation and is visible to both participants",
  first.status === 200 &&
    first.json.nickname === "🌿 Bestie" &&
    detailA.json.conversation.other?.nickname === "🌿 Bestie" &&
    userIn(detailB.json.conversation, B.user.id)?.nickname === "🌿 Bestie",
  JSON.stringify({
    status: first.status,
    a: detailA.json.conversation?.other?.nickname,
    b: userIn(detailB.json.conversation, B.user.id)?.nickname,
  }),
);
check(
  "the conversation nickname never changes the account's global profile name",
  globalBefore.status === 200 &&
    globalAfter.status === 200 &&
    globalAfter.json.user.displayName === globalBefore.json.user.displayName,
  JSON.stringify({
    before: globalBefore.json.user?.displayName,
    after: globalAfter.json.user?.displayName,
  }),
);

const otherEditor = await call(
  "PUT",
  `/api/conversations/${directId}/nicknames/${A.user.id}`,
  { nickname: "Nick B calls A" },
  B.token,
);
const changedByB = await call("GET", `/api/conversations/${directId}`, undefined, A.token);
check(
  "either participant can set/change a shared alias for a member",
  otherEditor.status === 200 &&
    userIn(changedByB.json.conversation, A.user.id)?.nickname === "Nick B calls A",
  JSON.stringify({
    status: otherEditor.status,
    alias: userIn(changedByB.json.conversation, A.user.id)?.nickname,
  }),
);

const group = await call(
  "POST",
  "/api/conversations/group",
  { title: "Nicknames", memberIds: [B.user.id, C.user.id] },
  A.token,
);
const groupId = group.json.conversation?.id;
const setGroup = await call(
  "PUT",
  `/api/conversations/${groupId}/nicknames/${C.user.id}`,
  { nickname: "Captain" },
  B.token,
);
const groupA = await call("GET", `/api/conversations/${groupId}`, undefined, A.token);
const groupB = await call("GET", `/api/conversations/${groupId}`, undefined, B.token);
const groupC = await call("GET", `/api/conversations/${groupId}`, undefined, C.token);
check(
  "any group member can nickname another member, and every group member receives the same alias",
  setGroup.status === 200 &&
    [groupA, groupB, groupC].every(
      (result) => userIn(result.json.conversation, C.user.id)?.nickname === "Captain",
    ),
  JSON.stringify(
    [groupA, groupB, groupC].map((result) => userIn(result.json.conversation, C.user.id)?.nickname),
  ),
);

const changedGroup = await call(
  "PUT",
  `/api/conversations/${groupId}/nicknames/${C.user.id}`,
  { nickname: "All-rounder" },
  A.token,
);
const groupBUpdated = await call("GET", `/api/conversations/${groupId}`, undefined, B.token);
const directAfterGroup = await call("GET", `/api/conversations/${directId}`, undefined, A.token);
const outsider = await call(
  "PUT",
  `/api/conversations/${groupId}/nicknames/${C.user.id}`,
  { nickname: "Not allowed" },
  D.token,
);
check(
  "group nicknames can be changed by another member, remain conversation-scoped, and reject non-members",
  changedGroup.status === 200 &&
    userIn(groupBUpdated.json.conversation, C.user.id)?.nickname === "All-rounder" &&
    directAfterGroup.json.conversation.other?.nickname === "🌿 Bestie" &&
    outsider.status === 403,
  JSON.stringify({
    group: userIn(groupBUpdated.json.conversation, C.user.id)?.nickname,
    direct: directAfterGroup.json.conversation?.other?.nickname,
    outsider: outsider.status,
  }),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
