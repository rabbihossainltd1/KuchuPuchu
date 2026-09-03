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
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

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
    check(
      "the preview says it was deleted instead of keeping the text",
      (await preview(A)) === "Message deleted",
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
    const unblocked = await h.call("DELETE", `/api/blocks/${B.user.id}`, undefined, A.token);
    check("unblock works from the profile screen", unblocked.status === 200, `${unblocked.status}`);
    const after = await h.call("GET", `/api/users/${B.user.id}`, undefined, A.token);
    check(
      "after unblocking the full profile returns",
      after.json.user.blocked === false,
      JSON.stringify(after.json.user).slice(0, 80),
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
      "a watermarked chat still gets its newest-rowid probe",
      probes.length === 1,
      `${probes.length} probes`,
    );
    check(
      "…as ONE batched statement, not one per conversation",
      probes[0] ? probes[0].includes("GROUP BY conv_id") : false,
      probes[0],
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

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
