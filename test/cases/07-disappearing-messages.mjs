// Disappearing messages.
//
// The reaper was `DELETE FROM messages WHERE conv_id = ? AND created_at < ?`
// with no lower bound, run on every read of the chat. Switching the timer on
// therefore destroyed the conversation's entire existing history for both
// people, when it is supposed to apply only to messages sent after it was
// enabled. It also wrote to the messages table on every poll.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 3}`;
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
  return { db, call, reg, solo, send, msgs };
}

{
  const k = await mk();
  const A = await k.reg("da@x.com", "da");
  const B = await k.reg("db@x.com", "db");
  const cid = await k.solo(A, B.user.id);

  await k.send(A, cid, "history-1");
  await k.send(B, cid, "history-2");
  await k.send(A, cid, "history-3");
  check("three messages before the timer", (await k.msgs(A, cid)).length === 3);

  // 1. turning the timer on must not touch what is already there
  const patch = await k.call(
    "PATCH",
    `/api/conversations/${cid}`,
    { disappearSeconds: 1 },
    A.token,
  );
  check("the timer can be set", patch.status === 200, String(patch.status));
  const since = k.db._db
    .prepare("SELECT disappear_since FROM conversations WHERE id = ?")
    .get(cid).disappear_since;
  check(
    "the switch-on moment is recorded",
    typeof since === "string" && since.length > 0,
    String(since),
  );

  await sleep(1300); // longer than the 1s TTL
  const after = await k.msgs(A, cid);
  check(
    "pre-existing history SURVIVES the timer",
    after.length === 3,
    JSON.stringify(after.map((m) => m.body)),
  );
  const stillThere = k.db._db
    .prepare("SELECT COUNT(*) n FROM messages WHERE conv_id = ?")
    .get(cid).n;
  check("and is not deleted from storage either", stillThere >= 3, String(stillThere));

  // 2. a message sent after the timer does expire
  await k.send(A, cid, "ephemeral");
  check(
    "the new message is visible straight away",
    (await k.msgs(A, cid)).some((m) => m.body === "ephemeral"),
  );
  await sleep(1300);
  const later = await k.msgs(A, cid);
  check(
    "a message sent after the timer expires",
    !later.some((m) => m.body === "ephemeral"),
    JSON.stringify(later.map((m) => m.body)),
  );
  check(
    "but the old history is still there",
    later.filter((m) => String(m.body).startsWith("history-")).length === 3,
    JSON.stringify(later.map((m) => m.body)),
  );

  // 3. reading the chat must not write on every poll
  {
    k.db._stats.reset();
    await k.msgs(A, cid);
    const first = k.db._stats.writes;
    await k.msgs(A, cid);
    const second = k.db._stats.writes - first;
    check("the reaper is throttled, not per-read", second === 0, `${first} then ${second} writes`);
  }

  // 4. turning the timer off clears the stamp
  const off = await k.call("PATCH", `/api/conversations/${cid}`, { disappearSeconds: 0 }, A.token);
  const cleared = k.db._db
    .prepare("SELECT disappear_seconds, disappear_since FROM conversations WHERE id = ?")
    .get(cid);
  check(
    "turning it off resets both fields",
    off.status === 200 && cleared.disappear_seconds === 0 && cleared.disappear_since === null,
    JSON.stringify(cleared),
  );
}

// A group: only the owner may switch the timer on at all.
{
  const k = await mk();
  const A = await k.reg("ga@x.com", "ga");
  const B = await k.reg("gb@x.com", "gb");
  const g = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "G", memberIds: [B.user.id] },
      A.token,
    )
  ).json.conversation.id;
  await k.send(A, g, "old");
  const member = await k.call("PATCH", `/api/conversations/${g}`, { disappearSeconds: 1 }, B.token);
  check("a plain member cannot arm the timer", member.status === 403, String(member.status));
  const owner = await k.call("PATCH", `/api/conversations/${g}`, { disappearSeconds: 1 }, A.token);
  check("the owner can", owner.status === 200, String(owner.status));
  await sleep(1300);
  check(
    "and even then the pre-existing message survives",
    (await k.msgs(A, g)).some((m) => m.body === "old"),
    JSON.stringify((await k.msgs(A, g)).map((m) => m.body)),
  );
}

