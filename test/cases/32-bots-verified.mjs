// Bots & badges (owner round): the KuchuPuchu AI welcome message (Gemini
// fallback when no key), both bot accounts verified with the bundled logo
// avatar, the login-approval card carrying the attempt's origin (IP, place,
// time), and the official notification account being strictly one-way.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    chat.includes("\u00A0\u00A0") &&
      // r31-12: emoji-only texts keep the bottom band instead (stamp under the emoji).
      chat.includes('bottom = if (kind == "TEXT" && emojiOnly == 0) 0.dp else 15.dp'),
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
    "round 14: 3s poll when socket down + 8s half-open safety net + 10s rejoin",
    chat.includes("3_000L else 8_000L") &&
      chat.includes("KpSocket.joinChat(convId)") &&
      chat.includes("lastRejoin") &&
      chat.includes("chatLive(convId)"),
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
    "photo bubbles have a 1dp border — round 16: gray-blue on dark, gray-black on cream",
    chat.includes("if (KpThemeMode.darkBlue) Color(0x668091AC) else Color(0x66444444)"),
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
      ).includes("Call ringtone"),
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
    "AI: each Gemini model capped (round 15: 6s) so one 503 can't starve the rest",
    src.includes("Math.min(remaining, 6_000)") && src.includes("gemini-3.8-flash"),
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
    src.includes("geminiComplete(env, prompt + voicePrompt, 900, voiceParts)"),
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
      chat.includes('bottom = if (kind == "TEXT" && emojiOnly == 0) 0.dp else 15.dp') &&
      !chat.includes("appendInlineContent"),
  );
  const calls = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt",
    "utf8",
  );
  // ---- Owner round 13 (2026-09-05): 20 reports ----
  const feelkt = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Feel.kt",
    "utf8",
  );
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
      // r27: the lookup also refuses an unsent row as the quote target
      src.includes(
        "SELECT id FROM messages WHERE id = ? AND conv_id = ? AND kind != 'DELETED' LIMIT 1",
      ) &&
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
    "13d/r23: settings rows navigate to edit screens, API link row gone, custom-ring row themed",
    settings.includes("fun EditPhoneScreen(") &&
      !settings.includes("editField != null") &&
      !settings.includes("workers.dev") &&
      settings.includes("selCustom != null) GoldSoft else Card"),
  );
  check(
    "13e/r22: profile fields edit on their OWN screens (name/username/about/phone)",
    settings.includes("OutlinedTextField(") && settings.includes("fun EditNameScreen("),
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
    chatlist.includes("snapshotFlow { state.pull >= state.thresholdPx }"),
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
    "AI chat: mic enabled again (r31-17 — the AI hears voice notes); sub-second voice cancels silently",
    chat.includes("micEnabled = true,") &&
      !chat.includes("micEnabled = !isAiChat") &&
      !chat.includes("at least 1 second to record"),
  );
  check(
    "mic button: fully transparent (round 15: shadow removed too), ring stays",
    !chat.includes("shadow(2.dp, CircleShape") &&
      chat.includes("1.5.dp, if (cancelArmed) Red else accent") &&
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
    chat.includes("onReply = { haptics.tap(); replyTo = it; replyFocusNonce++ }") &&
      chat.includes('payload.put("replyTo", it)') &&
      chat.includes("quoteFor = { rid ->"),
  );
  check(
    "archive: 2s pull-hold, animation ONLY — ring fills, theme-gold ARCHIVE icon (no text/green/tick)",
    chatlist.includes("CircularProgressIndicator(") &&
      chatlist.includes("pop.animateTo(") &&
      chatlist.includes("< 2000)") &&
      chatlist.includes("/ 2000f") &&
      chatlist.includes("Icons.Filled.Archive, null, tint = ActionBlueDeep") &&
      !chatlist.includes("Keep holding for archived chats") &&
      !chatlist.includes("Pull down and hold") &&
      !chatlist.includes("LinearProgressIndicator") &&
      !chatlist.includes('Text("Archived", fontSize = 17.sp') &&
      !chatlist.includes("tint = Green"),
  );
  /* ---------------- round 17 (owner feedback) ---------------- */
  const mainactivity = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
    "utf8",
  );
  const ongoingxml = readFileSync(
    "native-android/app/src/main/res/layout/kp_ongoing_call.xml",
    "utf8",
  );
  const callnotify = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallNotify.kt",
    "utf8",
  );
  check(
    "r17-3/r18-2: ONE hang-up affordance — red icon + red 'Hang up' text, NO speaker button and NO backgrounds (r18)",
    ongoingxml.includes('android:id="@+id/kp_ongoing_end"') &&
      ongoingxml.includes("Hang up") &&
      readFileSync(
        "native-android/app/src/main/res/drawable/kp_hangup_border.xml",
        "utf8",
      ).includes("#F0402F") &&
      !ongoingxml.includes("kp_ongoing_speaker") &&
      !callnotify.includes("speaker_wrap") &&
      !ongoingxml
        .replace('android:background="@drawable/kp_hangup_border"', "")
        .includes("android:background=") &&
      ongoingxml.includes("@drawable/kp_hangup_border") &&
      existsSync("native-android/app/src/main/res/drawable/kp_hangup_border.xml") &&
      ongoingxml.includes('android:textColor="#FFFFFF"') &&
      !callnotify.includes(".setColor(") &&
      ongoingxml.includes('android:textColor="#F2F5FA"') &&
      ongoingxml.includes('android:textColor="#A9B4C9"'),
  );
  check(
    "r17-6: archive pull is dual-path — list overscroll AND header/tabs drag share ArchivePullState",
    chatlist.includes("class ArchivePullState") &&
      chatlist.includes("val archivePull = remember { ArchivePullState() }") &&
      chatlist.includes("detectVerticalDragGestures") &&
      chatlist.includes(".then(archiveDrag)"),
  );
  check(
    "r17-8: half-open socket can't freeze the list — marker-gated safety refresh while foreground",
    chatlist.includes("lastSafetyRefresh") && chatlist.includes("4_000"),
  );
  check(
    "r17-8: EVERY AI text reply broadcasts + pokes + pushes (not just owner-card replies)",
    src.includes("THE real AI-visibility bug") &&
      src.includes("senderId: AI_BOT_ID") &&
      src.split("pushToUser(").length - 1 >= 4,
  );
  check(
    "r18-5: composer pill is BACK; only the live recording panel is transparent",
    chat.includes(
      "heightIn(min = 38.dp)\n                    // Owner round 18: the pill is BACK",
    ) &&
      chat.includes("no card background — transparent like the bar") &&
      !chat
        .replace(
          "/* live recording panel: timer + slide-to-cancel hint.\n               Owner round 16: no card background — transparent like the bar. */",
          "",
        )
        .includes(
          ".weight(1f)\n                    .padding(horizontal = 12.dp, vertical = 8.dp)\n                verticalAlignment",
        ),
  );
  check(
    "r17-11: reply-quote sender names are full ink (white on own bubbles), not gold-on-gold",
    chat.includes("color = if (mine) Color(0xE6FFFFFF) else Ink"),
  );
  check(
    "r17-12/18: reply swipes calmer — text own-swipe 1.5x, photo 1.4x (no more 1.8x hair-trigger)",
    chat.includes("replyThreshold * 1.5f") &&
      chat.includes("if (mine) replyThreshold * 1.5f else replyThreshold") &&
      chat.includes("replyThreshold * 1.4f") &&
      !chat.includes("replyThreshold * 1.8f, 0f)\n                                    } else {"),
  );
  check(
    "r17-13/r31-8: long-press opens ONE action sheet — reaction row on top ('+' = full emoji sheet), then Reply/Copy/Forward/Edit/Unsend/Delete/Select; reacting deselects; no floating bar",
    !chat.includes("listState.layoutInfo.visibleItemsInfo.firstOrNull") &&
      chat.includes("if (mid in selected) selected.remove(mid)") &&
      chat.includes("ModalBottomSheet(") &&
      chat.includes("skipPartiallyExpanded = true") &&
      chat.includes("var actionFor by remember { mutableStateOf<JSONObject?>(null) }") &&
      chat.includes("actionFor?.let { m ->") &&
      chat.includes('listOf("👍", "❤️", "😂", "😮", "😢", "🙏").forEach { e ->') &&
      ['"Reply"', '"Copy"', '"Forward"', '"Edit"', '"Unsend"', '"Delete for me"', '"Select"'].every(
        (l) =>
          chat.includes(
            `KpSheetRow(Icons.${l === '"Reply"' ? "AutoMirrored.Filled.Reply" : l === '"Forward"' ? "AutoMirrored.Filled.Send" : l === '"Copy"' ? "Filled.ContentCopy" : l === '"Edit"' ? "Filled.Edit" : l === '"Unsend"' ? "Filled.DeleteForever" : l === '"Delete for me"' ? "Filled.Delete" : "Filled.CheckCircle"}, ${l}`,
          ),
      ) &&
      (
        chat.match(
          /if \(selectedIds\.isNotEmpty\(\)\) onToggleSelect\(m\) else onLongPress\(m\)/g,
        ) || []
      ).length === 3,
  );
  check(
    "r17-14: restoreChrome follows the theme (dark-blue keeps light icons)",
    mainactivity.includes("!KpThemeMode.darkBlue"),
  );
  check(
    "r17-15: chat-search close is a real X",
    chat.includes('Icons.Filled.Close,\n                "Close search"'),
  );
  check(
    "r17-19: theme options read exactly Dark Blue / Light Cream",
    settings.includes('"Light Cream"') &&
      settings.includes('if (KpThemeMode.darkBlue) "Dark Blue" else "Light Cream"'),
  );
  check(
    "r17-20/r31: the uniform settings pencil is gone (the only pencil is the change-photo one on My profile)",
    settings.split("Icons.Filled.Edit").length - 1 === 0 &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
        "utf8",
      ).includes('Icon(Icons.Filled.Edit, "Change photo"'),
  );
  const callscreen = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt",
    "utf8",
  );
  const screenstore = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ScreenStore.kt",
    "utf8",
  );
  check(
    "r18-1/r22: system back MINIMIZES the call into the notification — app usable underneath",
    callscreen.includes("Owner round 22 (reverses the r18/r19 lock)") &&
      callscreen.includes("engine.minimizeCall()") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
        "utf8",
      ).includes("CallEngine.instance?.restoreCallUi()"),
  );
  check(
    "r18-4/r19-4: archive pull works ON TOP OF ROWS — pass-through drag observer on the list itself",
    chatlist.includes("var canPull: () -> Boolean") &&
      chatlist.includes("first.index == 0 && first.offset == 0") &&
      chatlist.includes("awaitFirstDown(requireUnconsumed = false)") &&
      chatlist.includes("archivePull.pull = pull") &&
      chatlist.includes("state = listState") &&
      !chatlist.includes("NestedScrollConnection"),
  );
  check(
    "r18-6: PHOTOS render reaction chips too (MessageReactions wired into ImageMessageRow)",
    chat.indexOf("MessageReactions(m)") <
      chat.indexOf("Live upload fractions keyed by message clientId") &&
      chat.split("MessageReactions(m)").length - 1 === 3,
  );
  check(
    "r18-3/r25: unsent messages VANISH (no tombstone) — filtered before render",
    chat.includes('m.optString("kind") != "DELETED" && run {'),
  );
  check(
    "r18-7: system back steps one level — chat search closes, settings pickers/editors close first",
    chat.includes("BackHandler(enabled = showChatSearch)") &&
      // r30-2: the inline field editors left Settings (they live in My
      // profile now); the pickers still close first.
      settings.includes(
        "BackHandler(enabled = showThemePicker || showRingPicker || showSoundType)",
      ),
  );
  check(
    "r18-8: leaving a chat re-marks read + poke merges honor the read grace (no stale unread badge)",
    chat.includes("DisposableEffect(convId)") &&
      chat.includes("ScreenStore.markRead(convId)\n            Thread {") &&
      screenstore.includes("Still inside the read grace"),
  );
  /* ---------------- round 19 (owner feedback) ---------------- */
  check(
    "r19-1/r22: back minimizes; a NEW incoming ring always un-minimizes (in-app fullscreen ring)",
    callscreen.includes("multitask during a call") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/CallEngine.kt",
        "utf8",
      ).includes("a NEW incoming ring always brings the") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt",
        "utf8",
      ).includes("Only a CONFIRMED"),
  );
  check(
    "r19-2: Hang up = red border + WHITE label, explicit readable text colours",
    readFileSync("native-android/app/src/main/res/drawable/kp_hangup_border.xml", "utf8").includes(
      "#F0402F",
    ) && ongoingxml.includes('android:textColor="#F2F5FA"'),
  );
  check(
    "r19-3: every selection action ALSO drops the reaction bar",
    chat.split("reactionFor = null").length - 1 >= 7 &&
      chat.indexOf("selected.clear()", chat.indexOf("fun forwardSelected")) <
        chat.indexOf("scope.launch", chat.indexOf("fun forwardSelected")),
  );
  check(
    "r19-4b: list rows show delivery ticks for own last message (main + archived)",
    chatlist.includes("fun ListTicks(") &&
      chatlist.includes("ScreenStore.lastMsg(id)") &&
      screenstore.includes("fun lastMsg(convId: String)"),
  );
  check(
    "r19-7: system back dismisses the reaction bar / emoji sheet",
    chat.includes("BackHandler(enabled = reactionFor != null || showEmojiSheet)"),
  );
  check(
    "r19-theme: chat theme restyles the message bar, voice/mic + call buttons",
    chat.includes("fun chatAccent(theme: String)") &&
      chat.includes(".background(accent.copy(alpha = 0.16f))") &&
      chat.includes("accent = accent,") &&
      chat.includes('Icons.Filled.Call, "Voice call", tint = chatAccent(chatTheme)') &&
      chat.includes("cursorBrush = androidx.compose.ui.graphics.SolidColor(accent)"),
  );
  check(
    "r19-perf: cold-reopen lag — hydrate parses off-main + snapshot is capped",
    screenstore.includes("if (!convsLoaded && convs.isEmpty())") &&
      screenstore.includes(".take(30)") &&
      screenstore.includes(".takeLast(40)") &&
      screenstore.includes("take(150)"),
  );
  /* ---------------- round 20 (owner feedback) ---------------- */ check(
    "r20-2: Hang up button is SOLID red with white text",
    ongoingxml.includes('android:background="@drawable/kp_hangup_border"') &&
      ongoingxml.includes('android:textColor="#FFFFFF"') &&
      readFileSync(
        "native-android/app/src/main/res/drawable/kp_hangup_border.xml",
        "utf8",
      ).includes("<solid"),
  );
  check(
    "r20-theme: dark-blue action accent everywhere (FAB, Save, pencil, caret, ringtone icons, profile banner)",
    theme.includes("val ActionBlue:") &&
      chatlist.includes("containerColor = ActionBlue") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes("containerColor = ActionBlue") &&
      settings.includes(".background(ActionBlue)") &&
      settings.includes("tint = ActionBlueDeep") &&
      settings.includes("cursorColor = ActionBlue"),
  );
  check(
    "r20-theme: voice-call bubbles ride the dark-blue family (Dark/DarkCard tokens)",
    theme.includes("if (KpThemeMode.darkBlue) Color(0xFF0D1524) else Color(0xFF171412)") &&
      theme.includes("if (KpThemeMode.darkBlue) Color(0xFF16213A) else Color(0xFF242019)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt",
        "utf8",
      ).includes(".background(DarkCard)"),
  );
  check(
    "r20-chat: DARK BLUE is the default chat theme — bubbles, wallpaper, accent; Cream is explicit",
    chat.includes('ifBlank { "darkblue" }') &&
      chat.includes('Opt("darkblue", "Dark Blue", Color(0xFF2F6FED))') &&
      chat.includes('Opt("default", "Cream", Gold)') &&
      chat.includes("Brush.linearGradient(listOf(Color(0xFF2F6FED), Color(0xFF1E40AF)))") &&
      chat.includes('"default" -> Cream') &&
      chat.includes('theme == "darkblue" -> Color(0xFFE6EAF2)') &&
      src.includes('theme: conv.theme || "darkblue"'),
  );
  {
    // r31-14/15: the player and the photo viewer moved to MediaViewer.kt and
    // are KuchuPuchu's own (TextureView + MediaPlayer with in-app controls;
    // no stock widget controller, never a system ACTION_VIEW for media).
    const mediaViewer = readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/MediaViewer.kt",
      "utf8",
    );
    check(
      "r20-video/r31-14: IN-APP player — video bubble + download-to-cache + own TextureView player",
      chat.includes("fun fileLooksVideo(") &&
        chat.includes("fun VideoMessageRow(") &&
        mediaViewer.includes("fun VideoPlayerScreen(nav: NavController, b64: String)") &&
        mediaViewer.includes("Api.downloadToFile(src, tmp)") &&
        mediaViewer.includes("class KpClipPlayer(") &&
        mediaViewer.includes("android.view.TextureView(c)") &&
        mediaViewer.includes("private fun SeekBar(") &&
        mediaViewer.includes("Icons.Filled.ScreenRotation") &&
        mediaViewer.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE") &&
        mediaViewer.includes("fun saveVideoToDownloads(") &&
        mediaViewer.includes("MediaStore.Downloads") &&
        chat.includes("internal object VideoThumbs") &&
        chat.includes("kp-video-cache") &&
        !chat.includes("android.widget.VideoView(") &&
        !mediaViewer.includes("MediaController"),
    );
    const rd = (f) =>
      readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/" + f, "utf8");
    const profileKt = rd("ProfileScreen.kt");
    const groupKt = rd("GroupInfoScreen.kt");
    const mediaTab = rd("ChatMediaScreen.kt");
    check(
      "r31-15: ONE in-app photo viewer (KpPhotoViewer) for chat photos, profile picture, group picture and the media tab; pinch/double-tap zoom, swipe-down close, Save (+Forward in chat)",
      mediaViewer.includes("fun KpPhotoViewer(") &&
        mediaViewer.includes("detectTapGestures(") &&
        mediaViewer.includes("onDoubleTap = { p ->") &&
        mediaViewer.includes("event.calculateZoom()") &&
        mediaViewer.includes("if (abs(dragLocal) > size.height * 0.16f)") &&
        mediaViewer.includes("usePlatformDefaultWidth = false, decorFitsSystemWindows = false") &&
        mediaViewer.includes('"Saved to Pictures/KuchuPuchu"') &&
        chat.includes("KpPhotoViewer(\n                url = messageMediaUrl(m),") &&
        !chat.includes("fun ImageViewerDialog(") &&
        profileKt.includes("KpPhotoViewer(") &&
        !profileKt.includes("ProfilePhotoDialog") &&
        groupKt.includes("shownAvatar?.takeIf { it.isNotBlank() }?.let { viewerUrl = it }") &&
        mediaTab.includes(".clickable(enabled = url.isNotBlank()) { viewer = m }") &&
        mediaTab.includes('nav.navigate("videoplayer/${mediaArg(') &&
        rd("Files.kt").includes("fun openUri(") &&
        !chat.includes("FilesUtil.openUri("),
    );
  }
  check(
    "r21-sounds: owner pack wired — notification tones, event sounds, Sounds type picker, channel rebuild",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/Feel.kt",
      "utf8",
    ).includes("kp_notif_01") &&
      feelkt.includes("fun rebuildMessageChannel") === false &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpNotify.kt",
        "utf8",
      ).includes("SoundPrefs.notificationRingRes(ctx)") &&
      settings.includes("fun SoundTypePickerScreen(") &&
      settings.includes('"Sounds"') &&
      chat.includes("KpSounds.reaction(ctx)") &&
      chat.includes("KpSounds.replySwipe(ctx)") &&
      chat.includes("KpSounds.photoSend(ctx)") &&
      chat.includes("KpSounds.voiceSend(ctx)") &&
      chat.includes("KpSounds.voiceCancel(ctx)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/CallEngine.kt",
        "utf8",
      ).includes("KpSounds.lineBusy(app)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes("KpSounds.statusShare(ctx)") &&
      existsSync("native-android/app/src/main/res/raw/kp_notif_15.mp3") &&
      existsSync("native-android/app/src/main/res/raw/kp_in_ring_8.mp3"),
  );
  check(
    "r21-colours: dark-blue sweep — tabs, ticks, search, profile, crash row, avatar rings",
    chatlist.includes("val tint = if (selected) ActionBlueDeep else Muted") &&
      chatlist.includes("tint = if (read) ActionBlueDeep else Muted") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/SearchScreen.kt",
        "utf8",
      ).includes("ActionBlue") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
        "utf8",
      ).includes("ActionBlueDeep") &&
      settings.includes('Icon(Icons.Filled.BugReport, "Crash reports", tint = ActionBlueDeep') &&
      theme.includes(
        "if (KpThemeMode.darkBlue) Brush.linearGradient(listOf(Color(0xFF60A5FA), Color(0xFF2F6FED)))",
      ),
  );
  check(
    "r20-update: the update popup re-checks on every resume (30-min throttle), push boot deferred",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
      "utf8",
    ).includes("30 * 60_000L") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
        "utf8",
      ).includes("postDelayed({ KpPush.boot(this) }, 1500)"),
  );
  /* ---------------- round 21 (dark-blue sweep completion) ---------------- */
  const ui = readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt", "utf8");
  const search = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/SearchScreen.kt",
    "utf8",
  );
  const profile = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
    "utf8",
  );
  const callstab = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt",
    "utf8",
  );
  const status = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
    "utf8",
  );
  const login = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
    "utf8",
  );
  check(
    "r21-sweep: avatar ring, empty states, nav tabs, ticks, mute pills — blue in dark mode",
    theme.includes("Brush.linearGradient(listOf(Color(0xFF60A5FA), Color(0xFF2F6FED)))") &&
      ui.includes("tint = ActionBlueDeep, modifier = Modifier.size(34.dp)") &&
      chatlist.includes("val tint = if (selected) ActionBlueDeep else Muted") &&
      chatlist.includes("background(ActionBlue)") &&
      chatlist.includes("tint = if (read) ActionBlueDeep else Muted") &&
      chatlist.split("ActionBlueDeep").length - 1 >= 4,
  );
  check(
    "r21-sweep: chat dropdown menus blue + reply/quote bars carry the chat accent",
    chat.split(", null, tint = ActionBlueDeep) }").length - 1 >= 7 &&
      chat.includes("background(chatAccent(theme))"),
  );
  check(
    "r21-sweep: friends-profile buttons, call-back icon, status pencil/status+/send, settings crash row",
    // r31-11: the friend-profile buttons now take the peer chat's accent
    // (chatAccent("darkblue") IS the blue; a themed chat brings its own).
    profile.includes("tint = peerAccent, modifier = Modifier.size(25.dp)") &&
      callstab.includes("tint = ActionBlueDeep,") &&
      status.includes("contentColor = ActionBlueDeep,") &&
      status.includes("background(ActionBlue),") &&
      settings.includes('Icon(Icons.Filled.BugReport, "Crash reports", tint = ActionBlueDeep'),
  );
  check(
    "r21-sweep: global-search chips/highlight blue in dark mode (login untouched per owner)",
    search.includes(".background(if (selected) ActionBlue else Card)") &&
      search.includes("color = ActionBlueDeep,") &&
      search.includes("ActionBlueDeep, fontWeight = FontWeight.Bold"),
  );
  check(
    "calls tab: skeleton rows + 20s cache (no laggy refetch)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt",
      "utf8",
    ).includes("KpShimmerListItem(alpha = sh)") &&
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
      ).includes("scrollBy(24f)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
        "utf8",
      ).includes("KpShimmerListItem(alpha = sh)") &&
      // Round 15: the real ~20px offset was the back icon's top padding
      // growing the header — not the scroll position.
      !readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/AIHistoryScreen.kt",
        "utf8",
      ).includes("Modifier.padding(top = 12.dp)"),
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
    "loading skeletons exist (round 14: ONE shared alpha pulse per screen, not per-row animations)",
    readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt", "utf8").includes(
      "fun rememberShimmerAlpha",
    ) &&
      chat.includes("KpShimmerRow(alignedEnd") &&
      chat.includes("rememberShimmerAlpha()") &&
      !readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt",
        "utf8",
      ).includes("fun kpShimmerBrush"),
  );

  const voiceStart = calls.indexOf("fun VoiceCallScreen");
  const voiceBody = calls.slice(voiceStart, calls.indexOf("fun ", voiceStart + 30));
  check(
    "voice call: blurred fullscreen callee photo, avatar zoom/pulse removed",
    calls.includes(".blur(28.dp)") &&
      voiceBody.includes("BlurredAvatarBackdrop") &&
      !voiceBody.includes("PulseRing"),
  );

  // ---- Owner round 14 (2026-09-05) ----
  check(
    "14: chat theme restyles wallpaper AND bubbles, dark-aware, themed picker with swatches",
    chat.includes("fun chatMineFill") &&
      chat.includes("fun chatOtherFill") &&
      chat.includes("chatMineFill(theme)") &&
      chat.includes("chatOtherFill(theme)") &&
      chat.includes("containerColor = Card") &&
      !chat.includes('"default" to "Cream"') &&
      chat.includes("KpThemeMode.darkBlue) Color(0xFF0C1A15)"),
  );
  check(
    "14: in-chat search — rounded pill at the TOP of the screen, chat-scoped",
    chat.includes("RoundedCornerShape(24.dp)") &&
      chat.includes("Alignment.TopCenter") &&
      chat.includes("Search this chat") &&
      chat.includes("$convId/messages/search"),
  );
  check(
    "14: forward picker is FULLSCREEN (no popup) with themed rows",
    chat.includes("DialogProperties(usePlatformDefaultWidth = false)") &&
      chat.includes("Forward to") &&
      chat.includes(".background(Cream)") &&
      chat.includes("BackHandler { onClose() }"),
  );
  check(
    "14: mic button keeps a visible rounded ring (armed = red)",
    chat.includes("1.5.dp, if (cancelArmed) Red else accent"),
  );
  check(
    "14: call backdrop decodes data: avatars inline (the real missing-photo bug)",
    calls.includes('avatarUrl.startsWith("data:")') &&
      calls.includes("rememberBitmap(avatarUrl)") &&
      engine.includes('if (url.startsWith("data:")) return'),
  );
  check(
    "14/r23: one edit screen per field + NO cream icon anywhere in settings (except crash switch)",
    settings.includes("fun EditNameScreen(") &&
      settings.includes("fun EditUsernameScreen(") &&
      settings.includes("fun EditAboutScreen(") &&
      settings.includes("fun EditPhoneScreen(") &&
      settings.includes("Icon(icon, contentDescription = label, tint = ActionBlueDeep") &&
      !settings.includes("tint = GoldDeep") &&
      settings.includes('Opt(false, "Light Cream"') &&
      !settings.includes('false to "Light"') &&
      settings.includes("fun ThemePickerScreen"),
  );
  check(
    "14: crash-report file read moved off the main thread (cold-open)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/KpCrash.kt",
      "utf8",
    ).includes("withContext(Dispatchers.IO) { KpCrash.lastReport(ctx) }"),
  );

  // ---- Owner round 15 (2026-09-05) ----
  check(
    "15: chat search — 3-dot Search opens the CHAT-scoped sheet everywhere (global nav gone)",
    chat.includes('Text("Search in chat", color = Ink)') &&
      !chat.includes('nav.navigate("search")') &&
      chat.includes("showChatSearch = true"),
  );
  check(
    "15: composer bar + mic fully transparent, header takes the chat theme",
    !chat.includes(".shadow(2.dp, CircleShape") &&
      chat.includes(".background(chatWallpaper(chatTheme))"),
  );
  check(
    "15: reply auto-opens the keyboard (focus nonce drives the composer)",
    chat.includes("replyFocusNonce") && chat.includes("inputFocus.requestFocus()"),
  );
  check(
    "15: chat skeleton shows — cleared when the first page LANDS, not when it starts",
    chat.includes("initialLoad = false") && chat.includes("} finally {"),
  );
  check(
    "15: realtime chat list — one-conversation instant merge on every conv poke",
    chatlist.includes("ScreenStore.upsertConv(one)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/ScreenStore.kt",
        "utf8",
      ).includes("fun upsertConv"),
  );
  check(
    "15: crash detection toggle in settings; handler + dialog honour the switch",
    settings.includes("Crash reports") &&
      settings.includes("Switch(") &&
      settings.includes("KpCrash.setEnabled(ctx, on)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpCrash.kt",
        "utf8",
      ).includes("fun setEnabled"),
  );
  check(
    "16: message reactions — quick bar (5 emojis + more), full sheet, chips under bubbles, toggle endpoint",
    chat.includes("applyReaction") &&
      chat.includes("MessageReactions") &&
      chat.includes("EmojiSheetDialog") &&
      chat.includes('"/api/messages/$mid/react"') &&
      chat.includes('"👍", "❤️", "😂", "😮", "😢", "🙏"') &&
      src.includes("/react"),
  );
  check(
    "16: AI reply pokes the USER channel — visible in the chat list without entering the chat",
    src.includes("user:${userId}"),
  );
  check(
    "16: own-message LEFT-swipe reply + photo reply drag + theme-aware photo border (r17: calmer 1.5x)",
    chat.includes("if (mine) {") &&
      chat.includes("(replyDrag + dragAmount).coerceIn(-replyThreshold * 1.5f, 0f)") &&
      chat.includes("if (mine) replyThreshold * 1.5f else replyThreshold") &&
      chat.includes(
        "ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onReply, onLongPress)",
      ),
  );
  check(
    "16: in-app updates — GitHub release check, in-app progress %, PackageInstaller, settings row",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/KpUpdate.kt",
      "utf8",
    ).includes("PackageInstaller") &&
      readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8").includes(
        "REQUEST_INSTALL_PACKAGES",
      ) &&
      kpapp.includes("KpUpdateGate") &&
      settings.includes("Check for updates"),
  );
  check(
    "16/r22: fullscreen theme picker + settings back icon matches chat + Save on the edit screens",
    settings.includes("fun ThemePickerScreen") &&
      settings.includes(
        'Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp)',
      ) &&
      settings.includes('"Save",') &&
      settings.includes("fun EditFieldScaffold("),
  );
  check(
    "15: AI replies fail over faster (per-model 10s -> 6s) + both APKs per CI run (r22)",
    src.includes("Math.min(remaining, 6_000)") &&
      readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").includes(
        "assembleDebug",
      ) &&
      readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").includes(
        "assembleRelease",
      ),
  );
  const engine23 = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallEngine.kt",
    "utf8",
  );
  const api23 = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Api.kt",
    "utf8",
  );
  check(
    "r23: in-app incoming ring is INSTANT — kickPoll fires for NEW calls (active==null), not just the live one",
    engine23.includes("if (active?.id == callId || active == null)") &&
      engine23.includes("withTimeout(4_500)"),
  );
  check(
    "r23/r31-11: call bubble matches the CHAT theme — the same fills as a text bubble (dark-blue default = blue, never amber), icon circle in the chat accent",
    chat.includes(".background(if (mine) chatMineFill(theme) else chatOtherFill(theme))") &&
      chat.includes(
        ".background(if (mine) Color(0x33FFFFFF) else chatAccent(theme).copy(alpha = 0.18f))",
      ) &&
      chat.includes("else -> Brush.linearGradient(listOf(Color(0xFF2F6FED), Color(0xFF1E40AF)))"),
  );
  check(
    "r23: video placeholder keeps its OWN ratio across restarts — meta+thumb persist to disk",
    chat.includes("fun readMeta(key: String): Meta?") &&
      chat.includes("fun readThumb(key: String)") &&
      chat.includes("VideoThumbs.readMeta(cacheKey)") &&
      chat.includes('metaFile(key).writeText("$w,$h,$ms")') &&
      chat.includes("compressed(compress") === false &&
      chat.includes("scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)"),
  );
  check(
    "r23: back from the video player KEEPS the chat position (didInitialScroll survives navigation)",
    chat.includes("var didInitialScroll by rememberSaveable { mutableStateOf(false) }"),
  );
  check(
    "r23: mobile-data networking — faster connect failover (10s) + worker call relay 1.8s->0.7s",
    api23.includes(".connectTimeout(10, TimeUnit.SECONDS)") && src.includes("setTimeout(r, 700)"),
  );
  check(
    "r24: caller never blocked by a zombie call — startCall clears a 2min+ medialess stuck active",
    engine23.includes("System.currentTimeMillis() - activeSince > 2 * 60_000L") &&
      engine23.includes("if (current?.id != ui.id) activeSince = System.currentTimeMillis()"),
  );
  check(
    "r24: in-app ring is gate-proof — re-kick after the 1.6s anti-phantom window (WS + FCM paths)",
    engine23.includes("delay(1_200); pokeTick()") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt",
        "utf8",
      ).includes("postDelayed({") &&
      engine23.includes("Store.foreground -> 1500L"),
  );
  check(
    "r24: no scroll yank — empty layout is NOT near-bottom and the first load is not a new message",
    chat.includes("} ?: false") &&
      chat.includes("prevTop.isNotBlank() && newTop.isNotBlank() && newTop != prevTop") &&
      chat.includes("if (!listState.isScrollInProgress)"),
  );
  check(
    "r24: stale ACTIVE calls are reaped server-side when the signalling room is empty",
    src.includes("call-signal/live") &&
      src.includes("status = 'ACTIVE' AND COALESCE(started_at, created_at) < ?") &&
      readFileSync("src/worker/durable-objects/CallSignal.ts", "utf8").includes(
        'url.pathname === "/live"',
      ),
  );
  check(
    "r25/26: incoming call = blurred photo backdrop + swipe circles that RIDE the finger (no labels)",
    callscreen.includes("SwipeCallCircle(") &&
      callscreen.includes("detectVerticalDragGestures") &&
      callscreen.includes("dragUpPx") &&
      !callscreen.includes("Swipe up to accept") &&
      callscreen.includes("BlurredAvatarBackdrop(call.otherAvatar.ifBlank { null })"),
  );
  check(
    "r25: call-ui belt — syncNow() on resume so a foreground ring never waits for the timer",
    engine23.includes("fun syncNow()") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
        "utf8",
      ).includes("else engine.syncNow()"),
  );
  check(
    "r25: username editor = LIVE check, green/red border, no icons, no extra instructions",
    settings.includes("LaunchedEffect(value)") &&
      settings.includes("this username not available") &&
      !settings.includes("Check availability") &&
      settings.includes("focusedBorderColor = borderColor"),
  );
  check(
    "r25: sounds row is just 'Calls & Notification' + country sheet theme colours",
    settings.includes('"Calls & Notification"') &&
      !settings.includes('"Notification · "') &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
        "utf8",
      ).includes("containerColor = Card"),
  );
  check(
    "r25: status ring DARK BLUE unseen / GRAY seen + status photo auto-closes (clock keyed on status id)",
    readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt", "utf8").includes(
      "if (seen) Color(0xFF9CA3AF) else Color(0xFF2F6FED)",
    ) &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes('LaunchedEffect(idx, videoReady, statuses.getOrNull(idx)?.optString("id"))'),
  );
  check(
    "r25: status reactions — emoji bar posts /react; viewer list shows the emoji; NO inbox message",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
      "utf8",
    ).includes("/react") &&
      src.includes("/react$") &&
      src.includes("ADD COLUMN reaction TEXT") &&
      !src.includes("status_reaction_inbox"),
  );
  check(
    "r25: photos smaller (185dp) + JPEG quality 90; voice/call stamps bottom-right; ONE back closes reaction+selection",
    chat.includes(".widthIn(max = 185.dp)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/Files.kt",
        "utf8",
      ).includes("var quality = 90") &&
      chat.includes("Column {") &&
      chat.includes("selected.clear()") &&
      !chat.includes("padding(end = if (mine) 46.dp else 30.dp)"),
  );
  check(
    "r25: in-chat search renders nothing before the first hit; scroll position saved across navigation",
    chat.includes("if (hits.isNotEmpty()) Column(") && chat.includes("LazyListState.Saver"),
  );
  check(
    "r25: chat avatars smaller everywhere (header 36, list 44, profile 64, calls 40, status 48)",
    chat.includes("KpAvatar(title, avatarUrl, 36.dp") &&
      chatlist.includes("KpAvatar(name, avatarUrl, 44.dp"),
  );
  check(
    "r26: opening refresh NEVER force-scrolls (the still-broken auto-jump root cause)",
    !chat.includes("refreshMessages(forceScroll = true, markRead = true)") &&
      chat.includes("refreshMessages(markRead = true)"),
  );
  check(
    "r26: friend-profile search opens INSTANTLY via the conv cache (no network wait)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
      "utf8",
    ).includes("ScreenStore.convIdForUser[userId]"),
  );
  check(
    "r26: chat-list rows wear the status ring (dark blue unseen / gray seen)",
    chatlist.includes("StatusRingAvatar(") &&
      chatlist.includes('it.optJSONObject("user")?.optString("id") == other?.optString("id")'),
  );
  check(
    "r26: phone input border themed; profile avatar big again; no plays-for text; compact call chip",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
      "utf8",
    ).includes("unfocusedBorderColor = Muted") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
        "utf8",
      ).includes("88.dp, // Owner round 26") &&
      !settings.includes("plays for messages") &&
      // r31-13: the call chip is ONE line now (icon · "Voice call · 2:31" · time).
      chat.includes('if (sub.isBlank()) title else "$title · $sub",') &&
      !chat.includes(".widthIn(max = 205.dp)"),
  );
  check(
    "r26: voice sending line clear of the stamp; no in-bar clear cross in chat search",
    chat.includes("modifier = Modifier.padding(end = if (mine) 50.dp else 34.dp),") &&
      !chat.includes('"Clear"'),
  );
  check(
    "r26/r30: status reactions burst up (Animatable, repeatable, nothing selected); the original stays and pulses",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
      "utf8",
    ).includes("flight.animateTo") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes("pulse.animateTo(1.45f") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes("reactHaptics.tap()") &&
      !readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
        "utf8",
      ).includes('mutableStateOf(s.optString("myReaction"))'),
  );
  check(
    "r24: phone change uses the login country picker (flag chip + searchable sheet + buildE164)",
    settings.includes("CountryPickerSheet(") &&
      settings.includes("PhoneField(") &&
      settings.includes("buildE164(country, value)") &&
      !settings.includes('Text("New number (e.g. +8801712345678)")'),
  );

  /* ---------------- round 27 (self-audit fixes) ---------------- */
  const statusKt = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
    "utf8",
  );
  check(
    "r27: a PAUSED status clip is not 'finished' — bar holds instead of jumping to 100% and skipping",
    statusKt.includes("} else if (dur > 0 && cur >= dur - 500) {") &&
      !statusKt.includes("} else if (dur > 0 && cur > 0) {"),
  );
  check(
    "r27: status viewer clock + clip PAUSE while the app is in the background",
    statusKt.includes(
      "if (showViewers || menuOpen || replyFocused || !Store.foreground || holding) {",
    ) &&
      statusKt.includes("player?.setPaused(paused || !Store.foreground)") &&
      statusKt.includes("p?.setPaused(paused || bg)"),
  );
  check(
    "r28-1: status ⋮ menu is a theme bottom sheet (no M3 DropdownMenu) + confirm dialog on the Card surface + clock pauses under the sheet",
    !statusKt.includes("DropdownMenu(") &&
      !statusKt.includes("import androidx.compose.material3.DropdownMenu") &&
      statusKt.includes("private fun StatusMenuSheet(") &&
      statusKt.includes(
        "containerColor = Card,\n        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true)",
      ) &&
      statusKt.includes("paused = showViewers || menuOpen || replyFocused || holding,") &&
      // r31-7: the confirm is a bottom sheet too (KpConfirmSheet on the Card surface).
      /KpConfirmSheet\(\n\s+title = "Delete status\?",/.test(statusKt),
  );
  check(
    "r28-2: the session bearer goes to the worker host ONLY (GitHub 401'd the update check) + conditional release check",
    readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Api.kt", "utf8").includes(
      "if (t.isNullOrBlank() || !isOwnHost(chain.request().url.host)) chain.request()",
    ) &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpUpdate.kt",
        "utf8",
      ).includes('.removeHeader("Authorization")') &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpUpdate.kt",
        "utf8",
      ).includes('header("If-None-Match", etag)'),
  );
  check(
    "r28-3: the in-chat receive tone plays only for a NEW bubble from someone else (own-send echo was ringing it)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
      "utf8",
    ).includes("if (fromOther && fresh) runCatching { KpSounds.receive(ctx) }") &&
      (
        readFileSync(
          "native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
          "utf8",
        ).match(/KpSounds\.receive\(/g) || []
      ).length === 1,
  );
  check(
    "r27: status composer uploads with the real mime + a proper name (readDocument = (mime, bytes))",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusPhotoScreen.kt",
      "utf8",
    ).includes('Api.upload("status.mp4", mime.ifBlank { "video/mp4" }, bytes)'),
  );
  check(
    "r27: status clip cache is READ (no re-download per view) + streamed to disk + 24h prune",
    statusKt.includes("if (!(f.exists() && f.length() > 0L)) {") &&
      statusKt.includes("Api.downloadToFile(url, tmp)") &&
      !statusKt.includes("val bytes = Api.download(url)"),
  );
}

