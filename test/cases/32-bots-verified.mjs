// Bots & badges (owner round): the KuchuPuchu AI welcome message (Gemini
// fallback when no key), both bot accounts verified with the bundled logo
// avatar, the login-approval card carrying the attempt's origin (IP, place,
// time), and the official notification account being strictly one-way.

import { existsSync, readFileSync, statSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub, phoneFrom, fakeIdToken } from "../helpers/phoneauth.mjs";

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
  const call = async (method, path, body, token, fixedIp) => {
    const headers = { "content-type": "application/json" };
    if (fixedIp) headers["cf-connecting-ip"] = fixedIp;
    else if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
  return { db, call, reg: makeReg(call) };
}

const convBetween = (db, a, b) =>
  db._db
    .prepare(
      `SELECT c.id FROM conversations c
        JOIN members m1 ON m1.conv_id = c.id AND m1.user_id = ?
        JOIN members m2 ON m2.conv_id = c.id AND m2.user_id = ?`,
    )
    .get(a, b);

// ---- 1. a brand-new account is welcomed by KuchuPuchu AI at first bind ----
{
  const k = await mk();
  const a = await k.reg("welcome@x.com", "welcome");
  const w = await k.call("POST", "/api/ai/welcome", {}, a.token);
  check("welcome endpoint answers ok", w.status === 200 && w.json.ok === true, w.status);
  const conv = convBetween(k.db, "kp_ai_bot", a.user.id);
  check("AI conversation exists after first bind", !!conv, conv ? "" : "no pair conv");
  const msg = k.db._db
    .prepare("SELECT * FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot'")
    .get(conv?.id);
  check(
    "welcome message from KuchuPuchu AI (fallback text without GEMINI_API_KEY)",
    !!msg && msg.kind === "TEXT" && msg.body.includes("Welcome to KuchuPuchu"),
    msg ? msg.body.slice(0, 50) : "none",
  );
  const unread = k.db._db
    .prepare("SELECT unread FROM members WHERE conv_id = ? AND user_id = ?")
    .get(conv.id, a.user.id);
  check(
    "the welcome is unread in the chat list",
    (unread?.unread ?? 0) >= 1,
    JSON.stringify(unread),
  );
  const last = k.db._db.prepare("SELECT last_message FROM conversations WHERE id = ?").get(conv.id);
  check(
    "chat list preview shows the welcome",
    !!last?.last_message?.includes("Welcome"),
    last?.last_message?.slice(0, 40),
  );

  // exactly ONE welcome, never duplicated by later activity
  await k.call("POST", "/api/ai/welcome", {}, a.token);
  await k.call("POST", "/api/ai/welcome", {}, a.token);
  const again = k.db._db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot'")
    .get(conv.id);
  check("exactly one welcome message (endpoint is idempotent)", again?.n === 1, String(again?.n));
}

// ---- 2. both bot accounts: verified badge + bundled logo avatar ----
{
  const k = await mk();
  const a = await k.reg("bots@x.com", "bots");
  await k.call("POST", "/api/ai/welcome", {}, a.token);
  const ai = k.db._db.prepare("SELECT * FROM users WHERE id = 'kp_ai_bot'").get();
  check("AI bot user exists", !!ai && ai.display_name === "KuchuPuchu AI", ai?.display_name);
  check("AI bot is verified", ai?.verified === 1, String(ai?.verified));
  check(
    "AI bot carries the logo avatar",
    typeof ai?.avatar_url === "string" && ai.avatar_url.startsWith("data:image/jpeg;base64,"),
    ai?.avatar_url?.slice(0, 30),
  );
  // official bot materialises on the first approval; force one
  const v = await k.call("POST", "/api/auth/verify-phone", {
    phone: a.user.phone,
    sim: "MATCH",
    deviceId: "dev-other",
    deviceName: "Pixel Test",
  });
  check(
    "approval required from the second device",
    v.json.status === "APPROVAL_REQUIRED",
    v.json.status,
  );
  await new Promise((r) => setTimeout(r, 200));
  const official = k.db._db.prepare("SELECT * FROM users WHERE id = 'kp_official_bot'").get();
  check("official bot is verified", official?.verified === 1, String(official?.verified));
  check(
    "official bot carries the logo avatar",
    typeof official?.avatar_url === "string" &&
      official.avatar_url.startsWith("data:image/jpeg;base64,"),
    official?.avatar_url?.slice(0, 30),
  );

  // the client-facing shapes expose verified + avatarRef for both bots
  const convs = await k.call("GET", "/api/conversations", undefined, a.token);
  const aiConv = convs.json.items?.find((c) => c.other?.id === "kp_ai_bot");
  const offConv = convs.json.items?.find((c) => c.other?.id === "kp_official_bot");
  check(
    "chat list marks the AI bot verified",
    aiConv?.other?.verified === true,
    JSON.stringify(aiConv?.other?.verified),
  );
  check(
    "chat list marks the official bot verified",
    offConv?.other?.verified === true,
    JSON.stringify(offConv?.other?.verified),
  );
  check(
    "bot avatars come as a light avatarRef (fetchable via /avatar)",
    typeof aiConv?.other?.avatarRef === "string" && typeof offConv?.other?.avatarRef === "string",
    `${aiConv?.other?.avatarRef} / ${offConv?.other?.avatarRef}`,
  );
  const av = await k.call("GET", `/api/users/kp_ai_bot/avatar`, undefined, a.token);
  check(
    "/api/users/:id/avatar serves the AI bot logo",
    av.status === 200 &&
      typeof av.json.avatarUrl === "string" &&
      av.json.avatarUrl.startsWith("data:image/jpeg"),
    av.status,
  );

  // a normal account stays unverified
  const b = await k.reg("plain@x.com", "plain");
  const prof = await k.call("GET", `/api/users/${b.user.id}`, undefined, a.token);
  check(
    "a normal account is NOT verified",
    prof.json.user?.verified === false,
    JSON.stringify(prof.json.user?.verified),
  );
}

