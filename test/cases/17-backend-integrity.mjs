// Backend integrity + abuse guards (regression suite for the review report).
//
// Every case here runs the REAL worker over the sqlite shim, because each one is
// about behaviour the type checker cannot see: a route that mints rows for a user
// who does not exist, a preview column that silently goes stale, a profile that
// keeps leaking through a second URL, a limiter you can reset by flooding it, a
// status poll that costs hundreds of D1 statements, and an append-only debug table
// nobody prunes.
//
// The statuses case asserts on STATEMENT COUNT, not timing — the free-tier
// row-read limit does not care how fast each query is, and D1 counts round trips.

import { readFile } from "node:fs/promises";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, fakeIdToken } from "../helpers/phoneauth.mjs";

installGoogleStub();
import { MESSAGE_MAX_LENGTH } from "../../src/shared/constants.ts";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const worker = await freshWorker();
  const env = { DB: makeD1(), MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const raw = body instanceof Uint8Array;
    const headers = { "content-type": raw ? "application/octet-stream" : "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    // Auth routes are rate limited per client IP, so give every registration its
    // own address unless the test is specifically about the limiter.
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.1.${(ipSeq >> 8) & 255}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = raw ? body : JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 60) };
    }
    return { status: res.status, json: j, headers: res.headers };
  };
  const regByTag = makeReg(call);
  const reg = async (tag) => {
    const r = await regByTag(`${tag}@x.com`, tag);
    if (!r.user) throw new Error(`register ${tag} failed: ${JSON.stringify(r).slice(0, 90)}`);
    return r;
  };
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);
  // Statement trace: some bugs are not visible in the payload at all. The list
  // poll's cost is how many rows it touches, and that shows up as which
  // statements the route chose to run.
  const traced = [];
  const origPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    traced.push(sql);
    return origPrepare(sql);
  };
  const since = (mark) => traced.slice(mark);
  return { env, ctx, worker, call, reg, q, traced, since };
}

async function pair(h, tag) {
  const A = await h.reg(`${tag}a`);
  const B = await h.reg(`${tag}b`);
  const conv = await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  if (!conv.json.conversation)
    throw new Error(`conversation failed: ${JSON.stringify(conv.json).slice(0, 90)}`);
  return { A, B, cid: conv.json.conversation.id };
}