// ---- round 27: a block hides statuses BOTH ways, and /view /react /media honour it ----
{
  const k = await mk();
  const a = await k.reg("blk-a@x.com", "blka");
  const b = await k.reg("blk-b@x.com", "blkb");
  await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const sa = await k.call("POST", "/api/statuses", { kind: "TEXT", text: "a" }, a.token);
  const sb = await k.call(
    "POST",
    "/api/statuses",
    {
      kind: "IMAGE",
      imageData: `data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`,
    },
    b.token,
  );
  const before = await k.call("GET", "/api/statuses", undefined, b.token);
  check(
    "r27: before the block B sees A's status (contacts)",
    (before.json.items || []).some((g) => g.user?.id === a.user.id),
  );
  const blk = await k.call("POST", "/api/blocks", { userId: b.user.id }, a.token);
  check("r27: A blocks B", blk.status === 200, `${blk.status}`);
  const feedB = await k.call("GET", "/api/statuses", undefined, b.token);
  const feedA = await k.call("GET", "/api/statuses", undefined, a.token);
  check(
    "r27: blocked B no longer sees A's status in the feed",
    !(feedB.json.items || []).some((g) => g.user?.id === a.user.id),
  );
  check(
    "r27: blocker A no longer sees B's status either",
    !(feedA.json.items || []).some((g) => g.user?.id === b.user.id),
  );
  const react = await k.call(
    "POST",
    `/api/statuses/${sa.json.status.id}/react`,
    { emoji: "😂" },
    b.token,
  );
  check("r27: blocked B cannot react to A's status", react.status === 403, `${react.status}`);
  const view = await k.call("POST", `/api/statuses/${sa.json.status.id}/view`, undefined, b.token);
  const viewers = await k.call(
    "GET",
    `/api/statuses/${sa.json.status.id}/viewers`,
    undefined,
    a.token,
  );
  check(
    "r27: blocked B's /view ping is swallowed (200, no row in A's viewer list)",
    view.status === 200 && (viewers.json.viewers || []).length === 0,
    `${view.status} viewers=${(viewers.json.viewers || []).length}`,
  );
  const media = await k.call("GET", `/api/statuses/${sb.json.status.id}/media`, undefined, a.token);
  check("r27: status media route refuses across a block", media.status === 403, `${media.status}`);
  await k.call(
    "DELETE",
    `/api/blocks/${b.user.id}`,
    a.token === undefined ? undefined : undefined,
    a.token,
  );
  const after = await k.call("GET", "/api/statuses", undefined, b.token);
  check(
    "r27: unblock restores the status feed",
    (after.json.items || []).some((g) => g.user?.id === a.user.id),
  );
}