// ---- 3. the approval card carries the attempt's origin (owner rule) ----
{
  const k = await mk();
  const a = await k.reg("origin@x.com", "origin");
  const v = await k.call(
    "POST",
    "/api/auth/verify-phone",
    { phone: a.user.phone, sim: "MATCH", deviceId: "dev-x", deviceName: "Samsung S24" },
    undefined,
    "198.51.100.77",
  );
  check("approval required", v.json.status === "APPROVAL_REQUIRED", v.json.status);
  await new Promise((r) => setTimeout(r, 200));
  const msg = k.db._db.prepare("SELECT * FROM messages WHERE kind = 'LOGIN_APPROVAL'").get();
  const meta = msg ? JSON.parse(msg.meta_json || "{}") : {};
  check("card meta carries the caller IP", meta.ip === "198.51.100.77", String(meta.ip));
  check(
    "card meta carries city/country (null without cf, key present)",
    "city" in meta && "country" in meta,
    JSON.stringify({ city: meta.city, country: meta.country }),
  );
  check(
    "card meta carries the attempt time",
    typeof meta.time === "string" && meta.time.length >= 20,
    String(meta.time)?.slice(0, 24),
  );
  check(
    "card body names the device",
    !!msg?.body?.includes("Samsung S24"),
    msg?.body?.slice(0, 50),
  );
}

// ---- 4. the official account is one-way; the AI chat is not ----
{
  const k = await mk();
  const a = await k.reg("oneway@x.com", "oneway");
  await k.call("POST", "/api/ai/welcome", {}, a.token);
  // materialise the official-bot conversation the way real users get it:
  // a second device asks for approval
  await k.call(
    "POST",
    "/api/auth/verify-phone",
    { phone: a.user.phone, sim: "MATCH", deviceId: "dev-2", deviceName: "Second Phone" },
    undefined,
    "198.51.100.99",
  );
  await new Promise((r) => setTimeout(r, 200));
  const offConv = convBetween(k.db, "kp_official_bot", a.user.id);
  const aiConv = convBetween(k.db, "kp_ai_bot", a.user.id);
  check("official conversation exists", !!offConv, offConv ? "" : "none");
  const r1 = await k.call(
    "POST",
    `/api/conversations/${offConv.id}/messages`,
    { body: "hi?" },
    a.token,
  );
  check(
    "replying to the official account is rejected",
    r1.status === 403 && r1.json.error?.code === "NO_REPLIES",
    `${r1.status} ${r1.json.error?.code}`,
  );
  const r2 = await k.call(
    "POST",
    `/api/conversations/${aiConv.id}/messages`,
    { body: "hey AI" },
    a.token,
  );
  check(
    "messaging the AI bot still works",
    r2.status === 201 && r2.json.message?.body === "hey AI",
    r2.status,
  );

  // the AI ANSWERS (owner feature): reply generated via ctx.waitUntil
  const reply = k.db._db
    .prepare(
      "SELECT body FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot' AND body != 'hey AI' ORDER BY rowid DESC LIMIT 1",
    )
    .get(aiConv.id);
  check(
    "KuchuPuchu AI replies to the message (fallback text without a key)",
    !!reply?.body && reply.body.length > 10,
    reply?.body?.slice(0, 50),
  );

  // bots can't be called or blocked (owner rule, enforced server-side)
  const c1 = await k.call("POST", "/api/calls", { userId: "kp_ai_bot", kind: "AUDIO" }, a.token);
  check(
    "calling a bot is rejected",
    c1.status === 403 && c1.json.error?.code === "BOT_ACCOUNT",
    `${c1.status} ${c1.json.error?.code}`,
  );
  const c2 = await k.call("POST", "/api/blocks", { userId: "kp_official_bot" }, a.token);
  check(
    "blocking a bot is rejected",
    c2.status === 403 && c2.json.error?.code === "BOT_ACCOUNT",
    `${c2.status} ${c2.json.error?.code}`,
  );

  // bots stay out of groups (owner rule)
  const b2 = await k.reg("grp@x.com", "grp");
  const g1 = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "Bots", memberIds: ["kp_ai_bot"] },
    a.token,
  );
  check("a bot-only group is refused", g1.status === 400, g1.status);
  const g2 = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "G", memberIds: [b2.user.id] },
    a.token,
  );
  const gid = g2.json.conversation?.id;
  const add = await k.call(
    "POST",
    `/api/conversations/${gid}/members`,
    { userId: "kp_official_bot" },
    a.token,
  );
  check(
    "adding a bot to a group is refused",
    add.status === 400 && add.json.error?.code === "BOT_ACCOUNT",
    `${add.status} ${add.json.error?.code}`,
  );
}

