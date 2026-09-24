// Regression suite for the delete-chat watermark work.
//
//   - sending a message used to reset hidden_json to '{}' for the whole
//     conversation, so one member writing a message undeleted the chat for
//     every other member;
//   - the watermark was only consulted by the conversation *list*, never by
//     the message history, so a chat that reappeared came back with all the
//     messages its owner had deleted.
//
// Every line prints OK or BROKEN. BROKEN means the behaviour is wrong.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `198.51.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
    return { status: res.status, json: j };
  };
  const reg = makeReg(call);
  const solo = async (a, b) =>
    (await call("POST", "/api/conversations", { userId: b }, a.token)).json.conversation.id;
  const send = async (a, cid, body) =>
    (await call("POST", `/api/conversations/${cid}/messages`, { body }, a.token)).json;
  const msgs = async (a, cid) =>
    (await call("GET", `/api/conversations/${cid}/messages`, undefined, a.token)).json.items || [];
  const list = async (a) =>
    ((await call("GET", "/api/conversations", undefined, a.token)).json.items || []).map(
      (c) => c.id,
    );
  return { db, call, reg, solo, send, msgs, list };
}

// ---- 1. deleting a chat, then a new message: only the new message returns ----
{
  const k = await mk();
  const A = await k.reg("wa@x.com", "wa");
  const B = await k.reg("wb@x.com", "wb");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "old-1");
  await k.send(A, cid, "old-2");
  // r68-7: the popup's checkbox TICKED = the rows go for both members.
  const del = await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: true }, B.token);
  check("B can delete the chat (checkbox ticked)", del.status === 200, String(del.status));
  check(
    "deleted chat is gone from B's list",
    !(await k.list(B)).includes(cid),
    JSON.stringify(await k.list(B)),
  );
  // r68-7 (ticked): owner — "duijoner thekei chat delete hoye jabe shob
  // permanently". The chat leaves BOTH lists; the old shape left an empty
  // shell in A's list, which is no longer what a ticked delete means.
  check(
    "A loses it too — permanently, on both sides",
    !(await k.list(A)).includes(cid),
    JSON.stringify(await k.list(A)),
  );
  check(
    "round 13 real-delete (r68-7, ticked): even A's copy of the history is gone",
    (await k.msgs(A, cid)).length === 0,
    String((await k.msgs(A, cid)).length),
  );

  await k.send(A, cid, "new-1");
  const bList = await k.list(B);
  check("a new message brings the chat back for B", bList.includes(cid), JSON.stringify(bList));
  const bMsgs = await k.msgs(B, cid);
  check(
    "B sees ONLY the message sent after the delete",
    bMsgs.length === 1 && bMsgs[0].body === "new-1",
    JSON.stringify(bMsgs.map((m) => m.body)),
  );
}

// ---- 2. deleting a GROUP is a leave, not a hide: confirm that is what happens ----
{
  const k = await mk();
  const A = await k.reg("xa@x.com", "xa");
  const B = await k.reg("xb@x.com", "xb");
  const C = await k.reg("xc@x.com", "xc");
  const g = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "G", memberIds: [B.user.id, C.user.id] },
      A.token,
    )
  ).json.conversation.id;
  await k.send(A, g, "hello all");
  await k.call("DELETE", `/api/conversations/${g}`, undefined, B.token);
  check(
    "B left the group and no longer lists it",
    !(await k.list(B)).includes(g),
    JSON.stringify(await k.list(B)),
  );
  check("C, who did not leave, still lists it", (await k.list(C)).includes(g));
  await k.send(A, g, "second");
  const cMsgs = await k.msgs(C, g);
  check(
    "C keeps the full history including the pre-leave message",
    cMsgs.some((m) => m.body === "hello all") && cMsgs.some((m) => m.body === "second"),
    JSON.stringify(cMsgs.map((m) => m.body)),
  );
}

// ---- 3. a member who did NOT delete keeps their full history ----
{
  const k = await mk();
  const A = await k.reg("ya@x.com", "ya");
  const B = await k.reg("yb@x.com", "yb");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "m1");
  await k.send(B, cid, "m2");
  await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: true }, B.token);
  await k.send(A, cid, "m3");
  const aMsgs = await k.msgs(A, cid);
  check(
    "round 13 (r68-7, ticked): a 1:1 delete wipes it for both sides; A sees only the post-delete message",
    aMsgs.length === 1 && aMsgs[0].body === "m3",
    JSON.stringify(aMsgs.map((m) => m.body)),
  );
}