// ---- round 27: an unsent message takes its unread count and its preview with it ----
{
  const k = await mk();
  const a = await k.reg("uns-a@x.com", "unsa");
  const b = await k.reg("uns-b@x.com", "unsb");
  const cid = (await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
    .conversation.id;
  const listB = async () =>
    (await k.call("GET", "/api/conversations", undefined, b.token)).json.items.find(
      (c) => c.id === cid,
    );
  const m1 = await k.call("POST", `/api/conversations/${cid}/messages`, { body: "first" }, a.token);
  const m2 = await k.call("POST", `/api/conversations/${cid}/messages`, { body: "oops" }, a.token);
  let row = await listB();
  check(
    "r27: two sends = badge 2, preview is the newest",
    row.unread === 2 && row.lastMessage === "oops",
  );
  await k.call("DELETE", `/api/messages/${m2.json.message.id}`, undefined, a.token);
  row = await listB();
  check(
    "r27: unsend the newest -> badge 1, preview falls back to the previous message (no 'Message deleted')",
    row.unread === 1 &&
      row.lastMessage === "first" &&
      row.lastMessageAt === m1.json.message.createdAt,
    `unread=${row.unread} preview=${JSON.stringify(row.lastMessage)}`,
  );
  await k.call("DELETE", `/api/messages/${m1.json.message.id}`, undefined, a.token);
  row = await listB();
  check(
    "r27: unsend the last one too -> badge 0, preview empty",
    row.unread === 0 && !row.lastMessage,
    `unread=${row.unread} preview=${JSON.stringify(row.lastMessage)}`,
  );
  // Already-read messages must not be double-counted: B reads, A unsends.
  const m3 = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "read me" },
    a.token,
  );
  await k.call("POST", `/api/conversations/${cid}/read`, {}, b.token);
  const m4 = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "unread" },
    a.token,
  );
  await k.call("DELETE", `/api/messages/${m3.json.message.id}`, undefined, a.token);
  row = await listB();
  check(
    "r27: unsending an already-READ message leaves the badge alone (still 1 for the unread one)",
    row.unread === 1 && row.lastMessage === "unread",
    `unread=${row.unread} preview=${JSON.stringify(row.lastMessage)} m4=${m4.status}`,
  );

  // The server refuses to hang anything on a vanished row (the app already hides it).
  const gone = await k.call(`POST`, `/api/conversations/${cid}/messages`, { body: "bye" }, a.token);
  const goneId = gone.json.message.id;
  await k.call("DELETE", `/api/messages/${goneId}`, undefined, a.token);
  const react = await k.call("POST", `/api/messages/${goneId}/react`, { emoji: "❤️" }, b.token);
  check(
    "r27: reacting to an unsent message is refused (404)",
    react.status === 404,
    `${react.status}`,
  );
  const reply = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { body: "re", replyTo: goneId },
    b.token,
  );
  check(
    "r27: a reply quoting an unsent message still sends, but the dead quote is dropped",
    reply.status === 201 && !reply.json.message.replyTo,
    `${reply.status} replyTo=${JSON.stringify(reply.json.message?.replyTo)}`,
  );

  // Typing dots across a block: swallowed, never shown to the blocker.
  const typ0 = await k.call("POST", `/api/conversations/${cid}/typing`, {}, b.token);
  const pageBefore = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, a.token);
  check(
    "r27: (control) B's typing ping reaches A while not blocked",
    typ0.status === 200 && !!pageBefore.json.typingAt,
    `typingAt=${JSON.stringify(pageBefore.json.typingAt)}`,
  );
  await k.call("POST", "/api/blocks", { userId: b.user.id }, a.token);
  // clear the earlier ping so the check below sees only what happens after the block
  k.db._db.prepare("DELETE FROM typing WHERE conv_id = ?").run(cid);
  const typ1 = await k.call("POST", `/api/conversations/${cid}/typing`, {}, b.token);
  const pageAfter = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, a.token);
  check(
    "r27: after A blocks B, B's typing ping is swallowed (200) and A sees no typingAt",
    typ1.status === 200 && !pageAfter.json.typingAt,
    `typingAt=${JSON.stringify(pageAfter.json.typingAt)}`,
  );
  const typ2 = await k.call("POST", `/api/conversations/${cid}/typing`, {}, a.token);
  const pageB = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
  check(
    "r27: the blocker's own typing is not shown to the blocked side either",
    typ2.status === 200 && !pageB.json.typingAt,
    `typingAt=${JSON.stringify(pageB.json.typingAt)}`,
  );
}