// ---- 5. welcome survives the full e2e shape the app polls ----
{
  const k = await mk();
  const phone = phoneFrom("fresh@x.com");
  const v = await k.call("POST", "/api/auth/verify-phone", {
    phone,
    sim: "MATCH",
    deviceId: "dev-f",
  });
  const b = await k.call("POST", "/api/auth/google/bind", {
    phone,
    idToken: fakeIdToken("g-fresh", "fresh@x.com"),
    deviceId: "dev-f",
    displayName: "Fresh User",
  });
  check("signup completed", b.json.status === "SESSION" && !!b.json.user, b.json.status);
  await k.call("POST", "/api/ai/welcome", {}, b.json.token);
  const convs = await k.call("GET", "/api/conversations", undefined, b.json.token);
  const aiConv = convs.json.items?.find((c) => c.other?.id === "kp_ai_bot");
  check(
    "fresh signup sees the AI chat with a proper title",
    !!aiConv && aiConv.other?.displayName === "KuchuPuchu AI",
    JSON.stringify(aiConv?.other?.displayName),
  );
}

// ---- 6. recovery step 1: number lookup before the "Verify It's You" step ----
{
  const k = await mk();
  const a = await k.reg("lookup@x.com", "lookup");
  const hit = await k.call("POST", "/api/auth/recovery/lookup", { phone: a.user.phone });
  check("lookup: registered number exists", hit.json.exists === true, JSON.stringify(hit.json));
  const miss = await k.call("POST", "/api/auth/recovery/lookup", {
    phone: phoneFrom("nobody@x.com"),
  });
  check("lookup: unknown number doesn't", miss.json.exists === false, JSON.stringify(miss.json));
  const bad = await k.call("POST", "/api/auth/recovery/lookup", { phone: "123" });
  check("lookup: garbage number rejected", bad.status === 400, bad.status);
}

// ---- 7. moderator badge (@fsleader): flag flows through every user shape ----
{
  const k = await mk();
  const a = await k.reg("fsleader@x.com", "fsleader");
  const b = await k.reg("plain@x.com", "plain");
  const before = await k.call("GET", "/api/users?q=fsleader", undefined, b.token);
  check(
    "moderator defaults to false",
    before.json.users?.[0]?.moderator === false,
    JSON.stringify(before.json.users?.[0]?.moderator),
  );
  // The owner action: flag the account.
  k.db._db.prepare("UPDATE users SET moderator = 1 WHERE id = ?").run(a.user.id);
  const after = await k.call("GET", "/api/users?q=fsleader", undefined, b.token);
  check(
    "discovery marks the moderator",
    after.json.users?.[0]?.moderator === true,
    JSON.stringify(after.json.users?.[0]?.moderator),
  );
  check(
    "the moderator badge is independent of verified",
    after.json.users?.[0]?.verified === false,
    JSON.stringify(after.json.users?.[0]?.verified),
  );
  // The chat-list shape (light userFrom) must carry it too — that is where
  // the Android row renders the badge.
  const conv = await k.call("POST", "/api/conversations", { userId: a.user.id }, b.token);
  const list = await k.call("GET", "/api/conversations", undefined, b.token);
  const row = (list.json.items || []).find((c) => c.id === conv.json.conversation?.id);
  check(
    "chat list carries the moderator badge on the other user",
    row?.other?.moderator === true,
    JSON.stringify(row?.other?.moderator),
  );
  const rowB = await k.call("GET", "/api/conversations", undefined, a.token);
  const otherSide = (rowB.json.items || []).find((c) => c.id === conv.json.conversation?.id);
  check(
    "the OTHER side of the chat is not a moderator",
    otherSide?.other?.moderator === false,
    JSON.stringify(otherSide?.other?.moderator),
  );
}