async function main() {
  // ── 1. no ghost conversations / calls ───────────────────────────────────────
  {
    const h = await mk();
    const A = await h.reg("g1a");
    const bad = await h.call(
      "POST",
      "/api/conversations",
      { userId: "550e8400-e29b-41d4-a716-446655440000" },
      A.token,
    );
    check(
      "conversation with a non-existent user is refused",
      bad.status === 404,
      `${bad.status} ${JSON.stringify(bad.json).slice(0, 60)}`,
    );
    const rows = await h.q("SELECT count(*) AS c FROM conversations").first();
    const members = await h.q("SELECT count(*) AS c FROM members").first();
    check("…and it leaves no conversation row behind", rows.c === 0, `conversations=${rows.c}`);
    check("…and no orphan member row", members.c === 0, `members=${members.c}`);
    const ghostCall = await h.call(
      "POST",
      "/api/calls",
      { userId: "no-such-user", kind: "AUDIO" },
      A.token,
    );
    check(
      "calling a non-existent user is refused",
      ghostCall.status === 404,
      `${ghostCall.status}`,
    );
    const self = await h.call("POST", "/api/conversations", { userId: A.user.id }, A.token);
    check("still refuses talking to yourself with 400", self.status === 400, `${self.status}`);
    const B = await h.reg("g1b");
    const ok = await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
    check(
      "a real user still works (the check did not eat valid ids)",
      ok.status === 200 && !!ok.json.conversation,
      `${ok.status}`,
    );
  }

  // ── 2. edit / delete keep the chat-list preview truthful ────────────────────
  {
    const h = await mk();
    const { A, B, cid } = await pair(h, "p2");
    const preview = async (who) =>
      (await h.call("GET", "/api/conversations", undefined, who.token)).json.items.find(
        (c) => c.id === cid,
      )?.lastMessage;

    const sent = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "the original wording", clientId: "c1" },
      B.token,
    );
    check(
      "message send stores its text as the preview",
      (await preview(A)) === "the original wording",
      JSON.stringify(await preview(A)),
    );

    const id = sent.json.message.id;
    const ed = await h.call(
      "PATCH",
      `/api/messages/${id}`,
      { body: "the corrected wording" },
      B.token,
    );
    check(
      "edit returns the new body",
      ed.status === 200 && ed.json.message.body === "the corrected wording",
      JSON.stringify(ed.json).slice(0, 80),
    );
    check(
      "edit re-points the list preview at the NEW text",
      (await preview(A)) === "the corrected wording",
      JSON.stringify(await preview(A)),
    );

    const del = await h.call("DELETE", `/api/messages/${id}`, undefined, B.token);
    check("delete-for-everyone answers ok", del.status === 200, `${del.status}`);
    // Round 27: a DELETED message VANISHES (owner rule r25) — the preview no
    // longer says "Message deleted"; it falls back to the previous visible row
    // (none here, so it clears) and never keeps the unsent text.
    check(
      "the preview drops the unsent text (falls back / clears, never 'Message deleted')",
      (await preview(A)) !== "the corrected wording" && (await preview(A)) !== "Message deleted",
      JSON.stringify(await preview(A)),
    );

    // A newer message must win: editing an OLD row may not overwrite the preview
    // of whatever arrived after it.
    const older = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "old line", clientId: "c0" },
      A.token,
    );
    await new Promise((r) => setTimeout(r, 4));
    const newer = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "newest line", clientId: "c9" },
      B.token,
    );
    check(
      "the newest message owns the preview",
      (await preview(A)) === "newest line",
      JSON.stringify(await preview(A)),
    );
    // The one-minute edit window is real, so this only proves the guard exists if
    // it does NOT touch the preview: same-row edit of a non-latest message.
    const edOld = await h.call(
      "PATCH",
      `/api/messages/${older.json.message.id}`,
      { body: "edited old line" },
      A.token,
    );
    check("editing a non-latest message succeeds", edOld.status === 200, `${edOld.status}`);
    check(
      "…but leaves the newer message's preview alone",
      (await preview(A)) === "newest line",
      JSON.stringify(await preview(A)),
    );
    check("(sanity) the deleted row is not the newest one", !!newer.json.message.id, "");
  }

  // ── 3. blocked users: identity stays, private data does not ─────────────────
  {
    const h = await mk();
    const { A, B } = await pair(h, "b3");
    const before = await h.call("GET", `/api/users/${B.user.id}`, undefined, A.token);
    check(
      "a normal profile still carries the private fields",
      before.status === 200 &&
        before.json.user.online === true &&
        before.json.user.blocked === false,
      JSON.stringify(before.json.user).slice(0, 100),
    );

    await h.call("POST", "/api/blocks", { userId: B.user.id }, A.token);
    const blocked = await h.call("GET", `/api/users/${B.user.id}`, undefined, A.token);
    const u = blocked.json.user ?? {};
    check(
      "blocked: profile still readable (Unblock lives here — a 404 would trap the user)",
      blocked.status === 200 && u.id === B.user.id,
      `${blocked.status}`,
    );
    check(
      "blocked: the blocked flag is a server answer, not a client guess",
      u.blocked === true,
      JSON.stringify(u).slice(0, 80),
    );
    check(
      "blocked: no avatar bytes",
      u.avatarUrl == null,
      String(u.avatarUrl && u.avatarUrl.slice(0, 20)),
    );
    check(
      "blocked: no avatarRef either, so the client never re-tries the blob",
      u.avatarRef == null,
      String(u.avatarRef),
    );
    check(
      "blocked: no bio / no presence / no last-seen",
      u.about == null && u.online === false && u.lastActiveAt == null,
      JSON.stringify(u).slice(0, 120),
    );
    const av = await h.call("GET", `/api/users/${B.user.id}/avatar`, undefined, A.token);
    check(
      "blocked: the avatar route itself refuses (guard is not one URL away)",
      av.status === 404,
      `${av.status}`,
    );
    // The other direction: the blocked party must not read either.
    const reverse = await h.call("GET", `/api/users/${A.user.id}`, undefined, B.token);
    check(
      "blocked both ways for the blocked party too",
      reverse.status === 200 &&
        reverse.json.user.blocked === true &&
        reverse.json.user.avatarUrl == null,
      JSON.stringify(reverse.json.user ?? {}).slice(0, 90),
    );
    // r32-7: the Blocklist screen reads GET /api/blocks — light user shape,
    // one IN() lookup (no per-user SELECT), newest block first.
    const listed = await h.call("GET", "/api/blocks", undefined, A.token);
    check(
      "r32-7: GET /api/blocks lists the blocked account in the light shape (avatarRef, no inline avatarUrl)",
      listed.status === 200 &&
        Array.isArray(listed.json.users) &&
        listed.json.users.length === 1 &&
        listed.json.users[0].id === B.user.id &&
        !("avatarUrl" in listed.json.users[0] && listed.json.users[0].avatarUrl) &&
        "avatarRef" in listed.json.users[0],
      JSON.stringify(listed.json).slice(0, 160),
    );
    const unblocked = await h.call("DELETE", `/api/blocks/${B.user.id}`, undefined, A.token);
    check("unblock works from the profile screen", unblocked.status === 200, `${unblocked.status}`);
    // r32-25: the owner's account is unblockable through the API itself.
    await h.q("UPDATE users SET username = 'rabbihossainltd' WHERE id = ?", B.user.id).run();
    const ownerBlock = await h.call("POST", "/api/blocks", { userId: B.user.id }, A.token);
    const ownerRows = await h
      .q(
        "SELECT COUNT(*) AS n FROM blocks WHERE owner_id = ? AND target_id = ?",
        A.user.id,
        B.user.id,
      )
      .first();
    check(
      "r32-25: POST /api/blocks against the owner's account is refused (403 OWNER_ACCOUNT) and writes nothing",
      ownerBlock.status === 403 &&
        (ownerBlock.json.error?.code ?? ownerBlock.json.code) === "OWNER_ACCOUNT" &&
        Number(ownerRows?.n ?? 0) === 0,
      `${ownerBlock.status} ${JSON.stringify(ownerBlock.json)} rows=${ownerRows?.n}`,
    );
    await h.q("UPDATE users SET username = 'ib-b' WHERE id = ?", B.user.id).run();
    // r32-6: Report lands one throttled row in error_log.
    const rep = await h.call(
      "POST",
      "/api/reports",
      { userId: B.user.id, reason: "spam" },
      A.token,
    );
    const repRow = await h
      .q("SELECT stack FROM error_log WHERE stack LIKE 'REPORT[%' ORDER BY created_at DESC LIMIT 1")
      .first();
    check(
      "r32-6: POST /api/reports records REPORT[<reporter>] -> <target> :: reason",
      rep.status === 200 && rep.json.ok === true && !!repRow && repRow.stack.includes("spam"),
      `${rep.status} ${JSON.stringify(repRow)}`,
    );
    const selfRep = await h.call("POST", "/api/reports", { userId: A.user.id }, A.token);
    check("r32-6: reporting yourself is a 400", selfRep.status === 400, String(selfRep.status));
    const after = await h.call("GET", `/api/users/${B.user.id}`, undefined, A.token);
    check(
      "after unblocking the full profile returns",
      after.json.user.blocked === false,
      JSON.stringify(after.json.user).slice(0, 80),
    );
  }

  // ── r32-4. Settings → Devices shows where each install came from ─────────
  {
    const h = await mk();
    // A caller that pins the edge headers: Cloudflare's IP header plus the
    // `request.cf` geo object the worker reads for the place.
    const from = async (method, path, body, token, ip, cf) => {
      const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
      if (token) headers.authorization = `Bearer ${token}`;
      const init = { method, headers };
      if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
      const req = new Request(`https://kp.test${path}`, init);
      if (cf) Object.defineProperty(req, "cf", { value: cf });
      const res = await h.worker.fetch(req, h.env, h.ctx);
      const t = await res.text();
      await h.ctx.drain();
      return { status: res.status, json: t ? JSON.parse(t) : {} };
    };
    const phone = "+8801711000404";
    const v = await from(
      "POST",
      "/api/auth/verify-phone",
      { phone, sim: "MATCH", deviceId: "dev-r324", deviceName: "Pixel 8" },
      undefined,
      "103.4.5.6",
      { city: "Sirajganj", country: "BD" },
    );
    check(
      "r32-4: verify-phone accepted",
      v.json.status === "ACCOUNT_CREATED",
      JSON.stringify(v.json).slice(0, 80),
    );
    const b = await from(
      "POST",
      "/api/auth/google/bind",
      {
        phone,
        idToken: fakeIdToken("g-r324", "r324@x.com"),
        deviceId: "dev-r324",
        displayName: "r324",
      },
      undefined,
      "103.4.5.6",
      { city: "Sirajganj", country: "BD" },
    );
    const tok = b.json.token;
    check("r32-4: bind produced a session", !!tok, JSON.stringify(b.json).slice(0, 80));
    const devs = await from("GET", "/api/auth/devices", undefined, tok, "103.4.5.6");
    const d0 = devs.json.items?.[0];
    check(
      "r32-4: GET /api/auth/devices carries ip, place (city, country) and signedInAt for the install",
      devs.status === 200 &&
        !!d0 &&
        d0.ip === "103.4.5.6" &&
        d0.place === "Sirajganj, BD" &&
        typeof d0.signedInAt === "string" &&
        d0.signedInAt === d0.firstSeenAt,
      JSON.stringify(d0).slice(0, 220),
    );
    // The throttled presence tick (users.last_active_at older than the online
    // window) also stamps the device row: last active + where from, both moving
    // with the phone. Rows without geo keep what they had (COALESCE).
    const uid = b.json.user.id;
    const stale = new Date(Date.now() - 5 * 60_000).toISOString();
    await h.q("UPDATE users SET last_active_at = ? WHERE id = ?", stale, uid).run();
    await h.q("UPDATE auth_devices SET last_seen_at = ? WHERE user_id = ?", stale, uid).run();
    await from("GET", "/api/conversations", undefined, tok, "45.9.9.9", {
      city: "Dhaka",
      country: "BD",
    });
    const row = await h
      .q(
        "SELECT last_seen_at, ip, city, country FROM auth_devices WHERE user_id = ? AND device_id = 'dev-r324'",
        uid,
      )
      .first();
    check(
      "r32-4: an authenticated request past the online window refreshes the device's last_seen_at + ip + place",
      !!row &&
        row.last_seen_at > stale &&
        row.ip === "45.9.9.9" &&
        row.city === "Dhaka" &&
        row.country === "BD",
      JSON.stringify(row),
    );
    const again = await from("GET", "/api/auth/devices", undefined, tok, "45.9.9.9");
    const d1 = again.json.items?.[0];
    check(
      "r32-4: …and the list reflects it (lastSeenAt moved, ip/place follow the phone, signedInAt unchanged)",
      !!d1 &&
        d1.ip === "45.9.9.9" &&
        d1.place === "Dhaka, BD" &&
        d1.lastSeenAt > stale &&
        d1.signedInAt === d0.signedInAt,
      JSON.stringify(d1).slice(0, 220),
    );
  }

  // ── 3b. the chat-list poll must not touch the messages table at all unless a
  //          conversation actually carries a "delete chat" watermark ──────────
  {
    const h = await mk();
    const A = await h.reg("mx-a");
    for (let i = 0; i < 6; i++) {
      const B = await h.reg(`mx-b${i}`);
      const cid = (await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
        .conversation.id;
      for (let m = 0; m < 4; m++)
        await h.call(
          "POST",
          `/api/conversations/${cid}/messages`,
          { kind: "TEXT", body: `m${m}`, clientId: `mx${i}-${m}` },
          B.token,
        );
    }
    let mark = h.traced.length;
    const plain = await h.call("GET", "/api/conversations", undefined, A.token);
    const plainStmts = h.since(mark).filter((q) => q.includes("MAX(rowid)"));
    check(
      "6 chats, no watermark → the list poll never scans messages",
      plainStmts.length === 0,
      `${plainStmts.length} scanning statements`,
    );
    check(
      "…and every chat is still listed",
      (plain.json.items ?? []).length === 6,
      `${(plain.json.items ?? []).length}`,
    );

    // Now hide one chat: the watermark is rowid-based, so THIS chat needs the
    // newest-rowid probe — and it must still be asked for exactly the one chat.
    const cid0 = plain.json.items[0].id;
    await h.call("DELETE", `/api/conversations/${cid0}`, undefined, A.token);
    mark = h.traced.length;
    const after = await h.call("GET", "/api/conversations", undefined, A.token);
    const probes = h.since(mark).filter((q) => q.includes("MAX(rowid) AS max_row FROM messages"));
    check(
      "round 13: a real-deleted chat carries a TIME watermark — no rowid probe needed",
      probes.length === 0,
      `${probes.length} probes`,
    );
    check(
      "…and the deleted chat is out of the list without any messages-table scan",
      !(after.json.items ?? []).some((c) => c.id === cid0),
      "still listed",
    );
    check(
      "…and the chat stays hidden while nothing newer exists",
      !(after.json.items ?? []).some((c) => c.id === cid0 && c.lastMessageAt === "m3"),
      JSON.stringify(after.json.items?.find((c) => c.id === cid0) ?? "gone").slice(0, 60),
    );
    // A newer message must bring it back with the history cut — the behaviour my
    // refactor of the probe could so easily have broken.
    const B0 = (await h.call("GET", "/api/conversations", undefined, A.token)).json;
    void B0;
    const other = await h.call("GET", `/api/conversations/${cid0}/messages`, undefined, A.token);
    check(
      "opening it directly shows only messages after the cut",
      (other.json.items ?? []).length === 0,
      `${(other.json.items ?? []).length} rows`,
    );
  }

  // ── 4. the statuses poll must cost a handful of statements, not hundreds ───
  {
    const h = await mk();
    // One caller plus a dozen contacts sharing conversations, several live
    // statuses — the shape that used to blow the D1 row-read budget.
    const A = await h.reg("s1a");
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const B = await h.reg(`s1b${i}`);
      ids.push(B.user.id);
      await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
      await h.call("POST", "/api/statuses", { kind: "TEXT", text: `status number ${i}` }, B.token);
    }
    await h.call("POST", "/api/statuses", { kind: "TEXT", text: "mine" }, A.token);
    // a view row, so the viewers/allViewed paths are exercised
    const otherConvs = await h.call("GET", "/api/conversations", undefined, A.token);
    const cid0 = otherConvs.json.items[0].id;
    const msgOfB = await h.call(
      "POST",
      `/api/conversations/${cid0}/messages`,
      { kind: "TEXT", body: "hi", clientId: "x" },
      A.token,
    );
    void msgOfB;

    h.env.DB._stats.reset();
    const res = await h.call("GET", "/api/statuses", undefined, A.token);
    const reads = h.env.DB._stats.reads;
    check(
      "statuses ring is populated for all contacts",
      (res.json.items ?? []).length >= 12,
      `${(res.json.items ?? []).length} groups`,
    );
    check(
      "statuses GET costs <= 8 D1 statements (the free-tier row-read cap is about COUNT, not speed)",
      reads <= 8,
      `statements=${reads}`,
    );
    const mineGroup = (res.json.items ?? []).find((x) => x.mine);
    check(
      "own status still present with its viewer count",
      mineGroup?.statuses?.[0]?.text === "mine" &&
        typeof mineGroup.statuses[0].viewers === "number",
      JSON.stringify(mineGroup?.statuses?.[0] ?? {}).slice(0, 90),
    );
    const otherGroup = (res.json.items ?? []).find((x) => !x.mine);
    check(
      "a contact group keeps its fields (shape unchanged)",
      !!otherGroup && !!otherGroup.user?.id && typeof otherGroup.allViewed === "boolean",
      JSON.stringify(otherGroup ?? {}).slice(0, 90),
    );
    check(
      "contact statuses carry no per-status viewer count (as before)",
      !("viewers" in (otherGroup?.statuses?.[0] ?? {})),
      JSON.stringify(otherGroup?.statuses?.[0] ?? {}),
    );
    check(
      "statuses are ordered by user then time (no scramble)",
      !!otherGroup && !!otherGroup.statuses?.length,
      "",
    );
  }

  // ── 4b. r32-20: "Who Can View Your Status?" — public (default) = everyone
  //          sharing a chat, contacts = 1:1 partners only, nobody = author only ──
  {
    const h = await mk();
    const P = await h.reg("st-p"); // the poster
    const C = await h.reg("st-c"); // 1:1 contact of P
    const G = await h.reg("st-g"); // shares only a GROUP with P
    const S = await h.reg("st-s"); // stranger
    await h.call("POST", "/api/conversations", { userId: C.user.id }, P.token);
    await h.call("POST", "/api/conversations", { userId: G.user.id }, C.token); // so G is a real user with a chat
    const grp = await h.call(
      "POST",
      "/api/conversations/group",
      { title: "st", memberIds: [G.user.id] },
      P.token,
    );
    if (!grp.json.conversation) throw new Error(`group failed: ${JSON.stringify(grp.json)}`);
    const st = await h.call("POST", "/api/statuses", { kind: "TEXT", text: "hello" }, P.token);
    const sid = st.json.status?.id;
    const seesFeed = async (who) =>
      ((await h.call("GET", "/api/statuses", undefined, who.token)).json.items ?? []).some(
        (x) => x.user?.id === P.user.id,
      );
    const meShape = await h.call("GET", "/api/me", undefined, P.token);
    check(
      "r32-20: /api/me privacy carries status = public by default",
      meShape.json.user?.privacy?.status === "public",
      JSON.stringify(meShape.json.user?.privacy),
    );
    check(
      "r32-20: public → the 1:1 contact AND the group mate see the status, a stranger never does",
      (await seesFeed(C)) && (await seesFeed(G)) && !(await seesFeed(S)),
      "",
    );
    const bad = await h.call("PATCH", "/api/me", { privStatus: "friends" }, P.token);
    check("r32-20: an unknown status level is refused", bad.status === 400, String(bad.status));
    const toContacts = await h.call("PATCH", "/api/me", { privStatus: "contacts" }, P.token);
    check(
      "r32-20: contacts → only the 1:1 contact sees it (feed); the group mate's view ping is ignored and media is 403",
      toContacts.json.user?.privacy?.status === "contacts" &&
        (await seesFeed(C)) &&
        !(await seesFeed(G)) &&
        (await h.call("POST", `/api/statuses/${sid}/view`, {}, G.token)).status === 200 &&
        (await h.call("POST", `/api/statuses/${sid}/react`, { emoji: "❤️" }, G.token)).status ===
          403 &&
        (await h.call("POST", `/api/statuses/${sid}/react`, { emoji: "❤️" }, C.token)).status ===
          200,
      "",
    );
    const viewers = await h.call("GET", `/api/statuses/${sid}/viewers`, undefined, P.token);
    check(
      "r32-20: …and the group mate's ignored ping never became a view row",
      (viewers.json.viewers ?? []).length === 1 &&
        viewers.json.viewers[0].user?.id === C.user.id &&
        viewers.json.viewers[0].reaction === "❤️",
      JSON.stringify(viewers.json).slice(0, 160),
    );
    await h.call("PATCH", "/api/me", { privStatus: "nobody" }, P.token);
    const mineStill = (await h.call("GET", "/api/statuses", undefined, P.token)).json.items ?? [];
    check(
      "r32-20: nobody → hidden from the contact too, the author still sees their own ring",
      !(await seesFeed(C)) &&
        !(await seesFeed(G)) &&
        mineStill.some((x) => x.mine && x.statuses?.length === 1) &&
        (await h.call("POST", `/api/statuses/${sid}/react`, { emoji: "❤️" }, C.token)).status ===
          403,
      "",
    );
    // the poll budget is unchanged: the level rides on rows the feed already reads
    h.env.DB._stats.reset();
    await h.call("GET", "/api/statuses", undefined, C.token);
    check(
      "r32-20: the status privacy check adds no D1 statement to the feed poll",
      h.env.DB._stats.reads <= 8,
      `statements=${h.env.DB._stats.reads}`,
    );
  }

  // ── 5. /api/debug/clientlog is bounded, and error_log gets pruned ──────────
  {
    const h = await mk();
    const { A } = await pair(h, "cl");
    let last = 0;
    for (let i = 0; i < 45; i++)
      last = (
        await h.call("POST", "/api/debug/clientlog", { stage: `s${i}`, detail: "boom" }, A.token)
      ).status;
    check("a runaway client log gets rate limited", last === 429, `after 45 posts status=${last}`);

    const rows = await h.q("SELECT count(*) AS c FROM error_log").first();
    check("the earlier posts did land (not silently dropped)", rows.c > 0, `error_log=${rows.c}`);
    // age them past the retention window, then run the cron by hand
    await h.q("UPDATE error_log SET created_at = '2020-01-01T00:00:00.000Z'").run();
    const freshRow = await h
      .q(
        "INSERT INTO error_log (id, stack, created_at) VALUES ('keep','recent','" +
          new Date().toISOString() +
          "')",
      )
      .run();
    void freshRow;
    await h.worker.scheduled({ noRetryIfBusy: true }, h.env, h.ctx);
    await h.ctx.drain();
    const after = await h.q("SELECT count(*) AS c FROM error_log").first();
    check(
      "the cron prunes error_log to the retention window",
      after.c === 1,
      `rows after prune=${after.c}`,
    );
    const kept = await h.q("SELECT id FROM error_log LIMIT 1").first();
    check("…keeping recent rows", kept?.id === "keep", JSON.stringify(kept));
  }

  // ── 6. the limiter cannot be reset by flooding it with keys ────────────────
  {
    const h = await mk();
    const src = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
    check(
      "the limiter never wipes every bucket at once",
      !src.includes("rateBuckets.clear()"),
      "found rateBuckets.clear()",
    );
    check(
      "it evicts stale keys then trims the oldest",
      src.includes("rateBuckets.delete(k)") && src.includes("rateBuckets.size > 4_000"),
      "",
    );
  }

  // ── 7. edit length shares the send limit; markers survive an edit ──────────
  {
    const h = await mk();
    const { A, B, cid } = await pair(h, "mt");
    const long = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "x".repeat(MESSAGE_MAX_LENGTH + 900), clientId: "m1" },
      B.token,
    );
    check(
      "send truncates to MESSAGE_MAX_LENGTH",
      long.json.message.body.length === MESSAGE_MAX_LENGTH,
      `${long.json.message.body.length}`,
    );
    const edit = await h.call(
      "PATCH",
      `/api/messages/${long.json.message.id}`,
      { body: "y".repeat(MESSAGE_MAX_LENGTH + 900) },
      B.token,
    );
    check(
      "edit truncates to the SAME constant (no second limit to drift)",
      edit.json.message.body.length === MESSAGE_MAX_LENGTH,
      `${edit.json.message.body.length}`,
    );

    const markerA = (await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token))
      .json.marker;
    const unchanged = await h.call(
      "GET",
      `/api/conversations/${cid}/messages?marker=${markerA}`,
      undefined,
      A.token,
    );
    check(
      "an unchanged poll is still cheap",
      unchanged.json.unchanged === true,
      JSON.stringify(unchanged.json).slice(0, 60),
    );
    const small = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "ping", clientId: "m2" },
      B.token,
    );
    const markerB = (await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token))
      .json.marker;
    check("a new message moves the marker", markerB !== markerA, `${markerA} vs ${markerB}`);
    const sameLen = await h.call(
      "PATCH",
      `/api/messages/${small.json.message.id}`,
      { body: "pong" },
      B.token,
    );
    const markerC = (await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token))
      .json.marker;
    check(
      "a same-length edit still moves the marker",
      sameLen.status === 200 && markerC !== markerB,
      `${markerB} vs ${markerC}`,
    );
  }

  // ── 10. the free-tier row-read ceiling is a signalled condition, not a 500 ──
  {
    const h = await mk();
    const A = await h.reg("busy-a");
    // Only the conversation SELECT fails, exactly like a quota trip does: the
    // client must be told "come back later", because retrying now spends reads on
    // the path that is already failing.
    const orig = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = (sql) => {
      if (!/FROM conversations/.test(sql)) return orig(sql);
      const boom = async () => {
        throw new Error("This Worker has exceeded its daily row read limit.");
      };
      const fake = { sql, bind: () => fake, all: boom, first: boom, run: boom };
      return fake;
    };
    const r = await h.call("GET", "/api/conversations", undefined, A.token);
    const secs = Number(r.headers.get("retry-after"));
    check(
      "quota exhaustion answers 503 + Retry-After instead of a bare 500",
      r.status === 503 && r.json.error?.code === "BUSY" && secs >= 10 && secs <= 300,
      `${r.status} ${r.json.error?.code} retry-after=${r.headers.get("retry-after")}`,
    );
    const src = await readFile(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
    check(
      "the throttle header reaches replies in general (rate limit carries 60)",
      /retryAfter \? \{ "retry-after": err.retryAfter \} : undefined/.test(src) &&
        /429, "Too many attempts[^"]*", "RATE_LIMITED", "60"/.test(src),
    );
  }

  // ── 12. "is push dead?" must be answerable without log access ───────────────
  {
    const h = await mk();
    const bare = await h.call("GET", "/api/health");
    const caps = bare.json.capabilities ?? {};
    check(
      "health reports push:false while the sender secret is absent",
      caps.push === false,
      JSON.stringify(caps),
    );
    check(
      "…turn:false with no TURN configuration at all",
      caps.turn === false,
      JSON.stringify(caps),
    );
    check(
      "…and every capability is a boolean, never a value",
      Object.keys(caps).length >= 3 && Object.values(caps).every((v) => typeof v === "boolean"),
      JSON.stringify(caps),
    );
    h.env.FCM_CONFIG = JSON.stringify({
      project_info: { project_id: "p", project_number: "1234" },
      client: [
        {
          client_info: {
            android_client_info: { package_name: "app.kuchupuchu.android" },
            mobilesdk_app_id: "1:1:android:x",
          },
          api_key: [{ current_key: "k" }],
        },
      ],
    });
    h.env.TURN_URLS = "turn:relay.example.com:3478";
    const on = await h.call("GET", "/api/health");
    check(
      "configuring firebase config alone is still push:false (the app side is not the credential)",
      on.json.capabilities?.push === false,
      JSON.stringify(on.json.capabilities),
    );
    check(
      "…while a configured relay shows up as turn:true",
      on.json.capabilities?.turn === true,
      JSON.stringify(on.json.capabilities),
    );

    // The silent-death case itself: push is expected (config present) but the
    // sending credential is not. Before this, every push just returned false.
    const A = await h.reg("push-a");
    const B = await h.reg("push-b");
    const cid = (await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
      .conversation.id;
    await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "ping", clientId: "pd1" },
      A.token,
    );
    const row = await h.q("SELECT stack FROM error_log WHERE stack LIKE 'fcm_diag%'").first();
    check(
      "a dropped push leaves a readable reason in error_log",
      !!row && /credentials_secret_missing/.test(String(row.stack)),
      JSON.stringify(row ?? "no row"),
    );

    // …and once the credential exists, the failure reason must change to the
    // upstream one, not silently disappear.
    h.env.FCM_CREDENTIALS = "{ not json";
    const A2 = await h.reg("push-a2");
    const cid2 = (await h.call("POST", "/api/conversations", { userId: B.user.id }, A2.token)).json
      .conversation.id;
    await h.call(
      "POST",
      `/api/conversations/${cid2}/messages`,
      { kind: "TEXT", body: "ping", clientId: "pd2" },
      A2.token,
    );
    const rows = await h.q("SELECT stack FROM error_log WHERE stack LIKE 'fcm_diag%'").all();
    check(
      "malformed credential JSON is reported as unusable, not swallowed",
      (rows.results ?? []).some((r) => /credentials_unusable/.test(String(r.stack))),
      JSON.stringify((rows.results ?? []).map((r) => r.stack).slice(0, 3)),
    );
  }

  // ── r32-38. message requests: a first chat from username search ─────────────
  {
    const h = await mk();
    const A = await h.reg("rq-a");
    const B = await h.reg("rq-b");
    const opened = await h.call(
      "POST",
      "/api/conversations",
      { userId: B.user.id, request: true },
      A.token,
    );
    const cid = opened.json.conversation?.id;
    check(
      "r32-38: `request: true` opens the chat as a message request (requestFrom = opener, opener sees no prompt)",
      opened.status === 200 &&
        opened.json.conversation.requestFrom === A.user.id &&
        opened.json.conversation.requestPending === false,
      JSON.stringify(opened.json.conversation).slice(0, 160),
    );
    await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "hello?", clientId: "rq1" },
      A.token,
    );
    const rowB = (await h.call("GET", "/api/conversations", undefined, B.token)).json.items.find(
      (c) => c.id === cid,
    );
    const rowA = (await h.call("GET", "/api/conversations", undefined, A.token)).json.items.find(
      (c) => c.id === cid,
    );
    check(
      "r32-38: the recipient's list row carries requestPending, and neither side sees the other's last seen / online while it is open",
      rowB?.requestPending === true &&
        rowB?.requestFrom === A.user.id &&
        rowB?.other?.lastActiveAt == null &&
        rowB?.other?.online === false &&
        rowA?.requestPending === false &&
        rowA?.other?.lastActiveAt == null,
      JSON.stringify({ b: rowB?.other, a: rowA?.other }).slice(0, 200),
    );
    const callAB = await h.call(
      "POST",
      "/api/calls",
      { userId: B.user.id, kind: "AUDIO" },
      A.token,
    );
    const callBA = await h.call(
      "POST",
      "/api/calls",
      { userId: A.user.id, kind: "AUDIO" },
      B.token,
    );
    const media = await h.call("GET", `/api/conversations/${cid}/media`, undefined, B.token);
    const profile = await h.call("GET", `/api/users/${A.user.id}`, undefined, B.token);
    check(
      "r32-38: calls (both directions) and the shared-media gallery answer 403 REQUEST_PENDING; the profile shows no last seen; the pair are not contacts yet (contacts-only fields withheld)",
      callAB.status === 403 &&
        callAB.json.error?.code === "REQUEST_PENDING" &&
        callBA.status === 403 &&
        callBA.json.error?.code === "REQUEST_PENDING" &&
        media.status === 403 &&
        media.json.error?.code === "REQUEST_PENDING" &&
        profile.json.user?.lastActiveAt == null &&
        profile.json.user?.phone == null,
      `${callAB.status}/${callBA.status}/${media.status} seen=${profile.json.user?.lastActiveAt}`,
    );
    const wrongSide = await h.call("POST", `/api/conversations/${cid}/accept`, {}, A.token);
    const accepted = await h.call("POST", `/api/conversations/${cid}/accept`, {}, B.token);
    const callAfter = await h.call(
      "POST",
      "/api/calls",
      { userId: B.user.id, kind: "AUDIO" },
      A.token,
    );
    const mediaAfter = await h.call("GET", `/api/conversations/${cid}/media`, undefined, B.token);
    const profileAfter = await h.call("GET", `/api/users/${A.user.id}`, undefined, B.token);
    check(
      "r32-38: only the recipient can accept (opener → 403); after Accept the row is a normal chat and calls / media / last seen / the number (contacts-only default) open up",
      wrongSide.status === 403 &&
        accepted.status === 200 &&
        accepted.json.conversation.requestFrom === null &&
        accepted.json.conversation.requestPending === false &&
        callAfter.status === 201 &&
        mediaAfter.status === 200 &&
        typeof profileAfter.json.user?.lastActiveAt === "string" &&
        profileAfter.json.user?.phone === A.user.phone,
      `${wrongSide.status}/${accepted.status}/${callAfter.status}/${mediaAfter.status}`,
    );
    // A reply from the recipient accepts by itself; a plain open (phone-book
    // match, or an old client) is never a request; the bots never are.
    const C = await h.reg("rq-c");
    const c2 = (
      await h.call("POST", "/api/conversations", { userId: C.user.id, request: true }, A.token)
    ).json.conversation.id;
    await h.call(
      "POST",
      `/api/conversations/${c2}/messages`,
      { kind: "TEXT", body: "sure", clientId: "rq2" },
      C.token,
    );
    const replied = await h.call("GET", `/api/conversations/${c2}`, undefined, A.token);
    const D = await h.reg("rq-d");
    const plain = await h.call("POST", "/api/conversations", { userId: D.user.id }, A.token);
    await h.call("POST", "/api/ai/welcome", {}, A.token); // mints the AI account
    const bot = await h.call(
      "POST",
      "/api/conversations",
      { userId: "kp_ai_bot", request: true },
      A.token,
    );
    check(
      "r32-38: the recipient writing back accepts the request; a plain open (phone-book match / old client) and a bot chat are never requests",
      replied.json.conversation?.requestFrom === null &&
        plain.json.conversation?.requestFrom === null &&
        bot.json.conversation?.requestFrom === null,
      JSON.stringify({
        r: replied.json.conversation?.requestFrom,
        p: plain.json.conversation?.requestFrom,
        b: bot.json.conversation?.requestFrom,
      }),
    );
  }

  // ── r32-31. badge choice for multi-badge accounts ───────────────────────────
  {
    const h = await mk();
    const A = await h.reg("bd-a");
    const B = await h.reg("bd-b");
    const plain = await h.call("GET", "/api/me", undefined, A.token);
    const notHeld = await h.call("PATCH", "/api/me", { badge: "verified" }, A.token);
    check(
      "r32-31: badge is null by default (show all) and a badge the account does not hold is refused (400 BAD_BADGE)",
      plain.json.user?.badge === null &&
        notHeld.status === 400 &&
        notHeld.json.error?.code === "BAD_BADGE",
      `${plain.json.user?.badge}/${notHeld.status}`,
    );
    await h.q("UPDATE users SET verified = 1, moderator = 1 WHERE id = ?", A.user.id).run();
    const pickMod = await h.call("PATCH", "/api/me", { badge: "moderator" }, A.token);
    const cid = (await h.call("POST", "/api/conversations", { userId: A.user.id }, B.token)).json
      .conversation.id;
    const row = (await h.call("GET", "/api/conversations", undefined, B.token)).json.items.find(
      (c) => c.id === cid,
    );
    const prof = await h.call("GET", `/api/users/${A.user.id}`, undefined, B.token);
    check(
      "r32-31: a held badge is accepted and the choice rides on every user shape (chat list `other`, profile) next to the flags",
      pickMod.status === 200 &&
        pickMod.json.user?.badge === "moderator" &&
        row?.other?.badge === "moderator" &&
        row?.other?.verified === true &&
        row?.other?.moderator === true &&
        prof.json.user?.badge === "moderator",
      JSON.stringify({
        p: pickMod.json.user?.badge,
        r: row?.other?.badge,
        u: prof.json.user?.badge,
      }),
    );
    const none = await h.call("PATCH", "/api/me", { badge: "none" }, A.token);
    const bad = await h.call("PATCH", "/api/me", { badge: "gold" }, A.token);
    const reset = await h.call("PATCH", "/api/me", { badge: null }, A.token);
    check(
      "r32-31: 'none' hides the badges, an unknown value is refused, null goes back to 'all'",
      none.json.user?.badge === "none" &&
        bad.status === 400 &&
        reset.status === 200 &&
        reset.json.user?.badge === null,
      `${none.json.user?.badge}/${bad.status}/${reset.json.user?.badge}`,
    );
    // A revoked badge cannot keep being shown by an old preference.
    await h.call("PATCH", "/api/me", { badge: "verified" }, A.token);
    await h.q("UPDATE users SET verified = NULL WHERE id = ?", A.user.id).run();
    const revoked = await h.call("GET", `/api/users/${A.user.id}`, undefined, B.token);
    check(
      "r32-31: a choice for a badge the account has since lost reads as null (show what is held), never as the lost badge",
      revoked.json.user?.badge === null && revoked.json.user?.verified === false,
      JSON.stringify(revoked.json.user?.badge),
    );
  }

  // ── r32-32. link preview cards ──────────────────────────────────────────────
  {
    const h = await mk();
    const A = await h.reg("lp-a");
    const realFetch = globalThis.fetch;
    let pageHits = 0;
    globalThis.fetch = async (input, init) => {
      const u = typeof input === "string" ? input : input.url;
      if (u.startsWith("https://page.example/post")) {
        pageHits++;
        const html =
          '<!doctype html><html><head><meta charset="utf-8"><title>Fallback &amp; title</title>' +
          '<meta property="og:title" content="KuchuPuchu &#8212; fast chats" />' +
          '<meta content="Private chats &amp; calls." name="description">' +
          '<meta property="og:image" content="/img/cover.png">' +
          '<meta property="og:site_name" content="KP"></head><body>' +
          "x".repeat(300_000) +
          "</body></html>";
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (u === "https://page.example/img/cover.png")
        return new Response(new Uint8Array(900), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      if (u === "https://page.example/huge.png")
        return new Response(new Uint8Array(3 * 1024 * 1024), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      if (u === "https://page.example/evil.svg")
        return new Response("<svg onload=alert(1)/>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        });
      if (u.startsWith("https://dead.example/")) return new Response("nope", { status: 503 });
      return realFetch(input, init);
    };
    try {
      const q = (u) => `/api/link-preview?url=${encodeURIComponent(u)}`;
      const card = await h.call("GET", q("https://page.example/post?id=7#top"), undefined, A.token);
      const again = await h.call("GET", q("https://page.example/post?id=7"), undefined, A.token);
      const bare = await h.call("GET", q("page.example/post"), undefined, A.token);
      check(
        "r32-32: GET /api/link-preview reads the page's Open Graph head on the worker — title (entities decoded), description, site name, host, a worker-relayed image path — a bare www-style link reads as https, the fragment is dropped, and the second ask is served from memory (one upstream fetch)",
        card.status === 200 &&
          card.json.ok === true &&
          card.json.url === "https://page.example/post?id=7" &&
          card.json.host === "page.example" &&
          card.json.title === "KuchuPuchu — fast chats" &&
          card.json.description === "Private chats & calls." &&
          card.json.siteName === "KP" &&
          card.json.image ===
            "/api/link-image?url=" + encodeURIComponent("https://page.example/img/cover.png") &&
          again.json.title === "KuchuPuchu — fast chats" &&
          bare.json.ok === true &&
          pageHits === 2,
        JSON.stringify({ s: card.status, c: card.json, hits: pageHits }).slice(0, 300),
      );
      const bad = [];
      for (const u of [
        "http://127.0.0.1/admin",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data",
        "https://localhost/",
        "https://kp.test/api/me",
        "ftp://page.example/x",
        "https://[::1]/",
        "https://user:pw@page.example/",
        "just words",
      ]) {
        const r = await h.call("GET", q(u), undefined, A.token);
        if (r.status !== 400 || r.json.error?.code !== "BAD_LINK") bad.push(`${u}=${r.status}`);
      }
      const anon = await h.call("GET", q("https://page.example/post"));
      check(
        "r32-32: the preview fetcher refuses loopback / private / link-local / bare hosts, the worker's own host, credentials, non-http schemes and junk with 400 BAD_LINK, and needs a session (401)",
        bad.length === 0 && anon.status === 401,
        `${bad.join(" ")} anon=${anon.status}`,
      );
      const dead = await h.call("GET", q("https://dead.example/x"), undefined, A.token);
      check(
        "r32-32: an unreachable page is a plain ok:false shell with the host (the app shows the bare link), never an error",
        dead.status === 200 && dead.json.ok === false && dead.json.host === "dead.example",
        JSON.stringify(dead.json),
      );
      const rawGet = async (path) => {
        const res = await h.worker.fetch(
          new Request(`https://kp.test${path}`, {
            headers: { authorization: `Bearer ${A.token}` },
          }),
          h.env,
          h.ctx,
        );
        const buf = await res.arrayBuffer();
        return {
          status: res.status,
          type: res.headers.get("content-type"),
          len: buf.byteLength,
          nosniff: res.headers.get("x-content-type-options"),
        };
      };
      const qi = (u) => `/api/link-image?url=${encodeURIComponent(u)}`;
      const pic = await rawGet(qi("https://page.example/img/cover.png"));
      const huge = await rawGet(qi("https://page.example/huge.png"));
      const svg = await rawGet(qi("https://page.example/evil.svg"));
      const html = await rawGet(qi("https://page.example/post"));
      const plain = await rawGet(qi("http://page.example/img/cover.png"));
      check(
        "r32-32: GET /api/link-image relays the card picture (image/* only, nosniff), refuses > 2 MB (413), SVG and HTML (415) and plain-http sources (400)",
        pic.status === 200 &&
          pic.type === "image/png" &&
          pic.len === 900 &&
          pic.nosniff === "nosniff" &&
          huge.status === 413 &&
          svg.status === 415 &&
          html.status === 415 &&
          plain.status === 400,
        JSON.stringify({
          pic,
          huge: huge.status,
          svg: svg.status,
          html: html.status,
          plain: plain.status,
        }),
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── r32-5a. private group: admin switch closes adds + the media gallery ──────
  {
    const h = await mk();
    const A = await h.reg("pg-a");
    const B = await h.reg("pg-b");
    const C = await h.reg("pg-c");
    // B and C know A (1:1 chats) so the group privacy default lets them in.
    await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
    await h.call("POST", "/api/conversations", { userId: C.user.id }, A.token);
    const g = (
      await h.call(
        "POST",
        "/api/conversations/group",
        { title: "pg", memberIds: [B.user.id] },
        A.token,
      )
    ).json.conversation;
    const openDetail = await h.call("GET", `/api/conversations/${g.id}`, undefined, B.token);
    const byMember = await h.call(
      "PATCH",
      `/api/conversations/${g.id}`,
      { privateGroup: true },
      B.token,
    );
    const on = await h.call("PATCH", `/api/conversations/${g.id}`, { privateGroup: true }, A.token);
    check(
      "r32-5a: privateGroup is false by default, only the admin may switch it (member → 403 FORBIDDEN), and the switch lands on the detail with a system line",
      openDetail.json.conversation?.privateGroup === false &&
        byMember.status === 403 &&
        byMember.json.error?.code === "FORBIDDEN" &&
        on.status === 200 &&
        on.json.conversation?.privateGroup === true &&
        (
          await h.call("GET", `/api/conversations/${g.id}/messages`, undefined, B.token)
        ).json.items?.some(
          (m) => m.kind === "SYSTEM" && /made this a private group/.test(m.body || ""),
        ),
      JSON.stringify({
        d: openDetail.json.conversation?.privateGroup,
        m: byMember.status,
        on: on.json.conversation?.privateGroup,
      }),
    );
    const add = await h.call(
      "POST",
      `/api/conversations/${g.id}/members`,
      { userId: C.user.id },
      A.token,
    );
    const media = await h.call("GET", `/api/conversations/${g.id}/media`, undefined, B.token);
    const listRow = (await h.call("GET", "/api/conversations", undefined, B.token)).json.items.find(
      (c) => c.id === g.id,
    );
    check(
      "r32-5a: while private, even the admin's member add and everyone's media gallery answer 403 PRIVATE_GROUP; the list row carries privateGroup too",
      add.status === 403 &&
        add.json.error?.code === "PRIVATE_GROUP" &&
        media.status === 403 &&
        media.json.error?.code === "PRIVATE_GROUP" &&
        listRow?.privateGroup === true,
      JSON.stringify({ add: add.status, media: media.status, row: listRow?.privateGroup }),
    );
    const off = await h.call(
      "PATCH",
      `/api/conversations/${g.id}`,
      { privateGroup: false },
      A.token,
    );
    const addAgain = await h.call(
      "POST",
      `/api/conversations/${g.id}/members`,
      { userId: C.user.id },
      A.token,
    );
    const mediaAgain = await h.call("GET", `/api/conversations/${g.id}/media`, undefined, B.token);
    const solo = await h.call(
      "PATCH",
      `/api/conversations/${
        (await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
          .conversation.id
      }`,
      { privateGroup: true },
      A.token,
    );
    check(
      "r32-5a: switching it off reopens adds and the gallery; a 1:1 chat cannot be made private (400)",
      off.json.conversation?.privateGroup === false &&
        addAgain.status === 200 &&
        mediaAgain.status === 200 &&
        solo.status === 400,
      JSON.stringify({
        off: off.json.conversation?.privateGroup,
        add: addAgain.status,
        media: mediaAgain.status,
        solo: solo.status,
      }),
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