// ---- round 27: status reactions are emoji-only; viewer list is one query, not N+1 ----
{
  const k = await mk();
  const a = await k.reg("emo-a@x.com", "emoa");
  const b = await k.reg("emo-b@x.com", "emob");
  await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const st = await k.call("POST", "/api/statuses", { kind: "TEXT", text: "hi" }, a.token);
  const sid = st.json.status.id;
  const bad = [];
  for (const e of ["<script>alert(1)", "abc", "1", ":)", "👍 x"]) {
    const r = await k.call("POST", `/api/statuses/${sid}/react`, { emoji: e }, b.token);
    if (r.status !== 400) bad.push(`${JSON.stringify(e)}->${r.status}`);
  }
  check("r27: non-emoji status reactions are refused (400)", bad.length === 0, bad.join(" "));
  const good = [];
  for (const e of ["❤️", "😂", "😮", "😢", "🙏", "🔥", "👍", "👍🏽", "🇧🇩"]) {
    const r = await k.call("POST", `/api/statuses/${sid}/react`, { emoji: e }, b.token);
    if (r.status !== 200) good.push(`${JSON.stringify(e)}->${r.status}`);
  }
  check(
    "r27: every emoji the reaction bar sends (plus skin tone / flag) is accepted",
    good.length === 0,
    good.join(" "),
  );
  const viewers = await k.call(`GET`, `/api/statuses/${sid}/viewers`, undefined, a.token);
  check(
    "r27: the stored reaction is the last emoji, verbatim",
    viewers.json.viewers?.[0]?.reaction === "🇧🇩",
    JSON.stringify(viewers.json.viewers?.[0]?.reaction),
  );
  // N+1: 12 viewers must not mean 12 user SELECTs
  for (let i = 0; i < 12; i++) {
    const v = await k.reg(`emo-v${i}@x.com`, `emov${i}`);
    await k.call("POST", "/api/conversations", { userId: v.user.id }, a.token);
    await k.call("POST", `/api/statuses/${sid}/view`, undefined, v.token);
  }
  let statements = 0;
  const origPrepare = k.db.prepare.bind(k.db);
  k.db.prepare = (sql) => {
    statements++;
    return origPrepare(sql);
  };
  const sheet = await k.call("GET", `/api/statuses/${sid}/viewers`, undefined, a.token);
  k.db.prepare = origPrepare;
  check(
    "r27: viewer sheet for 13 viewers costs a handful of statements, not 1+N",
    sheet.json.viewers?.length === 13 && statements <= 6,
    `viewers=${sheet.json.viewers?.length} statements=${statements}`,
  );
}

// ---- round 27: R2 garbage collection — unsend / status delete / 24h expiry free the object ----
{
  const worker = await freshWorker();
  const db = makeD1();
  const r2 = makeR2();
  const env = { DB: db, MEDIA: r2, GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token, raw) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.10.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    let init = { method, headers };
    if (raw) {
      init = {
        method,
        headers: { ...raw.headers, authorization: `Bearer ${token}` },
        body: raw.body,
      };
    } else if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = {};
    }
    return { status: res.status, json: j };
  };
  const reg = makeReg(call);
  const a = await reg("gc-a@x.com", "gca");
  const b = await reg("gc-b@x.com", "gcb");
  const c = await reg("gc-c@x.com", "gcc");
  const cab = (await call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
    .conversation.id;
  const cac = (await call("POST", "/api/conversations", { userId: c.user.id }, a.token)).json
    .conversation.id;
  const upload = async (name, type) =>
    (
      await call("POST", `/api/files?name=${name}&type=${type}`, undefined, a.token, {
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from(`bytes-of-${name}`),
      })
    ).json.fileKey;
  const inBucket = async (key) => !!(await r2.get(key));

  // 1. unsend frees the object
  const k1 = await upload("one.jpg", "image/jpeg");
  const m1 = await call(
    "POST",
    `/api/conversations/${cab}/messages`,
    { fileKey: k1, kind: "FILE" },
    a.token,
  );
  await call("DELETE", `/api/messages/${m1.json.message.id}`, undefined, a.token);
  check("r27-gc: unsending a file message deletes its R2 object", !(await inBucket(k1)));

  // 2. a key still referenced elsewhere (same upload sent to two chats) SURVIVES the first unsend
  const k2 = await upload("two.jpg", "image/jpeg");
  const m2a = await call(
    "POST",
    `/api/conversations/${cab}/messages`,
    { fileKey: k2, kind: "FILE" },
    a.token,
  );
  await call("POST", `/api/conversations/${cac}/messages`, { fileKey: k2, kind: "FILE" }, a.token);
  await call("DELETE", `/api/messages/${m2a.json.message.id}`, undefined, a.token);
  check("r27-gc: an object still referenced by another message is NOT deleted", await inBucket(k2));

  // 3. status delete frees the object + its view rows
  const k3 = await upload("st.mp4", "video/mp4");
  const st = await call(
    "POST",
    "/api/statuses",
    { kind: "VIDEO", fileKey: k3, seconds: 9 },
    a.token,
  );
  await call("POST", `/api/statuses/${st.json.status.id}/view`, undefined, b.token);
  await call("DELETE", `/api/statuses/${st.json.status.id}`, undefined, a.token);
  const views = db._db
    .prepare("SELECT COUNT(*) AS n FROM status_views WHERE status_id = ?")
    .get(st.json.status.id);
  check(
    "r27-gc: deleting a video status deletes its R2 object and its view rows",
    !(await inBucket(k3)) && views.n === 0,
    `inBucket=${await inBucket(k3)} views=${views.n}`,
  );

  // 4. the 24h expiry sweep frees objects too (age the row, force the once-a-minute gate)
  const k4 = await upload("old.mp4", "video/mp4");
  const old = await call(
    "POST",
    "/api/statuses",
    { kind: "VIDEO", fileKey: k4, seconds: 5 },
    a.token,
  );
  db._db
    .prepare("UPDATE statuses SET expires_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), old.json.status.id);
  // the sweep gate is module state; a fresh worker import starts with it open
  await call("GET", "/api/statuses", undefined, b.token);
  await ctx.drain();
  const rowLeft = db._db
    .prepare("SELECT 1 AS x FROM statuses WHERE id = ?")
    .get(old.json.status.id);
  check(
    "r27-gc: an expired status is swept together with its R2 object",
    !rowLeft && !(await inBucket(k4)),
    `row=${!!rowLeft} inBucket=${await inBucket(k4)}`,
  );
}

// ── r28-4: sign-out really ends the account on that phone ─────────────────────
// Owner: "logout korleo message notification ashe" + "onno device login korte
// gele approval chai". Three server rules, each locked here:
//  (a) logout may name the push token → that push row dies even WITHOUT a
//      session (the app signs out locally after any 401; the bearer is gone by
//      the time it can tell the server, the device row was not);
//  (b) an ACTIVE auth_device whose install holds no live session is a signed-out
//      phone: the next login on ANY device is a plain SESSION, no approval;
//  (c) a device that still holds a session keeps its approval gate.
{
  const k = await mk();
  const a = await k.reg("so@x.com", "so");
  const devA = `dev-so`; // makeReg's deviceId for username "so"
  await k.call("POST", "/api/devices", { token: "fcm-so-1", deviceId: devA }, a.token);
  await k.call("POST", "/api/devices", { token: "fcm-so-2", deviceId: "dev-so-tablet" }, a.token);
  // (a) no bearer at all, just the token
  const lo = await k.call("POST", "/api/auth/logout", { pushToken: "fcm-so-1" });
  const left = k.db._db
    .prepare("SELECT token FROM devices WHERE user_id = ? ORDER BY token")
    .all(a.user.id)
    .map((r) => r.token);
  check(
    "r28-4a: logout by pushToken without a session deletes exactly that push row",
    lo.status === 200 && left.length === 1 && left[0] === "fcm-so-2",
    JSON.stringify(left),
  );
  // (c) session still alive on devA → another install still needs approval
  const gate = await k.call("POST", "/api/auth/verify-phone", {
    phone: a.user.phone,
    sim: "MATCH",
    deviceId: "dev-so-new",
    deviceName: "Other phone",
  });
  check(
    "r28-4c: a device that still holds a session keeps the approval gate",
    gate.json.status === "APPROVAL_REQUIRED",
    gate.json.status,
  );
  await k.call("POST", "/api/auth/login/cancel", {
    requestId: gate.json.requestId,
    deviceId: "dev-so-new",
  });
  // (b) the session dies without the logout request reaching the worker
  // (killed mid-request / offline / data cleared) → the ACTIVE row is stale
  k.db._db.prepare("DELETE FROM sessions WHERE user_id = ?").run(a.user.id);
  const active = k.db._db
    .prepare("SELECT status FROM auth_devices WHERE user_id = ? AND device_id = ?")
    .get(a.user.id, devA);
  const plain = await k.call("POST", "/api/auth/verify-phone", {
    phone: a.user.phone,
    sim: "MATCH",
    deviceId: "dev-so-new",
    deviceName: "Other phone",
  });
  check(
    "r28-4b: a signed-out install (ACTIVE row, no live session) no longer demands an approval",
    active?.status === "ACTIVE" && plain.json.status === "SESSION" && !!plain.json.token,
    `row=${active?.status} status=${plain.json.status}`,
  );
  const audit = k.db._db
    .prepare("SELECT event FROM auth_audit WHERE user_id = ? ORDER BY created_at DESC")
    .all(a.user.id)
    .map((r) => r.event);
  check("r28-4: the new login is audited as LOGIN", audit.includes("LOGIN"), JSON.stringify(audit));
  // app side: one teardown for every sign-out path
  const store = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Store.kt",
    "utf8",
  );
  const api = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Api.kt",
    "utf8",
  );
  check(
    "r28-4: app sign-out closes the sockets, releases push (token + FCM), clears the account, and the 401 path runs it too",
    store.includes("fun signOut(ctx: Context, revokedRemotely: Boolean = false)") &&
      store.includes("KpSocket.closeAll()") &&
      store.includes("KpPush.unregister()") &&
      store.includes("ScreenStore.clearAccount()") &&
      store.includes('JSONObject().put("pushToken", pushToken)') &&
      api.includes("Store.signOut(it, revokedRemotely = true)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
        "utf8",
      ).includes('.put("pushToken", KpPush.registeredToken(ctx) ?: "")') &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
        "utf8",
      ).includes("KpSocket.joinUser()"),
  );
}