// ---- 8. owner identity: profile card, pure-Bangla rule, image fallback ----
{
  const k = await mk();
  const a = await k.reg("ownerq@x.com", "ownerq");
  await k.call("POST", "/api/ai/welcome", {}, a.token);
  const conv = convBetween(k.db, "kp_ai_bot", a.user.id);
  const send = (body) =>
    k.call(
      "POST",
      `/api/conversations/${conv.id}/messages`,
      { kind: "TEXT", body, clientId: `c-own-${Math.random()}` },
      a.token,
    );
  // A user row carrying the owner username → the card must embed that id so
  // the app's Message button can open the direct chat.
  k.db._db.prepare("UPDATE users SET username = 'rabbihossainltd' WHERE id = ?").run(a.user.id);
  await send("owner ke? ke banaiyechhe ei app?");
  const cardMeta = k.db._db
    .prepare("SELECT meta_json FROM messages WHERE conv_id = ? AND kind = 'OWNER_CARD'")
    .get(conv.id);
  check(
    "card meta carries the owner's userId for the Message button",
    !!cardMeta?.meta_json && JSON.parse(cardMeta.meta_json).ownerUserId === a.user.id,
    JSON.stringify(cardMeta?.meta_json),
  );
  const cards = () =>
    k.db._db
      .prepare("SELECT COUNT(*) n FROM messages WHERE conv_id = ? AND kind = 'OWNER_CARD'")
      .get(conv.id).n;
  check("owner question drops the tappable profile card", cards() === 1, String(cards()));
  const reply = k.db._db
    .prepare(
      "SELECT body FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot' AND kind = 'TEXT' ORDER BY rowid DESC",
    )
    .get(conv.id);
  check("owner question still gets a text answer", !!reply?.body, JSON.stringify(reply?.body));
  await send("ar developer ke tomader?");
  check("card is deduped inside a 10-message window", cards() === 1, String(cards()));

  // A fresh user asking a NORMAL question gets no card.
  const b = await k.reg("normalq@x.com", "normalq");
  await k.call("POST", "/api/ai/welcome", {}, b.token);
  const convB = convBetween(k.db, "kp_ai_bot", b.user.id);
  await k.call(
    "POST",
    `/api/conversations/${convB.id}/messages`,
    { kind: "TEXT", body: "kemon acho?", clientId: "c-normal-1" },
    b.token,
  );
  const cardsB = k.db._db
    .prepare("SELECT COUNT(*) n FROM messages WHERE conv_id = ? AND kind = 'OWNER_CARD'")
    .get(convB.id).n;
  check("a normal question drops no card", cardsB === 0, String(cardsB));

  // Photo-create intent without GEMINI_API_KEY: no IMAGE message, the text
  // fallback still answers — the user is never left silent.
  await send("amar ekta photo banao — a cat in space");
  const botImages = k.db._db
    .prepare(
      "SELECT COUNT(*) n FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot' AND kind = 'IMAGE'",
    )
    .get(conv.id).n;
  check("no image key → no IMAGE message from the bot", botImages === 0, String(botImages));
  const lastBot = k.db._db
    .prepare(
      "SELECT body FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot' ORDER BY rowid DESC",
    )
    .get(conv.id);
  check("photo request still gets a text answer", !!lastBot?.body, "");

  // The persona itself (static source checks).
  const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
  check("persona carries MD Rabbi Hossain", src.includes("MD Rabbi Hossain"));
  check(
    "persona carries the owner's email + website",
    src.includes("info@rabbihossainltd.online") && src.includes("https://rabbihossainltd.online"),
  );
  check(
    "persona carries all four social handles",
    ["@Rabbihossainltd", "@Rabbihossainltd1", "@Rabbihossainltd0"].every((h) => src.includes(h)) &&
      src.includes("TikTok @Rabbihossainltd"),
  );
  check("pure-Bengali-script rule present", src.includes("pure Bengali"));
  check(
    "owner name always in English letters (never transliterated)",
    src.includes("transliterate his name into Bengali script"),
  );

  // ---- Owner round 3 (2026-09-04) — static wiring checks ----
  const chat = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
    "utf8",
  );
  check(
    "header shows the first name only (honorific MD skipped, bots/groups full)",
    chat.includes('w.equals("MD", true)') && chat.includes("if (botChat || isGroup) rawTitle"),
  );
  check(
    "header text block sits at the avatar middle via draw-time offset (no layout space)",
    /Column\(Modifier\.weight\(1f\)\.offset\(y = \d+\.dp\)\)/.test(chat) &&
      !/modifier = Modifier\.padding\(top = \d+\.dp\),\s*\) \{\s*Text\(\s*title/.test(chat),
  );
  check("owner card animation removed", !chat.includes("cardScale"));
  check(
    "owner card covers the full bubble width",
    chat.includes("val cardMax =") && chat.includes(".width(cardMax)"),
  );
  check(
    "login approval: 5-minute client expiry + decision memory",
    chat.includes("ScreenStore.loginApprovals") && chat.includes("plusSeconds(300)"),
  );
  check(
    "stamp reserves its width INLINE at the last line (rounds 12→13)",
    chat.includes("\u00A0\u00A0") && chat.includes('bottom = if (kind == "TEXT") 0.dp else 15.dp'),
  );
  check(
    "worker: decline also enforces the 5-minute window",
    src.includes("AND status = 'PENDING' AND expires_at > ?"),
  );

  // ---- Owner round 4 (2026-09-04) ----
  check(
    "message stamps use the 12-hour clock (AM/PM) everywhere",
    chat.includes('if (z.hour >= 12) "PM" else "AM"') && !chat.includes('"%02d:%02d", z.hour'),
  );
  check(
    "typing bubble: one shared bouncing-dots indicator, header typing text removed",
    chat.includes("aiTyping || typingLeaseActive") &&
      chat.includes("TypingBubble()") &&
      !chat.includes('typingNow -> "typing..."'),
  );
  check(
    "owner photo viewer is truly fullscreen (no platform dialog width cap)",
    chat.includes("usePlatformDefaultWidth = false"),
  );
  check(
    "owner card dedupe: once per conversation per 24h / 100 messages",
    src.includes("- 100") && src.includes("24 * 3600_000"),
  );
  check(
    "viewing messages cancels their OS notification cards instantly",
    chat.includes("KpNotify.cancelConversation(ctx, convId)"),
  );

  // ---- Owner round 5 (2026-09-04) ----
  const gauth = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/GoogleAuth.kt",
    "utf8",
  );
  check(
    "Google token extraction parses the CustomCredential payload (works on every OEM)",
    gauth.includes("GoogleIdTokenCredential.createFrom(c.data)") &&
      gauth.includes("TYPE_GOOGLE_ID_TOKEN_CREDENTIAL"),
  );
  check(
    "header subtitle raised further (only that line moves)",
    chat.includes("Modifier.offset(y = (-6).dp)"),
  );
  check(
    "bundled owner photo is high-res (fullscreen stays sharp)",
    existsSync("native-android/app/src/main/res/drawable-nodpi/owner_avatar.jpg") &&
      statSync("native-android/app/src/main/res/drawable-nodpi/owner_avatar.jpg").size > 40000,
  );

  // ---- Owner round 6 (2026-09-04) ----
  check(
    "owner card photo bigger: 92% width card + square photo",
    chat.includes("0.92f") && chat.includes(".aspectRatio(1f)"),
  );
  check(
    "stamp can never wrap to its own line (inline machinery retired r12)",
    !chat.includes("appendInlineContent") && !chat.includes("InlineTextContent"),
  );
  check("timestamp parsing memoized (scroll perf)", chat.includes("stampCache"));
  check(
    "socket-down fallback poll 3s + active rejoin (realtime lateness)",
    chat.includes(">= 3_000") &&
      chat.includes("KpSocket.joinChat(convId)") &&
      chat.includes("lastRejoin"),
  );

  // ---- Owner round 7 (2026-09-04) ----
  check(
    "AI replies: gemini-3.5-flash first + thinking disabled (empty-reply bug)",
    src.includes("gemini-3.5-flash") && src.includes("thinkingBudget"),
  );
  check(
    "bot-conversation reset endpoint exists (bot chats only)",
    src.includes("convResetMatch = path.match") && src.includes("Only bot chats can be reset"),
  );
  check(
    "AI chat menu: exactly the six owner options",
    chat.includes('"New chat"') &&
      chat.includes('"Incognito mode"') &&
      chat.includes('"Search in chat"') &&
      chat.includes('"History"') &&
      chat.includes('otherUserId == "kp_ai_bot"'),
  );
  check(
    "notifications bot has no options menu",
    chat.includes('if (otherUserId != "kp_official_bot") {'),
  );
  check(
    "owner account cannot be blocked from its profile",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
      "utf8",
    ).includes('u.optText("username") != "rabbihossainltd"'),
  );
  check(
    "owner card photo is display-only (no viewer, no click)",
    !chat.includes("clickable { showPhoto = true }"),
  );

  // ---- Owner round 8 (2026-09-04) ----
  check(
    "reset route has its own regex (convMatch never matched /reset)",
    src.includes("convResetMatch = path.match") &&
      !src.includes('convMatch && method === "POST" && url.pathname.endsWith("/reset")'),
  );
  check(
    "AI resets archive to ai_sessions for History",
    src.includes("INSERT INTO ai_sessions") && src.includes("/api/ai/sessions"),
  );
  const hist = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
    "utf8",
  );
  check(
    "AI History screen exists + routed",
    hist.includes("AIHistoryScreen") && chat.includes('nav.navigate("aihistory")'),
  );
  check(
    "AI menu: Reset session replaced by History",
    !chat.includes('"Reset session"') && chat.includes('"History"'),
  );
  check(
    "Google sign-in: single sheet launch (no relaunch flash)",
    gauth.split("attempt(nativeOption())").length === 2,
  );
  check(
    "Google parser also reads raw bundle token keys",
    gauth.includes('"idToken"') && gauth.includes("googleIdToken"),
  );
  check(
    "OTP test code kept on file (Firebase Phone Auth; UI hidden per owner round 10)",
    existsSync("native-android/app/src/main/java/app/kuchupuchu/android/OtpTest.kt") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/OtpTest.kt",
        "utf8",
      ).includes("PhoneAuthProvider.verifyPhoneNumber") &&
      !readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
        "utf8",
      ).includes("Test OTP (beta)"),
  );
  check(
    "photo bubbles have a 1dp border",
    chat.includes(".border(1.dp, Color(0x2E000000), RoundedCornerShape(12.dp))"),
  );
  check("header block trimmed 2px more (offset 6->4)", chat.includes("offset(y = 4.dp)"));

  // ---- Owner round 9 (2026-09-04) ----
  check(
    "owner card: Bangla verb family + Bengali-script name + photo asks match",
    src.includes("|বানা|বানি|") &&
      src.includes("(রাব্বি|রবি)") &&
      src.includes("হোসেন") &&
      src.includes("তৈরি\\s*করে"),
  );

  // ---- Owner round 10 (2026-09-04) ----
  const feel = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Feel.kt",
    "utf8",
  );
  check(
    "owner sound set bundled: call ring + 7 incoming ringtones + sent + in-app",
    existsSync("native-android/app/src/main/res/raw/kp_call_ring.mp3") &&
      existsSync("native-android/app/src/main/res/raw/kp_in_ring_7.mp3") &&
      existsSync("native-android/app/src/main/res/raw/kp_sent.mp3") &&
      existsSync("native-android/app/src/main/res/raw/kp_inapp_msg.mp3"),
  );
  check(
    "incoming ringtone user-selectable (SoundPrefs) and used by CallNotify",
    feel.includes("SoundPrefs") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/CallNotify.kt",
        "utf8",
      ).includes("SoundPrefs.incomingRingRes(ctx)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
        "utf8",
      ).includes("Incoming ringtone"),
  );
  check(
    "BOTH sounds live: tap (send) + server-accept (sent) on every kind",
    chat.includes("KpSounds.sent(ctx)") && chat.includes("KpSounds.send(ctx)"),
  );
  check(
    "in-app message sound only when off the chat screen",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt",
      "utf8",
    ).includes("!muted && !inChat") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt",
        "utf8",
      ).includes("KpSounds.inApp(this)"),
  );
  check(
    "bubbles + mic/send circles got the 3D treatment",
    chat.includes(".shadow(2.dp, bubbleShape)") && chat.includes(".shadow(4.dp, CircleShape)"),
  );
  check(
    "OTP test UI hidden (kept for later)",
    !readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
      "utf8",
    ).includes("Test OTP (beta)") &&
      existsSync("native-android/app/src/main/java/app/kuchupuchu/android/OtpTest.kt"),
  );
  check("owner Bangla name spelled রাব্বি হোসেন in the persona", src.includes("রাব্বি হোসেন"));

  // ---- Owner round 11 (2026-09-05) ----
  check(
    "AI: each Gemini model capped at 10s so one 503 can't starve the rest",
    src.includes("Math.min(remaining, 10_000)") && src.includes("gemini-3.8-flash"),
  );
  check("user-channel conv pokes carry msg:1 for the in-app sound", src.includes("msg: 1 }"));
  const kpapp = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt",
    "utf8",
  );
  check(
    "in-app sound also wired at the socket level (FCM skip hole)",
    kpapp.includes("KpSounds.inApp(appCtx)") && kpapp.includes('ev.optBoolean("msg")'),
  );
  check(
    "Close incognito mode restores the latest session server-side",
    chat.includes('"Close incognito mode"') &&
      chat.includes("/api/conversations/$convId/restore-latest") &&
      src.includes("/restore-latest"),
  );
  check(
    "ringtone picker is top-level (not nested inside the edit dialog)",
    !readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
      "utf8",
    ).includes("if (editField != null) {\n        // Owner round 10: incoming-ringtone"),
  );
  check(
    "history session bubbles capped at 300dp (no off-screen content)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
      "utf8",
    ).includes(".widthIn(max = 300.dp)"),
  );

  // ---- Owner round 11b (2026-09-05): fullscreen ringtone picker ----
  const settings = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
    "utf8",
  );
  check(
    "fullscreen ringtone picker: tap=preview, Save=keep, custom audio option",
    settings.includes("RingtonePickerScreen") &&
      settings.includes("OpenDocument()") &&
      settings.includes('"Pick any audio from this phone"') &&
      settings.includes('Text("Save"'),
  );
  check(
    "custom ringtone actually plays (CallNotify prefers the file)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/CallNotify.kt",
      "utf8",
    ).includes("SoundPrefs.customRingPath"),
  );
  check("the retired Banglish-spelling rule is gone", !src.includes("kemon achen"));

  // ---- Owner round 12 (2026-09-05): 5 device reports ----
  check(
    "AI budget 900 tokens: Bengali script no longer dies mid-message",
    src.includes("geminiComplete(env, prompt, 900)"),
  );
  check(
    "callee in a call → 486 LINE_BUSY (pair-redial never blocked)",
    src.includes('fail(486, "Line busy — on another call right now.", "LINE_BUSY")') &&
      src.includes("NOT (caller_id IN (?, ?) AND callee_id IN (?, ?))"),
  );
  const engine = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallEngine.kt",
    "utf8",
  );
  check(
    "LINE_BUSY shows on the calling screen, then closes",
    engine.includes("api?.status == 486") &&
      engine.includes('copy(status = "BUSY")') &&
      engine.includes("delay(2200)"),
  );
  check(
    "mobile-data calls: TURN over TCP 443 ahead of openrelay",
    engine.includes("turn:turn.nextcloud.com:443?transport=tcp") &&
      engine.includes("turn:standard.relay.metered.ca:80") &&
      engine.indexOf("turn:turn.nextcloud.com:443?transport=tcp") <
        engine.indexOf("turn:openrelay.metered.ca:80"),
  );
  check(
    "timestamp + tick pinned to the bubble's bottom-end, never its own line",
    chat.includes("Alignment.BottomEnd") &&
      chat.includes('bottom = if (kind == "TEXT") 0.dp else 15.dp') &&
      !chat.includes("appendInlineContent"),
  );
  const calls = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt",
    "utf8",
  );
  // ---- Owner round 13 (2026-09-05): 20 reports ----
  const chatlist = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
    "utf8",
  );
  const theme = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Theme.kt",
    "utf8",
  );
  check(
    "in-app sound: the MAIN send path pokes msg:1 + senderId",
    src.includes('{ type: "conv", conversationId, at, msg: 1, senderId }') &&
      src.includes("pokeUserConversation(env, memberId.user_id, convId, created, uid)"),
  );
  check(
    "own sends never trigger the in-app sound",
    kpapp.includes('ev.optString("senderId") == Store.me?.optString("id").orEmpty()'),
  );
  check(
    "owner card lands BEFORE the AI reply (card first, then the answer)",
    src.includes("Date.parse(created) - 1") &&
      src.indexOf("id: mid,", src.indexOf("the card now lands BEFORE")) -
        src.indexOf("the card now lands BEFORE") <
        2500,
  );
  check(
    "delete chat is REAL: rows gone, search can't resurrect it",
    src.includes("DELETE FROM messages WHERE conv_id = ?") &&
      src.includes("last_message = NULL, last_message_at = NULL"),
  );
  check(
    "swipe-to-reply threads server-side (reply_to column + validated)",
    src.includes("ALTER TABLE messages ADD COLUMN reply_to") &&
      src.includes("SELECT id FROM messages WHERE id = ? AND conv_id = ? LIMIT 1") &&
      src.includes("replyTo: row.reply_to || undefined"),
  );
  check(
    "incoming ringtone is the ORIGINAL tone again (ringback stays caller-side)",
    feel.includes("R.raw.kp_ring3,") &&
      !feel.includes("R.raw.kp_call_ring,\n        R.raw.kp_in_ring_1"),
  );
  check(
    "dark blue theme is the default (live-switchable)",
    theme.includes("@Volatile\n    var darkBlue: Boolean = true") &&
      theme.includes('getString(PREF, "dark_blue")') &&
      settings.includes('"App theme"') &&
      settings.includes("recreate()"),
  );
  check(
    "13d: settings rows edit INLINE (no popups), API link row gone, custom-ring row themed",
    settings.includes("EditableSettingRow") &&
      !settings.includes("editField != null") &&
      !settings.includes("workers.dev") &&
      settings.includes("selCustom != null) GoldSoft else Card"),
  );
  check(
    "13e: the row VALUE itself becomes the editor (no second box below)",
    settings.includes("BasicTextField(") && !settings.includes("OutlinedTextField("),
  );
  check(
    "13e: ringtone preview stops on ANY exit (dispose hook)",
    settings.includes("onDispose { stopPreview() }"),
  );
  check(
    "13e: VerifyError fix — no @OptIn-annotated locals inside the ChatScreen body",
    !chat.includes(
      "@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)\n    val imeVisible",
    ),
  );
  check(
    "13d: on-device crash capture installed (silent chat crash diagnosis)",
    existsSync("native-android/app/src/main/java/app/kuchupuchu/android/KpCrash.kt") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
        "utf8",
      ).includes("KpCrash.install(this)") &&
      kpapp.includes("KpCrashReportDialog()") &&
      chat.includes("KpCrash.mark"),
  );
  check(
    "13d: call avatar warmed at ring time + keyed backdrop (no late pop-in)",
    engine.includes("warmAvatar") &&
      engine.includes('memoryCacheKey("callbg:$full")') &&
      calls.includes('memoryCacheKey("callbg:$full")'),
  );
  check(
    "13b hotfix: palette is STATIC (no per-read snapshot state), theme applies via activity recreate",
    !theme.includes("mutableStateOf") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
        "utf8",
      ).includes("KpThemeMode.load(this)"),
  );
  check(
    "13b hotfix: reply swipe uses the standard gesture detector (no scroll fight)",
    chat.includes("detectHorizontalDragGestures(") && !chat.includes("var consumed = false"),
  );
  check(
    "13b hotfix: archive pull-hold observes crossings (no per-pixel restarts)",
    chatlist.includes("snapshotFlow { pull >= threshold }"),
  );
  check(
    "in-call notification is app-styled: big red End, speaker voice-only",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/CallNotify.kt",
      "utf8",
    ).includes("R.layout.kp_ongoing_call") &&
      existsSync("native-android/app/src/main/res/layout/kp_ongoing_call.xml") &&
      readFileSync("native-android/app/src/main/res/layout/kp_ongoing_call.xml", "utf8").includes(
        "kp_ongoing_end",
      ),
  );
  check(
    "accept is on the RIGHT, decline LEFT",
    calls.indexOf("Decline LEFT, Accept RIGHT") < calls.indexOf("fun VoiceCallScreen"),
  );
  check(
    "AI chat: mic disabled; sub-second voice cancels silently",
    chat.includes("micEnabled = !isAiChat") && !chat.includes("at least 1 second to record"),
  );
  check(
    "mic button: fill removed, faint 3D lift",
    chat.includes("shadow(2.dp, CircleShape") &&
      !chat.includes(".background(if (cancelArmed) Color.White else Gold)"),
  );
  check(
    "keyboard jump uses the safe isImeVisible flag (no ViewTreeObserver crash)",
    chat.includes("WindowInsets.isImeVisible") &&
      chat.includes("private fun KpImeAutoScroll") &&
      !chat.includes("snapshotFlow { kpIme"),
  );
  check(
    "swipe a bubble right to quote-reply",
    chat.includes("onReply = { haptics.tap(); replyTo = it }") &&
      chat.includes('payload.put("replyTo", it)') &&
      chat.includes("quoteFor = { rid ->"),
  );
  check(
    "archive opens by pull + 3s hold with an animated logo",
    chatlist.includes("Keep holding for archived chats") &&
      chatlist.includes("pop.animateTo(") &&
      !chatlist.includes("Release for archived chats"),
  );
  check(
    "calls tab: skeleton rows + 20s cache (no laggy refetch)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt",
      "utf8",
    ).includes("KpShimmerListItem()") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt",
        "utf8",
      ).includes("lastCallsFetch"),
  );
  check(
    "AI history lands on the newest messages + skeleton list",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
      "utf8",
    ).includes("scrollToItem(msgs.size - 1)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
        "utf8",
      ).includes("KpShimmerListItem()"),
  );
  check(
    "ringtone picker compacted",
    settings.includes("vertical = 7.dp") && settings.includes("fontSize = 13.5.sp"),
  );
  check(
    "status replies quote with >, no emoji anywhere in UI text",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
      "utf8",
    ).includes("> $snippet") &&
      !src.includes("🤖") &&
      !chatlist.includes('return "📷 Photo"') &&
      !chatlist.includes('return "🎤 Voice message"'),
  );
  check(
    "loading skeletons exist (Ui.kt shimmer primitives)",
    readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt", "utf8").includes(
      "fun kpShimmerBrush",
    ) && chat.includes("KpShimmerRow(alignedEnd"),
  );

  const voiceStart = calls.indexOf("fun VoiceCallScreen");
  const voiceBody = calls.slice(voiceStart, calls.indexOf("fun ", voiceStart + 30));
  check(
    "voice call: blurred fullscreen callee photo, avatar zoom/pulse removed",
    calls.includes(".blur(28.dp)") &&
      voiceBody.includes("BlurredAvatarBackdrop") &&
      !voiceBody.includes("PulseRing"),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`bots-verified: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