// `/vanish` is per-message: a sender reading their own row does not start it;
// the first other member does, and later group readers cannot extend it.
{
  const k = await mk();
  const A = await k.reg("vanish-a@x.com", "vanisha");
  const B = await k.reg("vanish-b@x.com", "vanishb");
  const C = await k.reg("vanish-c@x.com", "vanishc");
  const cid = await k.solo(A, B.user.id);
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "TEXT", body: "one-minute note", meta: { vanish: true } },
    A.token,
  );
  const messageId = sent.json.message?.id;
  const beforeRead = k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(messageId);
  const senderRead = await k.call("POST", `/api/conversations/${cid}/read`, {}, A.token);
  const afterSenderRead = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(messageId).meta_json,
  );
  const firstRecipientRead = await k.call("POST", `/api/conversations/${cid}/read`, {}, B.token);
  const startedRow = k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(messageId);
  const startedMeta = JSON.parse(startedRow.meta_json);
  const startedMs = Date.parse(startedMeta.vanishStartedAt);
  const expiryMs = Date.parse(startedMeta.vanishExpiresAt);
  const earlyExpire = await k.call("POST", `/api/messages/${messageId}/expire`, {}, A.token);
  await k.call("POST", `/api/conversations/${cid}/read`, {}, B.token);
  const rereadMeta = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(messageId).meta_json,
  );

  check(
    "a sender opening their own /vanish message does not start the clock; the first recipient read starts exactly one minute",
    senderRead.status === 200 &&
      senderRead.json.vanishStarted === 0 &&
      !afterSenderRead.vanishExpiresAt &&
      firstRecipientRead.status === 200 &&
      firstRecipientRead.json.vanishStarted === 1 &&
      Number.isFinite(startedMs) &&
      Math.abs(expiryMs - startedMs - 60_000) < 2_000,
    JSON.stringify({
      senderRead: senderRead.json,
      recipientRead: firstRecipientRead.json,
      meta: startedMeta,
      beforeRead: beforeRead?.meta_json,
    }),
  );
  check(
    "the expiration endpoint waits for the shared deadline and rereading does not extend it",
    earlyExpire.status === 200 &&
      earlyExpire.json.expired === false &&
      rereadMeta.vanishExpiresAt === startedMeta.vanishExpiresAt,
    JSON.stringify({ earlyExpire: earlyExpire.json, after: rereadMeta.vanishExpiresAt }),
  );

  const past = new Date(Date.now() - 1_000).toISOString();
  startedMeta.vanishExpiresAt = past;
  k.db._db
    .prepare("UPDATE messages SET meta_json = ? WHERE id = ?")
    .run(JSON.stringify(startedMeta), messageId);
  const expired = await k.call("POST", `/api/messages/${messageId}/expire`, {}, B.token);
  const senderRows = await k.msgs(A, cid);
  const recipientRows = await k.msgs(B, cid);
  check(
    "at the deadline /expire deletes for both participants without leaving a tombstone",
    expired.status === 200 &&
      expired.json.expired === true &&
      !senderRows.some((row) => row.id === messageId) &&
      !recipientRows.some((row) => row.id === messageId) &&
      k.db._db.prepare("SELECT COUNT(*) n FROM messages WHERE id = ?").get(messageId).n === 0,
    JSON.stringify({
      status: expired.status,
      expired: expired.json.expired,
      senderRows: senderRows.map((row) => row.id),
      recipientRows: recipientRows.map((row) => row.id),
    }),
  );

  const group = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "First reader", memberIds: [B.user.id, C.user.id] },
      A.token,
    )
  ).json.conversation.id;
  const groupSend = await k.call(
    "POST",
    `/api/conversations/${group}/messages`,
    { kind: "TEXT", body: "group vanish", meta: { vanish: true } },
    A.token,
  );
  const groupId = groupSend.json.message?.id;
  const firstGroupRead = await k.call("POST", `/api/conversations/${group}/read`, {}, B.token);
  const groupExpiry = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(groupId).meta_json,
  ).vanishExpiresAt;
  const secondGroupRead = await k.call("POST", `/api/conversations/${group}/read`, {}, C.token);
  const groupExpiryAfter = JSON.parse(
    k.db._db.prepare("SELECT meta_json FROM messages WHERE id = ?").get(groupId).meta_json,
  ).vanishExpiresAt;
  check(
    "a group uses the first recipient's read as the shared start; another member cannot restart the one-minute timer",
    firstGroupRead.json.vanishStarted === 1 &&
      secondGroupRead.json.vanishStarted === 0 &&
      groupExpiry === groupExpiryAfter,
    JSON.stringify({
      first: firstGroupRead.json,
      second: secondGroupRead.json,
      groupExpiry,
      groupExpiryAfter,
    }),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