// ── r28-5/6: home ⋮ menu + contacts ─────────────────────────────────────────
{
  const list = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
    "utf8",
  );
  const kpapp = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt",
    "utf8",
  );
  check(
    "r28-5/r31: the settings cog is gone; the home ⋮ menu is exactly My Profile, New contact, All contacts, New group, Settings, About Us — in that order, each a real route",
    !list.includes('Icon(Icons.Filled.Settings, "Settings"') &&
      (() => {
        const order = [
          "My Profile",
          "New contact",
          "All contacts",
          "New group",
          "Settings",
          "About Us",
        ];
        const idx = order.map((l) => list.indexOf(`"${l}")`));
        return idx.every((i, n) => i > 0 && (n === 0 || i > idx[n - 1]));
      })() &&
      (list.match(/HomeMenuItem\(Icons/g) || []).length === 6 &&
      list.includes('nav.navigate("profile/${Store.myId()}")') &&
      ["about", "contacts", "newgroup", "settings"].every((r) =>
        kpapp.includes(`composable("${r}")`),
      ) &&
      // r30-1: the new-contact route takes optional prefill args (name, phone).
      kpapp.includes('"newcontact?name={name}&phone={phone}"') &&
      list.includes(
        "containerColor = Card,\n                        shape = RoundedCornerShape(16.dp)",
      ),
  );
  const profile = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
    "utf8",
  );
  check(
    "r28-5/r31: my own profile edits IN PLACE (photo tap + Name/Username/About/Phone rows) instead of call/search/block — no intermediate edit screen",
    profile.includes("val isMe = userId.isNotBlank() && userId == Store.myId()") &&
      profile.includes(
        'if (!isMe && !isKpBot(userId) && u.optText("username") != "rabbihossainltd")',
      ) &&
      !profile.includes('Text("Edit profile"') &&
      !profile.includes('"myprofile"') &&
      !kpapp.includes('composable("myprofile")') &&
      ["editfield/name", "editfield/username", "editfield/about", "editfield/phone"].every((r) =>
        profile.includes(`nav.navigate("${r}")`),
      ) &&
      profile.includes("PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)"),
  );
  check(
    "r28-5: About Us is a real screen (build, founder, links, update check)",
    existsSync("native-android/app/src/main/java/app/kuchupuchu/android/AboutScreen.kt") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/AboutScreen.kt",
        "utf8",
      ).includes("KpUpdate.check(ctx)"),
  );
  const manifest = readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8");
  const contacts = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/PhoneBook.kt",
    "utf8",
  );
  const screens = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ContactsScreens.kt",
    "utf8",
  );
  check(
    "r28-6: READ_CONTACTS declared, asked in-context (not at launch); All contacts = KP users → Chat, others → Invite; search merges phone-book KP users",
    manifest.includes("android.permission.READ_CONTACTS") &&
      !kpapp.includes("READ_CONTACTS") &&
      screens.includes("launcher.launch(Manifest.permission.READ_CONTACTS)") &&
      screens.includes('ContactAction("Chat", primary = true)') &&
      screens.includes('ContactAction("Invite", primary = false)') &&
      contacts.includes('Api.post("/api/contacts/match"') &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/SearchScreen.kt",
        "utf8",
      ).includes("val bookHits = PhoneBook.search(query)") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/Store.kt",
        "utf8",
      ).includes("PhoneBook.clear()"),
  );
  // server: /api/contacts/match answers only ACTIVE accounts, never self, never across a block, stores nothing
  const k = await mk();
  const a = await k.reg("cm-a@x.com", "cma");
  const b = await k.reg("cm-b@x.com", "cmb");
  const c = await k.reg("cm-c@x.com", "cmc");
  await k.call("POST", "/api/blocks", { userId: c.user.id }, a.token);
  const junk = "+15550000001";
  const m = await k.call(
    "POST",
    "/api/contacts/match",
    { phones: [a.user.phone, b.user.phone, c.user.phone, junk, "017", "", null] },
    a.token,
  );
  const ids = (m.json.users || []).map((u) => u.id);
  check(
    "r28-6: contacts/match → the KP users among the numbers (not me, not blocked, junk ignored) with their phone",
    m.status === 200 &&
      ids.length === 1 &&
      ids[0] === b.user.id &&
      m.json.users[0].phone === b.user.phone &&
      m.json.users[0].avatarUrl === null,
    JSON.stringify(m.json).slice(0, 200),
  );
  const tables = k.db._db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%contact%'")
    .all();
  check("r28-6: the server keeps NO contacts table (match-and-forget)", tables.length === 0);
  const unauth = await k.call("POST", "/api/contacts/match", { phones: [b.user.phone] });
  check("r28-6: contacts/match needs a session", unauth.status === 401, String(unauth.status));
}