// ---- 3b. r68-7: the checkbox LEFT UNTICKED — only my copy goes, the other
// side keeps every message (owner: "tick na korle just tar kache theke delete
// hobe je koreche") ----
{
  const k = await mk();
  const A = await k.reg("y2a@x.com", "y2a");
  const B = await k.reg("y2b@x.com", "y2b");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "m1");
  await k.send(B, cid, "m2");
  // r69: age both rows before the unticked delete. The watermark is the delete's
  // instant and the round-13 guard keeps a row created AT that instant visible
  // (data-loss protection) — on a fast machine the delete can share the second
  // message's millisecond and the row then survives, reviving the chat. The
  // fixture must be clearly older than the delete (CI caught this on case 44).
  const aged = new Date(Date.now() - 90_000).toISOString();
  await k.db._db
    .prepare("UPDATE messages SET created_at = ? WHERE conv_id = ? AND kind = 'TEXT'")
    .run(aged, cid);
  await k.db._db
    .prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?")
    .run(aged, cid);
  const del = await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: false }, B.token);
  check(
    "r68-7 (unticked): the answer says so",
    del.status === 200 && del.json.forEveryone === false,
    `${del.status} ${JSON.stringify(del.json).slice(0, 60)}`,
  );
  check(
    "r68-7 (unticked): the chat leaves MY list",
    !(await k.list(B)).includes(cid),
    JSON.stringify(await k.list(B)),
  );
  check(
    "r68-7 (unticked): my history is cut at the delete",
    (await k.msgs(B, cid)).length === 0,
    JSON.stringify((await k.msgs(B, cid)).map((m) => m.body)),
  );
  check(
    "r68-7 (unticked): the OTHER side keeps everything — its list row and its history are untouched",
    (await k.list(A)).includes(cid) &&
      JSON.stringify((await k.msgs(A, cid)).map((m) => m.body)) === JSON.stringify(["m1", "m2"]),
    JSON.stringify({
      list: (await k.list(A)).includes(cid),
      msgs: (await k.msgs(A, cid)).map((m) => m.body),
    }),
  );
  await k.send(A, cid, "m3");
  const bAfter = await k.msgs(B, cid);
  check(
    "r68-7 (unticked): a newer message brings the chat back for me with only what is new",
    (await k.list(B)).includes(cid) && bAfter.length === 1 && bAfter[0].body === "m3",
    JSON.stringify({ msgs: bAfter.map((m) => m.body), list: (await k.list(B)).includes(cid) }),
  );
  // …and the same chat, now deleted with the checkbox TICKED, is permanent
  // for both — the path the round-13 checks above have always driven.
  await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: true }, B.token);
  check(
    "r68-7 (ticked): BOTH histories are empty afterwards",
    (await k.msgs(A, cid)).length === 0 && (await k.msgs(B, cid)).length === 0,
    JSON.stringify({ a: (await k.msgs(A, cid)).length, b: (await k.msgs(B, cid)).length }),
  );
}

// ---- 4. deleting a SOLO chat twice in a row stays hidden ----
{
  const k = await mk();
  const A = await k.reg("za@x.com", "za");
  const B = await k.reg("zb@x.com", "zb");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "one");
  await k.call("DELETE", `/api/conversations/${cid}`, undefined, B.token);
  await k.send(A, cid, "two");
  await k.call("DELETE", `/api/conversations/${cid}`, undefined, B.token);
  check(
    "deleting again re-hides the chat",
    !(await k.list(B)).includes(cid),
    JSON.stringify(await k.list(B)),
  );
  await k.send(A, cid, "three");
  const bMsgs = await k.msgs(B, cid);
  check(
    "and only messages after the second delete return",
    bMsgs.length === 1 && bMsgs[0].body === "three",
    JSON.stringify(bMsgs.map((m) => m.body)),
  );
}

// ---- 5. paging still works while a watermark is active ----
{
  const k = await mk();
  const A = await k.reg("va@x.com", "va");
  const B = await k.reg("vb@x.com", "vb");
  const cid = await k.solo(A, B.user.id);
  for (let i = 0; i < 60; i++) await k.send(A, cid, `m${i}`);
  await k.call("DELETE", `/api/conversations/${cid}`, undefined, B.token);
  for (let i = 0; i < 3; i++) await k.send(A, cid, `after${i}`);
  const page = await k.msgs(B, cid);
  check(
    "watermark + LIMIT agree: only post-delete messages",
    page.every((m) => String(m.body).startsWith("after")) && page.length === 3,
    JSON.stringify(page.map((m) => m.body)),
  );
}

// ---- 6. a message written in the same millisecond as the delete is kept ----
// This is the case that used to lose data: created_at is millisecond-resolution,
// so `created_at > watermark` put a same-millisecond message on the wrong side
// and the recipient never saw it.
{
  const k = await mk();
  const A = await k.reg("wa2@x.com", "wa2");
  const B = await k.reg("wb2@x.com", "wb2");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "before");
  const del = await k.call("DELETE", `/api/conversations/${cid}`, undefined, B.token);
  check("delete succeeded", del.status === 200, String(del.status));
  const hiddenRaw = k.db._db
    .prepare("SELECT hidden_json FROM conversations WHERE id = ?")
    .get(cid).hidden_json;
  const mark = JSON.parse(hiddenRaw)[B.user.id];
  check(
    "round 13: the shell stays hidden via a TIME watermark ({row:-1})",
    typeof mark === "object" && typeof mark.row === "number" && mark.row === -1,
    JSON.stringify(mark),
  );
  // Force the next message to share the watermark's exact millisecond.
  const same = await k.send(A, cid, "same-ms");
  const mid = same.message.id;
  k.db._db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(mark.at, mid);
  const bMsgs = await k.msgs(B, cid);
  check(
    "a same-millisecond message is NOT lost",
    bMsgs.some((m) => m.body === "same-ms"),
    JSON.stringify(bMsgs.map((m) => m.body)),
  );
  check(
    "and the pre-delete message stays hidden",
    !bMsgs.some((m) => m.body === "before"),
    JSON.stringify(bMsgs.map((m) => m.body)),
  );
  check("the chat is visible again because a newer row exists", (await k.list(B)).includes(cid));
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