// ── r30: owner list ──────────────────────────────────────────────────────────
{
  const chat = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
    "utf8",
  );
  const kpapp = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt",
    "utf8",
  );
  check(
    "r30-1: chat ⋮ says View contact only for a phone-book person, else Add contact (prefilled)",
    chat.includes('if (inBook) "View contact" else "Add contact"') &&
      chat.includes('PhoneBook.entries.any { it.user?.optString("id") == otherId }') &&
      chat.includes('nav.navigate("newcontact?name=$n&phone=$p")') &&
      kpapp.includes('"newcontact?name={name}&phone={phone}"'),
  );
  const calls = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt",
    "utf8",
  );
  check(
    "r30-3 → r31-25: rising-chevron swipe hint above BOTH incoming circles (Accept and Decline; motion, no label); the drag path is untouched",
    calls.includes("private fun SwipeUpChevrons(visible: Boolean)") &&
      calls.includes("if (hint) SwipeUpChevrons(visible = dragUpPx == 0f)") &&
      (calls.match(/hint = true,/g) || []).length === 2 &&
      calls.includes("Icons.Filled.KeyboardArrowUp") &&
      !calls.includes("Swipe up"),
  );
  {
    const inc = calls.slice(
      calls.indexOf("fun IncomingCallScreen(call: CallUi) {"),
      calls.indexOf("fun SwipeCallCircle("),
    );
    const declineIdx = inc.indexOf("SwipeCallCircle(\n                    Red,");
    const acceptIdx = inc.indexOf("SwipeCallCircle(\n                    Green,");
    check(
      "r31-25: Decline and Accept sit at the far edges — SpaceBetween inside a 56dp margin (one screen for voice AND video rings); Decline LEFT with its own chevrons, Accept RIGHT",
      inc.includes("Modifier.fillMaxWidth().padding(horizontal = 56.dp)") &&
        inc.includes("horizontalArrangement = Arrangement.SpaceBetween") &&
        !inc.includes("padding(horizontal = 48.dp)") &&
        declineIdx > 0 &&
        acceptIdx > declineIdx &&
        inc.slice(declineIdx, acceptIdx).includes("hint = true,") &&
        inc.slice(acceptIdx).includes("hint = true,"),
    );
  }
  const ui = readFileSync("native-android/app/src/main/java/app/kuchupuchu/android/Ui.kt", "utf8");
  const kt = (f) =>
    readFileSync(`native-android/app/src/main/java/app/kuchupuchu/android/${f}`, "utf8");
  check(
    "r30-5: one shared CompactSearchBar (24dp pill, 10dp vertical padding) on New chat / New group / Search / Contacts; short placeholders everywhere",
    ui.includes("fun CompactSearchBar(") &&
      ui.includes("modifier = Modifier.weight(1f).padding(vertical = 10.dp)") &&
      ["NewChatScreen.kt", "CreateGroupScreen.kt", "SearchScreen.kt", "ContactsScreens.kt"].every(
        (f) => kt(f).includes("CompactSearchBar("),
      ) &&
      !kt("NewChatScreen.kt").includes("OutlinedTextField(") &&
      !kt("SearchScreen.kt").includes("OutlinedTextField(") &&
      !kt("CreateGroupScreen.kt").includes("OutlinedTextField(") &&
      kt("CreateGroupScreen.kt").includes('placeholder = "Search"') &&
      !kt("CreateGroupScreen.kt").includes("Add members — search by name or username") &&
      !kt("SearchScreen.kt").includes("Search people, chats, messages") &&
      !kt("NewChatScreen.kt").includes('"Name or username"') &&
      kt("StatusPhotoScreen.kt").includes('label = { Text("Caption") }'),
  );
  // r31-5: real groups — group profile screen, admin = creator, add/kick/rename/picture,
  // the create screen lists chat-list peers immediately, group avatar cache token "g:".
  {
    const groupInfo = kt("GroupInfoScreen.kt");
    const worker = readFileSync("src/worker/index.ts", "utf8");
    check(
      "r31-5: group profile = GroupInfoScreen (route group/{id}) opened from the group chat header; members, Admin badge, add/remove/rename/picture (admin), leave",
      kpapp.includes('composable("group/{id}")') &&
        kt("ChatScreen.kt").includes('if (isGroup) nav.navigate("group/$convId")') &&
        groupInfo.includes("val isAdmin = ownerId.isNotBlank() && ownerId == myId") &&
        [
          '"Add members"',
          '"Remove from group"',
          '"Leave group"',
          '"Group name"',
          '"Admin"',
          '"View profile"',
        ].every((l) => groupInfo.includes(l)) &&
        groupInfo.includes('Api.post("/api/conversations/$convId/members"') &&
        groupInfo.includes(
          'Api.delete("/api/conversations/$convId/members/${u.optString("id")}")',
        ) &&
        groupInfo.includes('Api.delete("/api/conversations/$convId/members/$myId")') &&
        groupInfo.includes('patch(JSONObject().put("title", draft.trim()))') &&
        groupInfo.includes('patch(JSONObject().put("avatarUrl", dataUrl))') &&
        !groupInfo.includes("AlertDialog(") &&
        groupInfo.includes("KpConfirmSheet(") &&
        groupInfo.includes("KpSheet("),
    );
    check(
      "r31-5: New group lists everyone from the chat list at once (search filters + extends); Create button is one word",
      kt("CreateGroupScreen.kt").includes("ScreenStore.convs") &&
        kt("CreateGroupScreen.kt").includes("found.addAll(known)") &&
        kt("CreateGroupScreen.kt").includes('if (busy) "Creating…" else "Create"'),
    );
    check(
      "r31-5 worker: PATCH /api/conversations/:id takes title + avatarUrl (group, owner only); GET /api/conversations/:id/avatar; detail carries avatarRef g:<id>@vN + myRole; admin leaving hands the group to the oldest member",
      worker.includes("ALTER TABLE conversations ADD COLUMN avatar_url TEXT") &&
        worker.includes("body.title !== undefined ||\n      body.avatarUrl !== undefined") &&
        worker.includes("/^\\/api\\/conversations\\/([^/]+)\\/avatar$/") &&
        worker.includes("`g:${conv.id}@v${conv.avatar_version ?? 0}`") &&
        worker.includes("myRole:") &&
        worker.includes("UPDATE members SET role = 'owner' WHERE conv_id = ? AND user_id = ?") &&
        kt("Ui.kt").includes('if (ownerId.startsWith("g:"))') &&
        kt("ChatListScreen.kt").includes('if (isGroup) conv.optIso("avatarRef")'),
    );
  }
  // r31-7/10: no AlertDialog anywhere in the app — every popup is a KpSheet /
  // KpConfirmSheet; the update flow is one sheet (offer → blue progress → Install).
  {
    const dir = "native-android/app/src/main/java/app/kuchupuchu/android/";
    const withAlert = readdirSync(dir)
      .filter((f) => f.endsWith(".kt"))
      .filter((f) => readFileSync(dir + f, "utf8").includes("AlertDialog("));
    check(
      "r31-7: zero AlertDialog( call sites in the Android sources; the sheet kit lives in Ui.kt",
      withAlert.length === 0 &&
        ui.includes("fun KpSheet(") &&
        ui.includes("fun KpSheetRow(") &&
        ui.includes("fun KpConfirmSheet(") &&
        ui.includes(
          "containerColor = Card,\n        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true)",
        ),
      JSON.stringify(withAlert),
    );
    const update = kt("KpUpdate.kt");
    check(
      "r31-10: update = KpSheet with ActionBlue progress (no Gold bar) and an explicit Install step (ready APK kept, installReady on tap)",
      kpapp.includes("fun KpUpdateGate()") &&
        kpapp.includes("KpSheet(") &&
        kpapp.includes(
          "color = ActionBlue,\n                        trackColor = ActionBlue.copy(alpha = 0.18f)",
        ) &&
        !kpapp.includes("color = Gold,") &&
        kpapp.includes(
          'GoldBtn("Install", Modifier.fillMaxWidth()) { scope.launch { KpUpdate.installReady(ctx) } }',
        ) &&
        update.includes("var ready by mutableStateOf<File?>(null)") &&
        update.includes("ready = apk") &&
        update.includes("suspend fun installReady(ctx: Context)") &&
        !update.includes(
          "withContext(Dispatchers.IO) { install(ctx, apk) }\n            available = null",
        ),
    );
    check(
      "r31-7: chat popups are sheets — edit message, disappearing timer, chat theme, text-file viewer; crash report + status delete too",
      (() => {
        const chat = kt("ChatScreen.kt");
        return (
          chat.includes('KpSheet(onDismiss = onClose, title = "Edit message")') &&
          chat.includes('KpSheet(onDismiss = onClose, title = "Disappearing messages")') &&
          chat.includes('KpSheet(onDismiss = onClose, title = "Chat theme")') &&
          chat.includes("KpSheet(onDismiss = { textDoc = null }, title = fileName)") &&
          kt("KpCrash.kt").includes('title = "Last crash report"') &&
          kt("StatusScreens.kt").includes('title = "Delete status?"')
        );
      })(),
    );
  }
  // r31-9: a Public (or contacts-visible) number is RENDERED on the other person's
  // profile — the worker already sent it (r30-2 above); the screen never showed it.
  check(
    "r31-9: ProfileScreen renders the peer's phone from the server answer (tap = dialer), only when the server allowed it",
    kt("ProfileScreen.kt").includes('val peerPhone = if (isMe) "" else u.optText("phone")') &&
      kt("ProfileScreen.kt").includes("if (peerPhone.isNotBlank()) {") &&
      kt("ProfileScreen.kt").includes('android.net.Uri.parse("tel:$peerPhone")'),
  );
  // r31-11: the in-chat theme reaches the call bubble, the reply bar and the
  // profile's call/search buttons.
  check(
    "r31-11: CallLogBubble uses chatMineFill/chatOtherFill/chatAccent(theme); ReplyQuoteBar stripe = chatAccent(theme); profile call/search icons = the peer chat's accent",
    kt("ChatScreen.kt").includes(
      "private fun CallLogBubble(m: JSONObject, mine: Boolean, pendingEcho: Boolean, theme: String)",
    ) &&
      kt("ChatScreen.kt").includes(
        ".background(if (mine) chatMineFill(theme) else chatOtherFill(theme))",
      ) &&
      kt("ChatScreen.kt").includes(
        "tint = if (missed) Red else if (mine) Color.White else chatAccent(theme)",
      ) &&
      kt("ChatScreen.kt").includes(
        "private fun ReplyQuoteBar(replyTo: JSONObject?, theme: String, onCancel: () -> Unit)",
      ) &&
      kt("ChatScreen.kt").includes(".background(chatAccent(theme)),") &&
      kt("ChatScreen.kt").includes("ReplyQuoteBar(replyTo, chatTheme) { replyTo = null }") &&
      kt("ProfileScreen.kt").includes("val peerAccent = chatAccent(cTheme(peerConv))") &&
      (kt("ProfileScreen.kt").match(/tint = peerAccent/g) || []).length === 3,
  );
  // r31-12: sticker/emoji panel in theme tokens (no fixed brown/gold, no white
  // text on cream); emoji-only texts render big with the stamp underneath.
  check(
    "r31-12: StickerPanel uses Card/Ink/Muted/ActionBlue tokens only; emoji-only (1–3) TEXT bubbles render 44/34sp with the stamp in the bottom band",
    !/0x[0-9A-F]{2}1C1917/.test(kt("StickerSheet.kt")) &&
      !kt("StickerSheet.kt").includes("GoldDeep") &&
      !kt("StickerSheet.kt").includes("color = Color.White") &&
      kt("StickerSheet.kt").includes("if (sel) ActionBlueDeep else Muted") &&
      kt("ChatScreen.kt").includes("internal fun emojiOnlyCount(body: String): Int") &&
      kt("ChatScreen.kt").includes("fontSize = if (emojiOnly == 1) 44.sp else 34.sp") &&
      kt("ChatScreen.kt").includes(
        'Icon(Icons.Filled.Mood, "Stickers", tint = accent, modifier = Modifier.size(20.dp))',
      ),
  );
  {
    check(
      "r31-16: a photo/video/audio picked through Document is SENT and SHOWN as a document (meta.document), opening in the app's own viewer/player or playing inline",
      chat.includes("fun handleDocumentPicked(uri: Uri, asDocument: Boolean = false)") &&
        chat.includes(
          "fun sendFile(name: String, mime: String, bytes: ByteArray, asDocument: Boolean = false)",
        ) &&
        chat.includes(
          'val docMeta = if (asDocument) JSONObject().put("document", true) else null',
        ) &&
        chat.includes(
          "onDocumentPicked = { uri -> handleDocumentPicked(uri, asDocument = true) },",
        ) &&
        chat.includes("internal fun sentAsDocument(m: JSONObject): Boolean") &&
        chat.includes(
          'if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))) {',
        ) &&
        chat.includes('if (kind == "FILE" && fileLooksVideo(m) && !sentAsDocument(m)) {') &&
        chat.includes("if (isImage && !asDocument) {") &&
        chat.includes(
          '"FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo)',
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "...(incomingMeta.document === true ? { document: true } : {}),",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          'String(meta.type || "").startsWith("image/") && meta.document !== true',
        ),
    );

    check(
      "r31-17: the hold-mic gesture always awaits the pointer down first (a disabled mic no longer spins the main thread), and the AI answers voice notes via inline audio",
      chat.includes(
        "val down = awaitFirstDown(requireUnconsumed = false)\n                    if (!enabled) {\n                        down.consume()\n                        return@awaitEachGesture\n                    }",
      ) &&
        !chat.includes("if (!enabled) return@awaitEachGesture") &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "function geminiAudioMime(type: string): string",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes("extraParts: unknown[] = [],") &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "contents: [{ parts: [{ text: prompt }, ...extraParts] }],",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "(await geminiComplete(env, prompt + voicePrompt, 900, voiceParts)) ?? AI_REPLY_FALLBACK",
        ),
    );

    check(
      "r31-18: realtime everywhere — a 'profile' frame busts the user caches and bumps ScreenStore.profileVersion; profile page, chat header and group info re-read on it; the open chat re-reads its detail on a non-message conv frame",
      kt("KpApp.kt").includes('if (ev.optString("type") == "profile") {') &&
        kt("KpApp.kt").includes('Cache.bust("/api/users/$uid")') &&
        kt("KpApp.kt").includes("ScreenStore.pokeProfile()") &&
        kt("ScreenStore.kt").includes("var profileVersion by mutableStateOf(0)") &&
        kt("ProfileScreen.kt").includes("LaunchedEffect(userId, ScreenStore.profileVersion) {") &&
        kt("GroupInfoScreen.kt").includes(
          "LaunchedEffect(convId, ScreenStore.profileVersion, ScreenStore.poke) { reload() }",
        ) &&
        chat.includes("LaunchedEffect(convId, ScreenStore.profileVersion) {") &&
        chat.includes('if (ev.optString("conversationId") == convId && !ev.optBoolean("msg")) {') &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "async function fanOutProfileChange(",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "async function fanOutConversationChange(",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "if (identityChanged) ctx.waitUntil(fanOutProfileChange(env, db, uid));",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "ctx.waitUntil(fanOutConversationChange(env, db, convId));",
        ),
    );

    check(
      "r31-19: audio call — a camera converts the call for BOTH sides through the server row (POST /media, kind→VIDEO); a screen share never converts: the peer's voice UI draws a small preview card under the buttons, tap = fullscreen with system back / Exit fullscreen; stop-share does not re-open a camera that was off",
      kt("CallEngine.kt").includes("var peerScreen by mutableStateOf(false)") &&
        kt("CallEngine.kt").includes("var shareFull by mutableStateOf(false)") &&
        kt("CallEngine.kt").includes(
          "private fun postMedia(camera: Boolean? = null, screen: Boolean? = null) {",
        ) &&
        kt("CallEngine.kt").includes('Api.post("/api/calls/$id/media", body)') &&
        kt("CallEngine.kt").includes(
          "private fun applyPeerMedia(camera: Boolean, screen: Boolean, kind: String) {",
        ) &&
        kt("CallEngine.kt").includes('t == "media" && cid.isNotBlank() && cid == mine -> {') &&
        kt("CallEngine.kt").includes("postMedia(camera = false, screen = true)") &&
        kt("CallEngine.kt").includes("capture(cameraBeforeShare)") &&
        kt("CallEngine.kt").includes("postMedia(camera = track != null, screen = false)") &&
        kt("CallEngine.kt").includes('if (active?.kind != "VIDEO" && !peerScreen) {') &&
        // startShare no longer flips the kind (only toggleCamera / the peer's camera do)
        !kt("CallEngine.kt").includes(
          'localView?.let { runCatching { track.addSink(it) } }\n        active = active?.copy(kind = "VIDEO")',
        ) &&
        kt("CallScreens.kt").includes(
          "connected && engine.shareFull && engine.peerScreen -> ShareFullscreen(call)",
        ) &&
        kt("CallScreens.kt").includes(
          'if (call.kind == "VIDEO") InCallVideoScreen(call) else VoiceCallScreen(call)',
        ) &&
        kt("CallScreens.kt").includes("if (engine.peerScreen) {") &&
        kt("CallScreens.kt").includes(".clickable { engine.openShareFullscreen() },") &&
        kt("CallScreens.kt").includes("private fun ShareFullscreen(call: CallUi) {") &&
        kt("CallScreens.kt").includes(
          "androidx.activity.compose.BackHandler { engine.exitShareFullscreen() }",
        ) &&
        kt("CallScreens.kt").includes('Icon(Icons.Filled.FullscreenExit, "Exit fullscreen"') &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "const mediaMatch = path.match(/^\\/api\\/calls\\/([^/]+)\\/media$/);",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          'const kind = mine.camera === true ? "VIDEO" : row.kind;',
        ),
    );

    check(
      "r31-20: Settings → App 'Share audio via screen share' toggle (default off) — while a screen share is up the phone's playback is captured through the projection (AudioPlaybackCapture, API 29+) and mixed into the mic track via WebRTC's AudioRecordDataCallback, so the other side really hears it",
      kt("SystemAudioTap.kt").includes('private const val PREF = "kp_share_system_audio"') &&
        kt("SystemAudioTap.kt").includes("getBoolean(PREF, false)") &&
        kt("SystemAudioTap.kt").includes("AudioPlaybackCaptureConfiguration.Builder(projection)") &&
        kt("SystemAudioTap.kt").includes(".setAudioPlaybackCaptureConfig(config)") &&
        kt("SystemAudioTap.kt").includes(
          "fun mixInto(audioFormat: Int, channelCount: Int, sampleRate: Int, audioBuffer: ByteBuffer) {",
        ) &&
        kt("KpScreenCapturer.kt").includes("SystemAudioTap.start(app, mp)") &&
        kt("KpScreenCapturer.kt").includes("SystemAudioTap.stop()") &&
        kt("CallEngine.kt").includes(
          "SystemAudioTap.mixInto(audioFormat, channelCount, sampleRate, audioBuffer)",
        ) &&
        kt("SettingsScreen.kt").includes(
          'ToggleRow(Icons.Filled.VolumeUp, "Share audio via screen share", sysAudio) { on ->',
        ) &&
        kt("SettingsScreen.kt").indexOf("fun AppSettingsScreen") <
          kt("SettingsScreen.kt").indexOf('"Share audio via screen share"'),
    );

    check(
      "r31-21: private profile → FLAG_SECURE (ref-counted KpSecure.Guard) on their chat, calls, profile picture, photo viewer and video player; Save / Forward hidden on their pictures and videos (sheet, selection bar, viewer, player)",
      kt("KpSecure.kt").includes("WindowManager.LayoutParams.FLAG_SECURE") &&
        kt("KpSecure.kt").includes("fun Guard(on: Boolean) {") &&
        kt("KpSecure.kt").includes("fun privatePeer(conv: JSONObject?): Boolean =") &&
        chat.includes("val privateChat = KpSecure.privatePeer(c) || KpSecure.selfPrivate()") &&
        chat.includes("KpSecure.Guard(privateChat)") &&
        chat.includes("if (!echo && !privateChat) {") &&
        chat.includes("canSave = !privateChat,") &&
        chat.includes('.put("kpPrivate", privateChat)') &&
        kt("CallScreens.kt").includes(
          "KpSecure.Guard(call.otherPrivate || KpSecure.selfPrivate())",
        ) &&
        kt("CallEngine.kt").includes('otherPrivate = other.optBoolean("privateProfile")') &&
        kt("ProfileScreen.kt").includes("KpSecure.Guard(privatePerson)") &&
        kt("ProfileScreen.kt").includes("canSave = !privatePerson,") &&
        kt("MediaViewer.kt").includes("KpSecure.Guard(secure || !canSave)") &&
        kt("MediaViewer.kt").includes('val privateClip = m?.optBoolean("kpPrivate") == true') &&
        kt("MediaViewer.kt").includes(
          "if (m != null && dest != null && state == 1 && !privateClip) {",
        ) &&
        kt("ChatMediaScreen.kt").includes("KpSecure.Guard(privateChat)") &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "privateProfile: Number(row.private_profile ?? 0) !== 0,\n    ...(viewer",
        ),
    );

    // Owner round 31 item 22: the Reply action already exists on the app's own
    // card — what the owner saw was the OS-drawn payload card, which the worker
    // attaches whenever the user channel reports `sent: 0`. Two causes, both
    // locked here: (a) the Durable Objects kept per-socket liveness in an
    // in-memory Map that hibernation wiped (~10 s after each event), so a woken
    // object counted every heartbeating socket as dead; (b) a live process
    // handed a payload push let the FCM SDK draw the bare card instead of
    // drawing its own. The DO check below runs the REAL classes against a fake
    // state and re-constructs the object between heartbeat and broadcast.
    {
      const { ChatRoom } = await import(
        new URL("../../src/worker/durable-objects/ChatRoom.ts", import.meta.url).href
      );
      const { CallSignal } = await import(
        new URL("../../src/worker/durable-objects/CallSignal.ts", import.meta.url).href
      );
      const fakeSocket = (attachments) => {
        const sock = {
          sent: [],
          send(x) {
            this.sent.push(x);
          },
          serializeAttachment(v) {
            attachments.set(sock, v);
          },
          deserializeAttachment() {
            return attachments.get(sock);
          },
        };
        return sock;
      };
      // One "state" per object identity: the socket list and the attachments
      // outlive an instance (that is what the runtime keeps across hibernation).
      const fakeState = () => {
        const sockets = [];
        const attachments = new Map();
        return {
          sockets,
          attachments,
          acceptWebSocket(ws) {
            sockets.push(ws);
          },
          getWebSockets() {
            return [...sockets];
          },
        };
      };
      const bcast = (obj, body) =>
        obj
          .fetch(new Request("https://x/broadcast", { method: "POST", body }))
          .then((r) => r.json());
      const st = fakeState();
      const room1 = new ChatRoom(st, {});
      const fresh = fakeSocket(st.attachments);
      st.acceptWebSocket(fresh);
      fresh.serializeAttachment({ seen: Date.now() }); // what /connect does
      const dead = fakeSocket(st.attachments);
      st.acceptWebSocket(dead);
      dead.serializeAttachment({ seen: Date.now() - 46_000 });
      await room1.webSocketMessage(fresh, '{"type":"hb"}');
      // Hibernation: a brand-new instance over the same state.
      const room2 = new ChatRoom(st, {});
      const r = await bcast(room2, '{"type":"conv"}');
      check(
        "r31-22: ChatRoom liveness survives hibernation — a re-constructed object still delivers to (and counts) the heartbeated socket, and still skips the stale one",
        r.sent === 1 && fresh.sent.length === 1 && dead.sent.length === 0,
        JSON.stringify({ sent: r.sent, fresh: fresh.sent.length, dead: dead.sent.length }),
      );
      const st2 = fakeState();
      const sig1 = new CallSignal(st2, {});
      const p1 = fakeSocket(st2.attachments);
      st2.acceptWebSocket(p1);
      await sig1.webSocketMessage(p1, '{"type":"hb"}');
      const sig2 = new CallSignal(st2, {});
      const live = await sig2.fetch(new Request("https://x/live")).then((r) => r.json());
      const r2 = await bcast(sig2, '{"type":"state"}');
      check(
        "r31-22: CallSignal /live + /broadcast read the same hibernation-safe record (no in-memory lastSeen map anywhere)",
        live.live === 1 &&
          r2.sent === 1 &&
          !readFileSync("src/worker/durable-objects/ChatRoom.ts", "utf8").includes("lastSeen") &&
          !readFileSync("src/worker/durable-objects/CallSignal.ts", "utf8").includes("lastSeen") &&
          readFileSync("src/worker/durable-objects/liveness.ts", "utf8").includes(
            "ws.serializeAttachment({ seen: Date.now() } satisfies Attachment);",
          ),
        JSON.stringify({ live, sent: r2.sent }),
      );
      const push = kt("KpPush.kt");
      const hi = push.indexOf("override fun handleIntent(intent: Intent) {");
      const handle = push.slice(hi, hi + 700);
      check(
        "r31-22: a LIVE process never lets the FCM SDK draw the bare payload card — KpPushService strips the SDK's display marker (gcm.n.e / gcm.notification.e) before dispatch, so onMessageReceived posts the app's own Reply / Like / Mark-as-read card; the Reply action + RemoteInput stay on the card",
        hi > 0 &&
          handle.includes("own.remove(SHOW_KEY)") &&
          handle.includes("own.remove(SHOW_KEY_OLD)") &&
          handle.includes("intent.replaceExtras(own)") &&
          handle.includes("super.handleIntent(intent)") &&
          push.includes('const val SHOW_KEY = "gcm.n.e"') &&
          push.includes('const val SHOW_KEY_OLD = "gcm.notification.e"') &&
          push.indexOf("override fun handleIntent(intent: Intent) {") <
            push.indexOf("override fun onMessageReceived(message: RemoteMessage) {") &&
          kt("KpNotify.kt").includes(".addRemoteInput(remoteInput)") &&
          kt("KpNotify.kt").includes(
            'NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Reply", replyPending)',
          ) &&
          kt("KpNotify.kt").includes("ACTION_REPLY -> {"),
      );
    }

    {
      const cn = kt("CallNotify.kt");
      const inc = cn.slice(
        cn.indexOf("fun incoming(ctx: Context"),
        cn.indexOf("fun ongoing(ctx: Context"),
      );
      check(
        "r31-23: incoming-call card — Accept GREEN, Decline RED (full-length ForegroundColorSpan = the platform's emphasized call-button colour, same Green/Red as the call screen); both actions keep their intents",
        inc.includes('val acceptLabel = coloured("Accept", Green.toArgb())') &&
          inc.includes('val declineLabel = coloured("Decline", Red.toArgb())') &&
          inc.includes(".addAction(0, acceptLabel, accept)") &&
          inc.includes(".addAction(0, declineLabel, decline)") &&
          inc.includes(".setFullScreenIntent(open, true)") &&
          cn.includes("private fun coloured(text: String, color: Int): CharSequence =") &&
          cn.includes("android.text.style.ForegroundColorSpan(color)") &&
          !inc.includes('addAction(0, "Accept"') &&
          !inc.includes('addAction(0, "Decline"'),
      );
    }

    // Owner round 31 item 24: a caller who hangs up on an unanswered ring
    // used to end the call as a plain ENDED row — no missed-call push, no
    // "Missed voice call" bubble, no red history row for the callee. Real
    // worker, FCM captured through a global-fetch intercept.
    {
      const { generateKeyPairSync } = await import("node:crypto");
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const worker = await freshWorker();
      const db = makeD1();
      const sent = [];
      const pokes = [];
      const env = {
        DB: db,
        MEDIA: makeR2(),
        GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
        FCM_CREDENTIALS: JSON.stringify({
          project_id: "kp-test-proj",
          client_email: "svc@kp-test-proj.iam.gserviceaccount.com",
          private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          token_uri: "https://oauth2.googleapis.com/token",
        }),
        // Callee swiped away: no live socket → the guaranteed payload branch.
        CHAT_ROOM: {
          idFromName: (name) => ({ toString: () => name, name }),
          get: (id) => ({
            fetch: async (_u, init) => {
              pokes.push({ room: id.name, body: JSON.parse(init.body) });
              return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 });
            },
          }),
        },
        CALL_SIGNAL: {
          idFromName: (name) => ({ toString: () => name, name }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 }),
          }),
        },
      };
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
          sent.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ name: "projects/1/messages/1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
      try {
        const ctx = makeCtx();
        let ipSeq = 0;
        const call = async (method, path, body, token) => {
          const headers = { "content-type": "application/json" };
          if (path.startsWith("/api/auth/"))
            headers["cf-connecting-ip"] =
              `203.24.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
        const caller = await reg("mc-a@x.com", "mca");
        const callee = await reg("mc-b@x.com", "mcb");
        await call("POST", "/api/devices", { token: "fcm-device-token-mcb" }, callee.token);
        const age = (id, ms) =>
          db._db
            .prepare("UPDATE calls SET created_at = ? WHERE id = ?")
            .run(new Date(Date.now() - ms).toISOString(), id);
        const place = async () => {
          const r = await call(
            "POST",
            "/api/calls",
            { userId: callee.user.id, kind: "AUDIO", offerSdp: "v=0" },
            caller.token,
          );
          return r.json.call?.id ?? r.json.id;
        };
        // (a) caller gives up after the ring has been on the callee's screen
        const c1 = await place();
        age(c1, 8_000);
        sent.length = 0;
        await call("POST", `/api/calls/${c1}/end`, {}, caller.token);
        const row1 = db._db.prepare("SELECT status FROM calls WHERE id = ?").get(c1);
        const push1 = sent.find((m) => m.message?.android?.data?.type === "missed_call");
        const log1 = db._db
          .prepare(
            "SELECT body, meta_json FROM messages WHERE conv_id = ? AND kind = 'CALL' ORDER BY rowid DESC",
          )
          .get(`c_${[caller.user.id, callee.user.id].sort().join("_")}`);
        const histB = await call("GET", "/api/calls/history", undefined, callee.token);
        check(
          "r31-24: caller hangs up on an unanswered ring → the row is MISSED (not ENDED), the callee gets the missed_call push with Call back / Message deep links on the dedicated missed-call channel, a 'Missed voice call' bubble lands, and the callee's history shows it as missed",
          row1?.status === "MISSED" &&
            !!push1 &&
            push1.message.android.data.callId === c1 &&
            push1.message.android.data.kp_callback === caller.user.id &&
            !!push1.message.android.data.kp_chat &&
            push1.message.android.notification?.channel_id === "kp_missed_v1" &&
            push1.message.android.notification?.body === "Missed voice call" &&
            log1?.body === "Missed voice call" &&
            JSON.parse(log1?.meta_json ?? "{}").status === "MISSED" &&
            histB.json.items?.find((c) => c.id === c1)?.status === "MISSED",
          JSON.stringify({ row: row1, push: push1?.message?.android, log: log1 }).slice(0, 400),
        );
        // (b) cut inside the anti-phantom window: the callee never saw it → quiet ENDED
        const c2 = await place();
        sent.length = 0;
        await call("POST", `/api/calls/${c2}/end`, {}, caller.token);
        const row2 = db._db.prepare("SELECT status FROM calls WHERE id = ?").get(c2);
        check(
          "r31-24: a ring cut inside the 1.6 s anti-phantom window (never reached the callee) still ends quietly — no MISSED row, no push",
          row2?.status === "ENDED" &&
            !sent.some((m) => m.message?.android?.data?.type === "missed_call"),
          JSON.stringify({ row: row2, sends: sent.length }),
        );
        // (c) the callee's own decline is still a DECLINED row, never a missed call
        const c3 = await place();
        age(c3, 8_000);
        sent.length = 0;
        await call("POST", `/api/calls/${c3}/decline`, {}, callee.token);
        const row3 = db._db.prepare("SELECT status FROM calls WHERE id = ?").get(c3);
        check(
          "r31-24: the callee declining stays DECLINED (no missed-call push to themself); an answered call ending is still ENDED",
          row3?.status === "DECLINED" &&
            !sent.some((m) => m.message?.android?.data?.type === "missed_call") &&
            (await (async () => {
              const c4 = await place();
              age(c4, 8_000);
              await call("POST", `/api/calls/${c4}/answer`, { answerSdp: "v=0 a" }, callee.token);
              await call("POST", `/api/calls/${c4}/end`, {}, caller.token);
              return (
                db._db.prepare("SELECT status FROM calls WHERE id = ?").get(c4)?.status === "ENDED"
              );
            })()),
          JSON.stringify({ row: row3, sends: sent.length }),
        );
        check(
          "r31-24: the stale-ring reaper and the caller hang-up share ONE missed-call sender (notifyMissedCall) — the missed-call channel id matches the app's",
          (
            readFileSync("src/worker/index.ts", "utf8").match(
              /notifyMissedCall\(env, db, row\)/g,
            ) || []
          ).length === 2 &&
            readFileSync("src/worker/index.ts", "utf8").includes(
              'const MISSED_CALL_CHANNEL = "kp_missed_v1";',
            ) &&
            kt("KpNotify.kt").includes('private const val MISSED_CHANNEL = "kp_missed_v1"') &&
            kt("KpNotify.kt").includes(
              'NotificationChannel(MISSED_CHANNEL, "Missed calls", NotificationManager.IMPORTANCE_HIGH)',
            ) &&
            kt("KpNotify.kt").includes("NotificationCompat.Builder(ctx, MISSED_CHANNEL)") &&
            kt("KpNotify.kt").includes(".setCategory(NotificationCompat.CATEGORY_MISSED_CALL)"),
        );
        const mh = kt("KpPush.kt");
        const handler = mh.slice(
          mh.indexOf("private fun handleMissedCall(data: Map<String, String>) {"),
          mh.indexOf("private fun handleCallAnswer("),
        );
        check(
          "r31-24: the app posts the missed-call card in the foreground too (only the live ring/call screen for that call is exempt) and retracts the stuck ring card first",
          !handler.includes("if (Store.foreground) {\n            return") &&
            handler.includes("val onCallScreen =") &&
            handler.includes("if (onCallScreen) {") &&
            handler.includes("CallNotify.cancelIncoming(this)") &&
            handler.includes("KpNotify.missedCall(") &&
            handler.includes("ScreenStore.pokeInbox()"),
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    }

    // Every cream / warm-white literal outside Theme.kt and the login screen
    // (which the owner excluded from theme work) must be gone from the
    // screens: dark-blue may not paint any light-cream colour.
    const creamLiterals = [
      "0xFFF3E4C6",
      "0xFFFEF3C7",
      "0xFFFEE2E2",
      "0xFFE7F0E7",
      "0xFFEAE6DF",
      "0xFFE7E5E4",
    ];
    const leaks = [];
    for (const f of readdirSync("native-android/app/src/main/java/app/kuchupuchu/android")) {
      if (!f.endsWith(".kt") || f === "Theme.kt" || f === "LoginScreen.kt") continue;
      const src = kt(f);
      for (const lit of creamLiterals) if (src.includes(lit)) leaks.push(`${f}:${lit}`);
    }
    check(
      "r30-6: no light-cream literal left on any screen — circle buttons, chips, swipe slots, ticks are themed tokens",
      leaks.length === 0 &&
        kt("Theme.kt").includes("fun circleButtonFill(): Brush") &&
        kt("Theme.kt").includes("val ChipSelected: Color") &&
        kt("Theme.kt").includes("val SwipeDeleteBg: Color") &&
        kt("CreateGroupScreen.kt").includes(".background(if (on) ActionBlue else Line),"),
      leaks.join(" "),
    );
  }
  check(
    "r30-7: press-and-hold pauses the status viewer (clock, bar, clip) until release; tap still steps",
    kt("StatusScreens.kt").includes(
      "onPress = {\n                                    holding = true\n                                    tryAwaitRelease()\n                                    holding = false",
    ) &&
      kt("StatusScreens.kt").includes("|| !Store.foreground || holding) {") &&
      kt("StatusScreens.kt").includes(
        "paused = showViewers || menuOpen || replyFocused || holding,",
      ),
  );
  const settings = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
    "utf8",
  );
  const profile = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
    "utf8",
  );
  const settingsBody = settings.slice(
    settings.indexOf("fun SettingsScreen("),
    settings.indexOf("fun PrivacySettingsScreen("),
  );
  check(
    "r30-2/r31: Settings is a hub of five dedicated screens (Privacy / Appearance / Devices / Permissions / App); privacy picker + logout are bottom sheets; no profile fields anywhere in Settings",
    [
      'HubRow(Icons.Filled.Lock, "Privacy")',
      'HubRow(Icons.Filled.Palette, "Appearance")',
      'HubRow(Icons.Filled.PhoneAndroid, "Devices")',
      'HubRow(Icons.Filled.Shield, "Permissions")',
      'HubRow(Icons.Filled.Info, "App")',
    ].every((l) => settingsBody.includes(l)) &&
      ["privacy", "appearance", "devices", "permissions", "app"].every((r) =>
        kpapp.includes(`composable("settings/${r}")`),
      ) &&
      [
        "fun PrivacySettingsScreen(",
        "fun AppearanceSettingsScreen(",
        "fun DevicesSettingsScreen(",
        "fun PermissionsSettingsScreen(",
        "fun AppSettingsScreen(",
      ].every((f) => settings.includes(f)) &&
      [
        '"My number"',
        '"Profile picture"',
        '"Messages"',
        '"Last seen"',
        '"Add to groups"',
        '"Read receipts"',
        '"Private profile"',
        '"Sounds"',
        '"Themes"',
        '"App version"',
        '"Check for updates"',
        '"About us"',
      ].every((l) => settings.includes(l)) &&
      !settings.includes("AlertDialog(") &&
      !settings.includes("PrivacyPickerDialog") &&
      settings.includes("KpConfirmSheet(") &&
      (settings.match(/KpSheet\(/g) || []).length >= 1 &&
      !settings.includes('"editfield/') &&
      !settings.includes("PickVisualMedia") &&
      !settings.includes("fun MyProfileScreen(") &&
      settings.includes('Api.get("/api/auth/devices", true)') &&
      settings.includes('"No one"') &&
      settings.includes('"Contacts only"') &&
      settings.includes('"Public"'),
  );
  // server: privacy stored via PATCH /api/me and ENFORCED
  const k = await mk();
  const a = await k.reg("pv-a@x.com", "pva");
  const b = await k.reg("pv-b@x.com", "pvb");
  const s0 = await k.reg("pv-s@x.com", "pvs"); // stranger: no chat with a
  const shape = await k.call("GET", "/api/me", undefined, a.token);
  check(
    "r30-2: /api/me carries the privacy block with the pre-round defaults (number contacts-only, rest public)",
    shape.json.user?.privacy?.phone === "contacts" &&
      shape.json.user?.privacy?.avatar === "public" &&
      shape.json.user?.privacy?.messages === "public" &&
      shape.json.user?.privacy?.lastSeen === "public" &&
      shape.json.user?.privacy?.groups === "public" &&
      shape.json.user?.privacy?.readReceipts === true &&
      shape.json.user?.privacy?.privateProfile === false,
    JSON.stringify(shape.json.user?.privacy),
  );
  const bad = await k.call("PATCH", "/api/me", { privPhone: "friends" }, a.token);
  check("r30-2: an unknown privacy level is refused", bad.status === 400, String(bad.status));
  // a <-> b are contacts (1:1 chat); s0 is a stranger
  const cid = (await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
    .conversation.id;
  await k.call(
    "PATCH",
    "/api/me",
    { privPhone: "public", privAvatar: "contacts", privLastSeen: "nobody" },
    a.token,
  );
  await k.call("PATCH", "/api/me", { avatarUrl: "data:image/png;base64,iVBORw0KGgo=" }, a.token);
  const byContact = (await k.call("GET", `/api/users/${a.user.id}`, undefined, b.token)).json.user;
  const byStranger = (await k.call("GET", `/api/users/${a.user.id}`, undefined, s0.token)).json
    .user;
  check(
    "r30-2: number public → both see it; picture contacts-only → only the contact gets bytes+ref; last seen nobody → hidden from both",
    byContact.phone === a.user.phone &&
      byStranger.phone === a.user.phone &&
      typeof byContact.avatarUrl === "string" &&
      byContact.avatarRef &&
      byStranger.avatarUrl == null &&
      byStranger.avatarRef == null &&
      byContact.lastActiveAt == null &&
      byContact.online === false &&
      byStranger.lastActiveAt == null,
    JSON.stringify({ c: byContact, s: byStranger }).slice(0, 300),
  );
  const avStranger = await k.call("GET", `/api/users/${a.user.id}/avatar`, undefined, s0.token);
  const avContact = await k.call("GET", `/api/users/${a.user.id}/avatar`, undefined, b.token);
  check(
    "r30-2: the avatar blob route obeys the same picture rule",
    avStranger.status === 404 && avContact.status === 200,
    `${avStranger.status}/${avContact.status}`,
  );
  await k.call("PATCH", "/api/me", { privPhone: "contacts" }, a.token);
  const numHidden = (await k.call("GET", `/api/users/${a.user.id}`, undefined, s0.token)).json.user;
  check(
    "r30-2: number back to contacts-only → a stranger gets null, and the light discovery list never carries it",
    numHidden.phone == null &&
      (await k.call("GET", "/api/users?q=pva", undefined, s0.token)).json.users.every(
        (u) => u.phone == null,
      ),
    JSON.stringify(numHidden).slice(0, 120),
  );
  // messages: contacts only → a stranger cannot open a chat or call; the contact still can
  await k.call("PATCH", "/api/me", { privMessages: "contacts" }, a.token);
  const strangerChat = await k.call("POST", "/api/conversations", { userId: a.user.id }, s0.token);
  const strangerCall = await k.call(
    "POST",
    "/api/calls",
    { userId: a.user.id, kind: "AUDIO" },
    s0.token,
  );
  const contactMsg = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "TEXT", body: "hi", clientId: "pv1" },
    b.token,
  );
  check(
    "r30-2: messages = contacts only → stranger's new chat AND call refused (MSG_PRIVACY), the contact still sends",
    strangerChat.status === 403 &&
      strangerChat.json.error?.code === "MSG_PRIVACY" &&
      strangerCall.status === 403 &&
      contactMsg.status === 201,
    `${strangerChat.status}/${strangerCall.status}/${contactMsg.status}`,
  );
  await k.call("PATCH", "/api/me", { privMessages: "nobody" }, a.token);
  const contactBlockedMsg = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "TEXT", body: "hi2", clientId: "pv2" },
    b.token,
  );
  const selfStill = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "TEXT", body: "me", clientId: "pv3" },
    a.token,
  );
  check(
    "r30-2: messages = no one → even the existing chat refuses the peer; the owner can still write",
    contactBlockedMsg.status === 403 && selfStill.status === 201,
    `${contactBlockedMsg.status}/${selfStill.status}`,
  );
  await k.call("PATCH", "/api/me", { privMessages: "public" }, a.token);
  // groups: contacts only → a stranger's group silently skips a; the contact's group includes a
  await k.call("PATCH", "/api/me", { privGroups: "contacts" }, a.token);
  const gStranger = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "g1", memberIds: [a.user.id] },
    s0.token,
  );
  const gContact = await k.call(
    "POST",
    "/api/conversations/group",
    { title: "g2", memberIds: [a.user.id] },
    b.token,
  );
  const gid = gContact.json.conversation?.id;
  const addByStranger = await k.call(
    "POST",
    `/api/conversations/${gid}/members`,
    { userId: a.user.id },
    s0.token,
  );
  void addByStranger; // not the owner → 403 FORBIDDEN before privacy; covered below via s0's own group
  const gOwn = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "g3", memberIds: [b.user.id] },
      s0.token,
    )
  ).json.conversation;
  const addA = await k.call(
    "POST",
    `/api/conversations/${gOwn.id}/members`,
    { userId: a.user.id },
    s0.token,
  );
  check(
    "r30-2: groups = contacts only → stranger's create gets NO_MEMBERS, add-member gets GROUP_PRIVACY; the contact's group includes me",
    gStranger.status === 400 &&
      gStranger.json.error?.code === "NO_MEMBERS" &&
      gContact.status === 201 &&
      addA.status === 403 &&
      addA.json.error?.code === "GROUP_PRIVACY",
    `${gStranger.status}/${gContact.status}/${addA.status}`,
  );
  // private profile: gone from search + discovery + username lookup, still reachable by id (existing chat)
  await k.call("PATCH", "/api/me", { privateProfile: true }, a.token);
  const search = await k.call("GET", "/api/search?q=pva", undefined, s0.token);
  const disc = await k.call("GET", "/api/users?q=pva", undefined, b.token);
  const byName = await k.call("GET", "/api/users/username/pva", undefined, b.token);
  const byId = await k.call("GET", `/api/users/${a.user.id}`, undefined, b.token);
  check(
    "r30-2: private profile → not in search, not in discovery (even for a contact), username lookup 404, id lookup still works",
    (search.json.users ?? []).every((u) => u.id !== a.user.id) &&
      (disc.json.users ?? []).every((u) => u.id !== a.user.id) &&
      byName.status === 404 &&
      byId.status === 200 &&
      byId.json.user.id === a.user.id,
    `${search.status}/${disc.status}/${byName.status}/${byId.status}`,
  );
  // Owner round 31 item 21: the PEER's app must know the profile is private
  // (screenshot block + no save/forward on their side) — id lookup, chat
  // list `other` and the call's `other` all say so.
  const listB = await k.call("GET", "/api/conversations", undefined, b.token);
  const rowB = (listB.json.items ?? []).find((c) => c.id === cid);
  check(
    "r31-21: privateProfile is exposed on every peer shape (user lookup + chat-list other), false by default",
    byId.json.user.privateProfile === true &&
      rowB?.other?.privateProfile === true &&
      (listB.json.items ?? []).every(
        (c) => typeof (c.other?.privateProfile ?? false) === "boolean",
      ),
    JSON.stringify({ byId: byId.json.user.privateProfile, row: rowB?.other?.privateProfile }),
  );
  // read receipts off → the peer never gets my read mark (poll + list + live frame)
  await k.call("PATCH", "/api/me", { readReceipts: false }, a.token);
  await k.call("POST", `/api/conversations/${cid}/read`, {}, a.token);
  const peerPage = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
  const peerList = await k.call("GET", "/api/conversations", undefined, b.token);
  const peerConv = (peerList.json.items ?? []).find((c) => c.id === cid);
  const aRow = (peerConv?.members ?? []).find((m) => m.user?.id === a.user.id);
  check(
    "r30-2: read receipts off → readAt null on the peer's poll and lastReadAt null in their list; unread still resets",
    peerPage.json.readAt == null &&
      aRow &&
      aRow.lastReadAt == null &&
      k.db._db
        .prepare("SELECT unread FROM members WHERE conv_id = ? AND user_id = ?")
        .get(cid, a.user.id).unread === 0,
    JSON.stringify({ readAt: peerPage.json.readAt, aRow }).slice(0, 160),
  );
  // devices list
  const devs = await k.call("GET", "/api/auth/devices", undefined, a.token);
  check(
    "r30-2: /api/auth/devices lists the ACTIVE install and marks it current",
    devs.status === 200 &&
      devs.json.items.length === 1 &&
      devs.json.items[0].active === true &&
      devs.json.items[0].current === true &&
      devs.json.items[0].deviceId === "dev-pva" &&
      typeof devs.json.items[0].name === "string",
    JSON.stringify(devs.json).slice(0, 200),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`bots-verified: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
