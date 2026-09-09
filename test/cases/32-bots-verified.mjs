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
      // r32-45/34: FILE rows (voice + document) keep no band either (their second line hosts the stamp).
      chat.includes(
        'bottom = if (fileRow) 4.dp else if (kind == "TEXT" && emojiOnly == 0) 0.dp else 15.dp',
      ),
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
    "owner account cannot be blocked from its profile (r32-25: the guard is on the ⋮ Block row; the worker refuses the POST too)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
      "utf8",
    ).includes('user?.optText("username") == "rabbihossainltd"') &&
      src.includes('if (ownerRow) fail(403, "This account can\'t be blocked.", "OWNER_ACCOUNT");'),
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
      // r32-45/34: FILE rows (voice + document) keep no band either (their second line hosts the stamp).
      chat.includes(
        'bottom = if (fileRow) 4.dp else if (kind == "TEXT" && emojiOnly == 0) 0.dp else 15.dp',
      ) &&
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
      settings.includes("selCustom != null) ChipSelected else Card"),
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
      // r32-16: "Unsend" is "Delete for everyone" now.
      [
        '"Reply"',
        '"Copy"',
        '"Forward"',
        '"Edit"',
        '"Delete for everyone"',
        '"Delete for me"',
        '"Select"',
      ].every((l) =>
        chat.includes(
          `KpSheetRow(Icons.${l === '"Reply"' ? "AutoMirrored.Filled.Reply" : l === '"Forward"' ? "AutoMirrored.Filled.Send" : l === '"Copy"' ? "Filled.ContentCopy" : l === '"Edit"' ? "Filled.Edit" : l === '"Delete for everyone"' ? "Filled.DeleteForever" : l === '"Delete for me"' ? "Filled.Delete" : "Filled.CheckCircle"}, ${l}`,
        ),
      ) &&
      // r31-29: text, photo, video AND the grouped photo bubble (4 sites).
      (
        chat.match(
          /if \(selectedIds\.isNotEmpty\(\)\) onToggleSelect\(m\) else onLongPress\(m\)/g,
        ) || []
      ).length === 4,
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
      ).includes(
        // r32-9: routed through the companion so a cold-start tap is queued.
        'if (intent.getBooleanExtra("kp_return_call", false)) CallEngine.onRestoreIntent()',
      ),
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
      // r31-29: text, photo, video + the grouped photo bubble (4 sites).
      chat.split("MessageReactions(m)").length - 1 === 4,
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
    "status replies carry the status as meta (r32-21 replaced the '> caption' prefix), no emoji anywhere in UI text",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt",
      "utf8",
    ).includes('JSONObject().put("status", JSONObject().put("id", statusId))') &&
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
      ).includes("if (engine.active == null) engine.syncNow()"),
  );
  check(
    "r25: username editor = LIVE check, green/red border, no icons, no extra instructions",
    settings.includes("LaunchedEffect(value)") &&
      settings.includes("this username not available") &&
      !settings.includes("Check availability") &&
      settings.includes("borderColor = borderColor,"),
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
    "r25/r32-29: photos smaller (150dp inline preview, ≤200dp tall) + JPEG quality 90; voice/call stamps bottom-right; ONE back closes reaction+selection",
    (chat.match(/\.widthIn\(max = 150\.dp\)/g) || []).length === 2 &&
      chat.includes(".heightIn(max = 200.dp)") &&
      !chat.includes(".widthIn(max = 185.dp)") &&
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
    // r32-24: the phone input is the KpInputField pill (themed border lives there).
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
      "utf8",
    ).includes(
      "keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = imeAction),",
    ) &&
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
    "r27/r31-30: status composer uploads the cut clip as video/mp4 under a proper name (the export always writes mp4)",
    readFileSync(
      "native-android/app/src/main/java/app/kuchupuchu/android/StatusPhotoScreen.kt",
      "utf8",
    ).includes('Api.upload("status.mp4", "video/mp4", bytes)'),
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
    "r28-5/r31/r32-3: the settings cog is gone; the home ⋮ menu is exactly My Profile, New contact, All contacts, New group, Settings — in that order, each a real route (r32-3: About Us removed; it stays under Settings › App)",
    !list.includes('Icon(Icons.Filled.Settings, "Settings"') &&
      (() => {
        const order = ["My Profile", "New contact", "All contacts", "New group", "Settings"];
        const idx = order.map((l) => list.indexOf(`"${l}")`));
        return idx.every((i, n) => i > 0 && (n === 0 || i > idx[n - 1]));
      })() &&
      (list.match(/HomeMenuItem\(Icons/g) || []).length === 5 &&
      !list.includes('HomeMenuItem(Icons.Filled.Info, "About Us")') &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
        "utf8",
      ).includes('SettingRow(Icons.Filled.Favorite, "About us", "") { nav.navigate("about") }') &&
      list.includes('nav.navigate("profile/${Store.myId()}")') &&
      ["about", "contacts", "settings"].every((r) => kpapp.includes(`composable("${r}")`)) &&
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
      // r32-25: calls / search on EVERY peer profile (the owner's too)
      profile.includes("if (!isMe && !isKpBot(userId)) {\n        Row(") &&
      !profile.includes(
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
      // r31-30: the status share screen has NO caption bar any more.
      !kt("StatusPhotoScreen.kt").includes('Text("Caption")'),
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
          "fun sendFile(name: String, mime: String, file: File, asDocument: Boolean = false)",
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
        // r31-27: the call site now also hands the chat theme down (voice bars).
        chat.includes(
          '"FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme)',
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
        // r32-2: the toggle lives under Privacy now, with the owner's exact label
        kt("SettingsScreen.kt").includes(
          'ToggleRow(Icons.Filled.VolumeUp, "Share Audio Via Screen Share", sysAudio) { on ->',
        ) &&
        kt("SettingsScreen.kt").indexOf("fun PrivacySettingsScreen") <
          kt("SettingsScreen.kt").indexOf('"Share Audio Via Screen Share"') &&
        kt("SettingsScreen.kt").indexOf('"Share Audio Via Screen Share"') <
          kt("SettingsScreen.kt").indexOf("fun AppearanceSettingsScreen"),
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
          "onSave = if (m != null && dest != null && state == 1 && !privateClip && !saved) ({ menuOpen = false; saveClip() }) else null,",
        ) &&
        kt("MediaViewer.kt").includes(
          'val canForward = m != null && !privateClip && m.optText("fileKey").isNotBlank()',
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

    // Owner round 31 item 26: "Hide chat". Server flag per member; a hidden
    // chat gets NO message push (even the dead-process tray fallback), the
    // other member is unaffected, the list marker moves so the app's list
    // re-syncs, and unhide restores pushes. Real worker + captured FCM.
    {
      const { generateKeyPairSync } = await import("node:crypto");
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const worker = await freshWorker();
      const db = makeD1();
      const sent = [];
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
        // Nobody connected → the worker would normally attach the tray payload.
        CHAT_ROOM: {
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
              `203.26.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
        const a = await reg("hide-a@x.com", "hidea");
        const b = await reg("hide-b@x.com", "hideb");
        const c = await reg("hide-c@x.com", "hidec");
        await call("POST", "/api/devices", { token: "fcm-hide-a" }, a.token);
        await call("POST", "/api/devices", { token: "fcm-hide-b" }, b.token);
        const conv = await call("POST", "/api/conversations", { userId: b.user.id }, a.token);
        const cid = conv.json.conversation.id;
        const pushesTo = (token) =>
          sent.filter(
            (m) => m.message?.token === token && m.message?.android?.data?.type === "message",
          ).length;
        // baseline: b's message pushes a
        sent.length = 0;
        await call(
          "POST",
          `/api/conversations/${cid}/messages`,
          { kind: "TEXT", body: "one" },
          b.token,
        );
        const before = pushesTo("fcm-hide-a");
        const list0 = await call("GET", "/api/conversations", undefined, a.token);
        const marker0 = list0.json.marker;
        // a hides the chat
        const hide = await call(
          "POST",
          `/api/conversations/${cid}/hide`,
          { hidden: true },
          a.token,
        );
        const listA = await call("GET", "/api/conversations", undefined, a.token);
        const rowA = (listA.json.items ?? []).find((x) => x.id === cid);
        const listB = await call("GET", "/api/conversations", undefined, b.token);
        const rowB = (listB.json.items ?? []).find((x) => x.id === cid);
        sent.length = 0;
        await call(
          "POST",
          `/api/conversations/${cid}/messages`,
          { kind: "TEXT", body: "two" },
          b.token,
        );
        const whileHidden = pushesTo("fcm-hide-a");
        // b still gets pushes for a's messages while a has it hidden
        await call(
          "POST",
          `/api/conversations/${cid}/messages`,
          { kind: "TEXT", body: "reply" },
          a.token,
        );
        const bStill = pushesTo("fcm-hide-b");
        const outsider = await call(
          "POST",
          `/api/conversations/${cid}/hide`,
          { hidden: true },
          c.token,
        );
        // unhide → pushes resume
        await call("POST", `/api/conversations/${cid}/hide`, { hidden: false }, a.token);
        sent.length = 0;
        await call(
          "POST",
          `/api/conversations/${cid}/messages`,
          { kind: "TEXT", body: "three" },
          b.token,
        );
        const after = pushesTo("fcm-hide-a");
        const listA2 = await call("GET", "/api/conversations", undefined, a.token);
        const rowA2 = (listA2.json.items ?? []).find((x) => x.id === cid);
        check(
          "r31-26: POST /api/conversations/:id/hide flips the caller's own `hidden` flag (list row + marker change), the OTHER member's row is untouched, a non-member is refused",
          hide.status === 200 &&
            hide.json.hidden === true &&
            rowA?.hidden === true &&
            rowB?.hidden === false &&
            listA.json.marker !== marker0 &&
            outsider.status >= 400 &&
            rowA2?.hidden === false,
          JSON.stringify({
            hide: hide.json,
            a: rowA?.hidden,
            b: rowB?.hidden,
            outsider: outsider.status,
          }),
        );
        check(
          "r31-26: a hidden chat gets NO message push for that member (not even the dead-process tray card) while the other member keeps theirs; unhide restores pushes",
          before === 1 && whileHidden === 0 && bStill === 1 && after === 1,
          JSON.stringify({ before, whileHidden, bStill, after }),
        );
        check(
          "r31-26: bot/system pushes honour the flag too (login-attempt + AI replies go through pushMessageUnlessHidden) and the flag is in the list's freshness marker",
          (readFileSync("src/worker/index.ts", "utf8").match(/pushMessageUnlessHidden\(/g) || [])
            .length >= 4 &&
            readFileSync("src/worker/index.ts", "utf8").includes(
              "if (Number(memberId.hidden ?? 0) === 1) return;",
            ) &&
            readFileSync("src/worker/index.ts", "utf8").includes("          c.hidden,\n"),
        );
        const cl = kt("ChatListScreen.kt");
        const row = cl.slice(
          cl.indexOf("private fun SwipeConvRow("),
          cl.indexOf("private fun RowScope.ActionSlot("),
        );
        check(
          "r31-26: app — swipe right shows Hide beside Archive (main list), Unhide on the hidden screen; hidden rows leave the main list AND the archive; the badge ignores them",
          row.includes('label = "Hide",') &&
            row.includes('label = "Unhide",') &&
            row.includes(
              'Api.post("/api/conversations/$id/hide", JSONObject().put("hidden", hidden))',
            ) &&
            row.includes("if (offset < 0f && !archivedMode && !hiddenMode) {") &&
            cl.includes(
              '.filter { !ScreenStore.isArchived(it.optString("id")) && !it.optBoolean("hidden") }',
            ) &&
            cl.includes(
              'convs.filter { ScreenStore.isArchived(it.optString("id")) && !it.optBoolean("hidden") }',
            ) &&
            cl.includes(
              'convs.filter { !it.optBoolean("hidden") }.sumOf { it.optInt("unread", 0) }',
            ),
        );
        check(
          "r31-26/r32-23: app — hidden chats screen opens ONLY by three quick taps on BLANK chat-list space (one finger, no drag, row taps reset the run; pass-through, no menu entry); route `hidden`",
          cl.includes("fun HiddenChatsScreen(nav: NavController) {") &&
            cl.includes(
              "private fun swipeFocusList(onTripleTapBlank: (() -> Unit)? = null): Modifier =",
            ) &&
            cl.includes("val onRow = SwipeOpen.downOn != null") &&
            cl.includes("val tap = !onRow && !moved && fingers == 1 && now - downAt < 300") &&
            cl.includes("if (tap && (taps == 0 || now - lastUp < 600)) {") &&
            cl.includes("if (taps >= 3) {") &&
            (cl.match(/swipeFocusList \{ nav\.navigate\("hidden"\) \}/g) || []).length === 2 &&
            !cl.includes("threeFingerDoubleTap") &&
            !cl.includes("maxFingers >= 3") &&
            kt("KpApp.kt").includes('composable("hidden") { HiddenChatsScreen(nav) }') &&
            !cl.includes('"Hidden chats"') &&
            !cl.includes("HomeMenuItem(Icons.Filled.VisibilityOff"),
        );
        check(
          "r32-23: hidden calls — call rows whose 1:1 peer chat is hidden leave the Calls tab and show under a Calls heading on the Hidden screen (ScreenStore.isHiddenCall via convIdForUser)",
          kt("ScreenStore.kt").includes("fun isHiddenCall(call: JSONObject): Boolean {") &&
            kt("ScreenStore.kt").includes("fun callPeerId(call: JSONObject): String =") &&
            kt("CallsTabScreen.kt").includes("calls.filter { !ScreenStore.isHiddenCall(it) }") &&
            kt("CallsTabScreen.kt").includes("} else if (shown.isEmpty()) {") &&
            kt("CallsTabScreen.kt").includes(
              "internal fun CallRow(call: JSONObject, onOpenChat: () -> Unit) {",
            ) &&
            cl.includes("ScreenStore.calls.filter { ScreenStore.isHiddenCall(it) }") &&
            cl.includes('items(hiddenCalls, key = { "call_" + it.optString("id") }) { call ->') &&
            cl.includes("if (hidden.isEmpty() && hiddenCalls.isEmpty()) {"),
        );
        check(
          "r31-26: app — no notification card, no in-app tone, no list alert for a hidden chat (push handler drops it; the tone + list paths use isSilenced = muted || hidden)",
          kt("KpPush.kt").includes("if (ScreenStore.isHidden(convoId)) {") &&
            kt("KpApp.kt").includes("!ScreenStore.isSilenced(cid)") &&
            kt("ScreenStore.kt").includes(
              "fun isSilenced(convId: String): Boolean = isMuted(convId) || isHidden(convId)",
            ) &&
            kt("ScreenStore.kt").includes("if (isSilenced(convId)) return false") &&
            kt("ScreenStore.kt").includes("append(c.optBoolean(\"hidden\")).append('|')"),
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    }

    // r31-27: voice messages carry a real waveform (meta.waveform) that the
    // server stores — clamped to 0..100 and 64 bars, voice-only — and the
    // bubble paints playback progress on those bars. Real worker + R2 shim.
    {
      const worker = await freshWorker();
      const db = makeD1();
      const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
      const ctx = makeCtx();
      let ipSeq = 0;
      const call = async (method, path, body, token, raw) => {
        const headers = { "content-type": "application/json" };
        if (path.startsWith("/api/auth/"))
          headers["cf-connecting-ip"] = `203.27.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
        if (token) headers.authorization = `Bearer ${token}`;
        let init = { method, headers };
        if (raw)
          init = {
            method,
            headers: { ...raw.headers, authorization: `Bearer ${token}` },
            body: raw.body,
          };
        else if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
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
      const a = await reg("wave-a@x.com", "wavea");
      const b = await reg("wave-b@x.com", "waveb");
      const conv = await call("POST", "/api/conversations", { userId: b.user.id }, a.token);
      const cid = conv.json.conversation.id;
      const upload = async () => {
        const up = await call(
          "POST",
          "/api/files?name=voice.m4a&type=audio/mp4",
          undefined,
          a.token,
          {
            headers: { "content-type": "application/octet-stream" },
            body: Buffer.from("m4abytes"),
          },
        );
        return up.json.fileKey;
      };
      const k1 = await upload();
      const bars = Array.from({ length: 36 }, (_, i) => (i * 7) % 101);
      const m1 = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: k1,
          fileName: "voice.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "wv-1",
          meta: { voice: true, seconds: 4, waveform: bars },
        },
        a.token,
      );
      const listB = await call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
      const seenByB = (listB.json.items || []).find((m) => m.clientId === "wv-1");
      check(
        "r31-27: a voice note's waveform (36 bars) is stored with the message and comes back to the OTHER side inside meta.waveform, next to voice + seconds",
        m1.status === 201 &&
          JSON.stringify(m1.json.message?.meta?.waveform) === JSON.stringify(bars) &&
          m1.json.message?.meta?.voice === true &&
          m1.json.message?.meta?.seconds === 4 &&
          JSON.stringify(seenByB?.meta?.waveform) === JSON.stringify(bars),
        `status=${m1.status} meta=${JSON.stringify(m1.json.message?.meta).slice(0, 120)}`,
      );
      const k2 = await upload();
      const junk = [-20, 250, "77", null, 1e9, 33.6, NaN, ...Array(100).fill(50)];
      const m2 = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: k2,
          fileName: "voice.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "wv-2",
          meta: { voice: true, seconds: 9, waveform: junk },
        },
        a.token,
      );
      const w2 = m2.json.message?.meta?.waveform;
      check(
        "r31-27: junk bars are clamped, never trusted — ints 0..100 only, at most 64 entries (negative→0, 250→100, '77'→77, null/NaN→0, 33.6→34)",
        m2.status === 201 &&
          Array.isArray(w2) &&
          w2.length === 64 &&
          w2.every((v) => Number.isInteger(v) && v >= 0 && v <= 100) &&
          w2[0] === 0 &&
          w2[1] === 100 &&
          w2[2] === 77 &&
          w2[3] === 0 &&
          w2[4] === 100 &&
          w2[5] === 34 &&
          w2[6] === 0,
        `len=${w2?.length} head=${JSON.stringify(w2?.slice(0, 8))}`,
      );
      const k3 = await upload();
      const m3 = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: k3,
          fileName: "song.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "wv-3",
          meta: { document: true, waveform: bars },
        },
        a.token,
      );
      const k4 = await upload();
      const m4 = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: k4,
          fileName: "voice.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "wv-4",
          meta: { voice: true, seconds: 3, waveform: "not-an-array" },
        },
        a.token,
      );
      const k5 = await upload();
      const m5 = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: k5,
          fileName: "voice.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "wv-5",
          meta: { voice: true, seconds: 3 },
        },
        a.token,
      );
      check(
        "r31-27: no waveform is stored for a document (even an audio one), for a non-array value, or when the sender did not sample one (old app) — the field is simply absent, the note still sends",
        m3.status === 201 &&
          m3.json.message?.meta?.waveform === undefined &&
          m3.json.message?.meta?.document === true &&
          m4.status === 201 &&
          m4.json.message?.meta?.waveform === undefined &&
          m4.json.message?.meta?.voice === true &&
          m5.status === 201 &&
          m5.json.message?.meta?.waveform === undefined,
        `m3=${JSON.stringify(m3.json.message?.meta)} m4=${JSON.stringify(m4.json.message?.meta)}`,
      );
      const src = readFileSync("src/worker/index.ts", "utf8");
      check(
        "r31-27: worker — ONE whitelist helper (voiceWaveform) feeds the FILE meta; the cap is a named constant",
        src.includes("const VOICE_WAVEFORM_MAX = 64;") &&
          src.includes("...voiceWaveform(incomingMeta),") &&
          src.includes(
            "if (meta.voice !== true || !Array.isArray(meta.waveform) || meta.waveform.length === 0) return {};",
          ) &&
          src.includes("waveform?: number[];"),
      );
    }
    {
      const vn = kt("VoiceNote.kt");
      check(
        "r31-27: app — the recorder samples maxAmplitude every 100 ms and squashes the peaks into 36 bars (0..100, sqrt curve, scaled to the take's own peak); stop() hands back a VoiceTake(file, seconds, waveform)",
        vn.includes("const val SAMPLE_MS = 100L") &&
          vn.includes("amps.add(runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0))") &&
          vn.includes("handler.postDelayed(sampler, SAMPLE_MS)") &&
          vn.includes("fun stop(): VoiceTake? {") &&
          vn.includes("val wave = VoiceWaveform.squash(amps)") &&
          vn.includes(
            "class VoiceTake(val file: File, val seconds: Int, val waveform: List<Int>)",
          ) &&
          vn.includes("object VoiceWaveform {") &&
          vn.includes("const val BARS = 36") &&
          vn.includes("const val MAX_BARS = 64") &&
          vn.includes(
            "return means.map { (sqrt(it / peak) * 100f).roundToInt().coerceIn(0, 100) }",
          ) &&
          vn.includes("fun pseudo(seed: String, bars: Int = BARS): List<Int> {") &&
          existsSync(
            "native-android/app/src/test/java/app/kuchupuchu/android/VoiceWaveformTest.kt",
          ),
      );
      check(
        "r31-27: app — the player exposes progress (0..1, 80 ms ticker), PAUSES instead of stopping (pausedId keeps the spot) and seeks by fraction, also while the note is still downloading",
        vn.includes("var progress: Float by mutableStateOf(0f)") &&
          vn.includes("var pausedId: String? by mutableStateOf(null)") &&
          vn.includes("const val TICK_MS = 80L") &&
          vn.includes("runCatching { live.pause() }") &&
          vn.includes("fun seekTo(ctx: Context, id: String, fileKey: String, frac: Float) {") &&
          vn.includes("runCatching { live.seekTo((f * live.duration).toInt()) }") &&
          vn.includes(
            "if (startAt > 0f) runCatching { p.seekTo((startAt * p.duration).toInt()) }",
          ) &&
          vn.includes("if (gen != loadGen) {"),
      );
      check(
        "r31-27: app — the bubble draws the bars on a Canvas (played part in the chat accent / white, rest faint), a tap on the bars seeks, the time line counts up while playing; the 'Voice message' label is gone; bars ride in meta.waveform on send, retry and forward",
        chat.includes("internal fun VoiceWave(") &&
          chat.includes("internal fun voiceWaveOf(m: JSONObject): List<Int> {") &&
          chat.includes(
            "val bars = remember(id) { voiceWaveOf(m).ifEmpty { VoiceWaveform.pseudo(id) } }",
          ) &&
          chat.includes("color = if (x <= playedUntil) played else rest,") &&
          chat.includes("cap = StrokeCap.Round,") &&
          chat.includes("onSeek((up.position.x / size.width).coerceIn(0f, 1f))") &&
          chat.includes(
            "if (!pendingEcho && fileKey.isNotBlank()) player.seekTo(ctx, id, fileKey, frac)",
          ) &&
          chat.includes("active && secs > 0 -> {") &&
          !chat.includes('Text("Voice message", fontSize = 14.sp, color = Ink)') &&
          chat.includes(
            "fun sendVoice(file: File, seconds: Int, name: String, waveform: List<Int> = emptyList()) {",
          ) &&
          chat.includes(
            '.also { if (waveform.isNotEmpty()) it.put("waveform", JSONArray(waveform)) }',
          ) &&
          chat.includes("sendVoice(take.file, take.seconds, name, take.waveform)") &&
          chat.includes("voiceWaveOf(p),") &&
          chat.includes(
            '.also { mm -> vm.optJSONArray("waveform")?.let { mm.put("waveform", it) } },',
          ) &&
          chat.includes(
            '"FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme)',
          ),
      );
    }

    // r31-28: attach panel — swiping up only grows the panel (the folder
    // chips no longer auto-open; the chevron is the one way in), the bigger
    // page follows the panel size, and the numbered selection badge is the
    // action accent (blue in dark-blue, gold in light) — no fixed amber disc.
    {
      const at = kt("AttachSheet.kt");
      const setFs = at.slice(
        at.indexOf("fun setFullscreen(value: Boolean) {"),
        at.indexOf("val dragTotal = remember"),
      );
      check(
        "r31-28: swipe-up / handle tap never opens the folder chips — setFullscreen only ever CLOSES them (on shrink); the chevron toggles foldersOpen on its own",
        setFs.includes("fullscreen = value") &&
          !setFs.includes("foldersOpen = value") &&
          setFs.includes(
            "if (!value) {\n            foldersOpen = false\n            folder = null\n        }",
          ) &&
          at.includes("foldersOpen = !foldersOpen") &&
          at.includes("!fullscreen && !foldersOpen -> pool.take(24)") &&
          !at.includes("Swiping up IS the expand"),
      );
      check(
        "r31-28: the selected-photo count badge is ActionBlue/ActionBlueInk with a white rim — no Gold disc, no fixed near-black ink on the panel's empty states",
        at.includes(
          ".background(ActionBlue)\n                    .border(1.5.dp, Color.White, CircleShape),",
        ) &&
          at.includes("color = ActionBlueInk,") &&
          !at.includes(".background(Gold)") &&
          !at.includes("Color(0x801C1917)"),
      );
    }

    // r31-29: photos sent together share meta.album (worker pins the shape),
    // and the app folds them into ONE grouped bubble: 2 / 3 / 4 layouts, 5+ =
    // three + a dimmed "See all" fourth; the sheet lists them 4 per row.
    {
      const worker = await freshWorker();
      const db = makeD1();
      const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
      const ctx = makeCtx();
      let ipSeq = 0;
      const call = async (method, path, body, token, raw) => {
        const headers = { "content-type": "application/json" };
        if (path.startsWith("/api/auth/"))
          headers["cf-connecting-ip"] = `203.28.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
        if (token) headers.authorization = `Bearer ${token}`;
        let init = { method, headers };
        if (raw)
          init = {
            method,
            headers: { ...raw.headers, authorization: `Bearer ${token}` },
            body: raw.body,
          };
        else if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
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
      const a = await reg("alb-a@x.com", "alba");
      const b = await reg("alb-b@x.com", "albb");
      const conv = await call("POST", "/api/conversations", { userId: b.user.id }, a.token);
      const cid = conv.json.conversation.id;
      const upload = async (name, type) => {
        const up = await call(`POST`, `/api/files?name=${name}&type=${type}`, undefined, a.token, {
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from("bytes-" + name),
        });
        return up.json.fileKey;
      };
      const album = "alb_0123456789abcdef0123";
      const sent = [];
      for (let i = 0; i < 5; i++) {
        const key = await upload(`p${i}.jpg`, "image/jpeg");
        sent.push(
          await call(
            "POST",
            `/api/conversations/${cid}/messages`,
            {
              kind: "FILE",
              fileKey: key,
              fileName: "photo.jpg",
              fileType: "image/jpeg",
              fileSize: 8,
              clientId: `alb-${i}`,
              meta: { w: 1200, h: 900, album },
            },
            a.token,
          ),
        );
      }
      const inline = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "IMAGE",
          imageData: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
          clientId: "alb-inline",
          meta: { album },
        },
        a.token,
      );
      const listB = await call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
      const rowsB = (listB.json.items || []).filter((m) => m.meta?.album === album);
      check(
        "r31-29: five uploaded photos + one inline photo sent with the same meta.album all land as SEPARATE rows and the OTHER side reads the shared album id (with mediaW/mediaH intact)",
        sent.every((r) => r.status === 201 && r.json.message?.meta?.album === album) &&
          inline.status === 201 &&
          inline.json.message?.meta?.album === album &&
          rowsB.length === 6 &&
          rowsB
            .filter((m) => m.kind === "FILE")
            .every((m) => m.mediaW === 1200 && m.mediaH === 900) &&
          new Set(rowsB.map((m) => m.id)).size === 6,
        `rowsB=${rowsB.length} statuses=${sent.map((r) => r.status).join(",")}`,
      );
      const bad = [];
      for (const [i, junk] of [
        "album-1",
        "alb_",
        "alb_" + "x".repeat(40),
        42,
        "alb_has space",
      ].entries()) {
        const key = await upload(`j${i}.jpg`, "image/jpeg");
        bad.push(
          await call(
            "POST",
            `/api/conversations/${cid}/messages`,
            {
              kind: "FILE",
              fileKey: key,
              fileName: "photo.jpg",
              fileType: "image/jpeg",
              fileSize: 8,
              clientId: `bad-${i}`,
              meta: { album: junk },
            },
            a.token,
          ),
        );
      }
      const dkey = await upload("doc.jpg", "image/jpeg");
      const doc = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: dkey,
          fileName: "doc.jpg",
          fileType: "image/jpeg",
          fileSize: 8,
          clientId: "alb-doc",
          meta: { document: true, album },
        },
        a.token,
      );
      const vkey = await upload("v.m4a", "audio/mp4");
      const voice = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: vkey,
          fileName: "voice.m4a",
          fileType: "audio/mp4",
          fileSize: 8,
          clientId: "alb-voice",
          meta: { voice: true, seconds: 2, album },
        },
        a.token,
      );
      const text = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        { kind: "TEXT", body: "hi", clientId: "alb-text", meta: { album } },
        a.token,
      );
      const pkey = await upload("f.pdf", "application/pdf");
      const pdf = await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        {
          kind: "FILE",
          fileKey: pkey,
          fileName: "f.pdf",
          fileType: "application/pdf",
          fileSize: 8,
          clientId: "alb-pdf",
          meta: { album },
        },
        a.token,
      );
      check(
        "r31-29: the album id is pinned to `alb_` + 4..36 url-safe chars and only on a photo row — wrong shapes, a document, a voice note, a pdf and a text all send WITHOUT it",
        bad.every((r) => r.status === 201 && r.json.message?.meta?.album === undefined) &&
          pdf.status === 201 &&
          pdf.json.message?.meta?.album === undefined &&
          doc.status === 201 &&
          doc.json.message?.meta?.album === undefined &&
          doc.json.message?.meta?.document === true &&
          voice.status === 201 &&
          voice.json.message?.meta?.album === undefined &&
          text.status === 201 &&
          text.json.message?.meta?.album === undefined,
        `bad=${bad.map((r) => JSON.stringify(r.json.message?.meta?.album)).join("|")} doc=${JSON.stringify(doc.json.message?.meta)}`,
      );
      const src = readFileSync("src/worker/index.ts", "utf8");
      check(
        "r31-29: worker — ONE helper (albumId) with a named regex feeds the meta; msgFrom types it",
        src.includes("const ALBUM_ID_RE = /^alb_[A-Za-z0-9_-]{4,36}$/;") &&
          src.includes(
            'const album = albumId(kind, imageData ?? fileKey, String(body.fileType || ""), incomingMeta);',
          ) &&
          src.includes(
            'if (kind !== "IMAGE" && !(kind === "FILE" && fileType.startsWith("image/"))) return null;',
          ) &&
          src.includes("...(album ? { album } : {}),") &&
          src.includes("if (meta.document === true || meta.voice === true) return null;") &&
          src.includes("album?: string;"),
      );
    }
    check(
      "r31-29: app — the grid send stamps ONE album id on 2+ photos (single photo: none), the pending row + both payloads carry it, a retry keeps it, forwarding 2+ photos re-groups them",
      chat.includes("internal fun newAlbumId(): String =") &&
        chat.includes("val album = if (photos >= 2) newAlbumId() else null") &&
        chat.includes("fun sendImage(dataUrl: String, album: String? = null) {") &&
        chat.includes('if (album != null) o.put("album", album)') &&
        chat.includes('.also { row -> metaWith(0, 0)?.let { row.put("meta", it) } }') &&
        (chat.match(/metaWith\(shotW, shotH\)\?\.let \{ payload\.put\("meta", it\) \}/g) || [])
          .length === 2 &&
        chat.includes("fun handleImagePicked(uri: Uri, album: String? = null) {") &&
        chat.includes(
          'url.isNotBlank() -> sendImage(url, p.optJSONObject("meta")?.optString("album")?.ifBlank { null })',
        ) &&
        chat.includes("val grouped = items.count { isPhotoMsg(it) } >= 2") &&
        (chat.match(/albumMeta\?\.let \{ body\.put\("meta", it\) \}/g) || []).length === 3,
    );
    check(
      "r31-29: app — rows sharing meta.album fold into ONE list row (foldAlbums; a group of one stays a photo), drawn by AlbumMessageRow: 2 side by side, 3 = tall + two stacked, 4 = 2×2, 5+ = three tiles + a dimmed fourth 'See all' opening a 4-per-row sheet; select/forward/unsend/delete act on the whole album",
      chat.includes("internal fun foldAlbums(rows: List<JSONObject>): List<JSONObject> {") &&
        chat.includes("if (g.size < 2) {") &&
        chat.includes('copy.put("kpAlbum", JSONArray(g))') &&
        chat.includes("androidx.compose.runtime.derivedStateOf { foldAlbums(visibleMsgs) }") &&
        chat.includes("groupedMsgs,\n                    key = {") &&
        chat.includes('if (m.has("kpAlbum")) {') &&
        chat.includes("private fun AlbumMessageRow(") &&
        chat.includes(
          "photos.size == 2 -> Row(horizontalArrangement = Arrangement.spacedBy(gap)) {",
        ) &&
        chat.includes("photos.size == 3 -> Row(") &&
        chat.includes(
          "photos.size == 4 -> Column(verticalArrangement = Arrangement.spacedBy(gap)) {",
        ) &&
        chat.includes("photos.chunked(2).forEach { pair ->") &&
        chat.includes("photos.take(3).forEach { p ->") &&
        chat.includes('label = "See all",') &&
        chat.includes(
          "private fun AlbumSheet(photos: List<JSONObject>, onClose: () -> Unit, onOpen: (JSONObject) -> Unit) {",
        ) &&
        chat.includes("photos.chunked(4).forEach { row ->") &&
        chat.includes('val albumIds = albumPhotos(m).map { it.optString("id") }') &&
        (chat.match(/selected\.addAll\(albumIds\)/g) || []).length === 3 &&
        chat.includes("if (ids.first() in selected) selected.removeAll(ids.toSet())"),
    );

    // r31-30: the status share screen — full-bleed dark stage, Close on top, ONE
    // Send button, no caption bar; video trim (first minute preselected, window
    // slides anywhere, never over a minute) + crop for photo AND video; the
    // clip is cut on the phone (GPU re-encode, sample-copy fallback) and only
    // the result is uploaded.
    {
      const share = kt("StatusPhotoScreen.kt");
      const exp = kt("VideoExport.kt");
      const plan = readFileSync(
        "native-android/app/src/test/java/app/kuchupuchu/android/VideoPlanTest.kt",
        "utf8",
      );
      check(
        "r31-30: share screen — no caption field / Post / 'Choose photo or video' buttons; dark stage + Close + one Send; the >60s rejection is gone",
        !share.includes("OutlinedTextField(") &&
          !share.includes('Text("Caption")') &&
          !share.includes('GoldBtn("Post")') &&
          !share.includes('GoldBtn("Choose photo or video")') &&
          !share.includes("Video status can be at most 1 minute.") &&
          share.includes("Box(Modifier.fillMaxSize().background(Color.Black)) {") &&
          share.includes('Icon(Icons.Filled.Close, "Close", tint = Color.White)') &&
          share.includes('contentDescription = if (cropping) "Done" else "Send",') &&
          share.includes('.put("text", ""),'),
      );
      check(
        "r31-30: video — first minute preselected (VideoPlan.defaultWindow), a trim strip with slide/start/end handles, a crop overlay with Original/9:16/1:1/Free, the cut clip's real length goes up as `seconds`",
        share.includes("val (s, e) = VideoPlan.defaultWindow(src.durationMs)") &&
          share.includes("private fun TrimStrip(") &&
          // r32-43: the drag is absolute (window at touch-down + total travel)
          share.includes("1 -> VideoPlan.moveStart(grabS, grabE, durationMs, grabS + deltaMs)") &&
          share.includes("2 -> VideoPlan.moveEnd(grabS, grabE, durationMs, grabE + deltaMs)") &&
          share.includes("3 -> VideoPlan.slide(grabS, grabE, durationMs, deltaMs)") &&
          share.includes("private fun CropOverlay(") &&
          share.includes('listOf("Original", "9:16", "1:1", "Free").forEach { name ->') &&
          share.includes('.put("seconds", ((e - s + 500L) / 1000L).toInt().coerceAtLeast(1))') &&
          share.includes("VideoExport.export(ctx, uri, start, end, crop, out)") &&
          share.includes("VideoExport.passthrough(ctx, uri, start, end, out)") &&
          share.includes(
            "if (!VideoPlan.needsTranscode(crop, start, end, src.durationMs, size, mime)) {",
          ),
      );
      check(
        "r31-30: VideoExport — MediaExtractor → MediaCodec decoder on a GL texture → crop/rotate quad → surface encoder → MediaMuxer, audio copied inside the window; MAX_STATUS_MS = 60_000; the JVM test pins the maths",
        exp.includes("const val MAX_STATUS_MS = 60_000L") &&
          exp.includes("fun texCoords(rotation: Int, crop: CropBox?): FloatArray {") &&
          exp.includes("vf.setInteger(MediaFormat.KEY_ROTATION, 0)") &&
          exp.includes("MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface") &&
          exp.includes("enc.createInputSurface()") &&
          exp.includes("EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, ptsNs)") &&
          exp.includes("val render = info.size > 0 && pts >= startUs && pts <= endUs") &&
          exp.includes("copyAudio(ctx, uri, audioTrack, audioMuxTrack, startUs, endUs, mux)") &&
          exp.includes(
            "fun passthrough(ctx: Context, uri: Uri, startMs: Long, endMs: Long, out: File) {",
          ) &&
          plan.includes("class VideoPlanTest") &&
          plan.includes("VideoPlan.defaultWindow(185_000L)"),
      );
      check(
        "r31-30: the status viewer honours the rotation tag when sizing the clip box",
        kt("StatusScreens.kt").includes(
          "if (w > 0f && h > 0f) aspect = if (rot == 90 || rot == 270) h / w else w / h",
        ),
      );
    }

    // r31-31: the status screen's "choose photo" / video buttons are gone — ONE
    // media icon (bottom-centre) opens the app's OWN gallery (StatusPickScreen,
    // sharing the attach panel's pool + cells), and one tap there lands on the
    // share screen with that item (no system picker anywhere in the flow).
    {
      const pick = kt("StatusPickScreen.kt");
      const statusScreens = kt("StatusScreens.kt");
      const share = kt("StatusPhotoScreen.kt");
      const app = kt("KpApp.kt");
      const at = kt("AttachSheet.kt");
      check(
        "r31-31: status screen — one PhotoLibrary FAB at BottomCenter → statuspick; the camera FAB and every statusphoto entry are gone",
        statusScreens.includes(".align(Alignment.BottomCenter)") &&
          statusScreens.includes(
            'Icon(Icons.Filled.PhotoLibrary, contentDescription = "Media status"',
          ) &&
          (statusScreens.match(/nav\.navigate\("statuspick"\)/g) || []).length === 3 &&
          !statusScreens.includes("PhotoCamera") &&
          !statusScreens.includes('nav.navigate("statusphoto")'),
      );
      check(
        "r31-31: the picker IS the app gallery — loadMediaPool + MediaCell from the attach panel, folder chips, 4 columns, one tap → statusphoto/{arg} replacing the picker; no system picker in the picker or the share screen",
        at.includes(
          "internal fun loadMediaPool(ctx: android.content.Context): List<MediaItem> {",
        ) &&
          at.includes("internal fun MediaCell(") &&
          pick.includes(
            "pool = withContext(Dispatchers.IO) { runCatching { loadMediaPool(ctx) }.getOrDefault(emptyList()) }",
          ) &&
          pick.includes("columns = GridCells.Fixed(4),") &&
          pick.includes('nav.navigate("statusphoto/" + statusPickArg(item)) {') &&
          pick.includes('popUpTo("statuspick") { inclusive = true }') &&
          pick.includes("internal fun statusPickArg(item: MediaItem): String =") &&
          pick.includes(
            "internal fun statusPickDecode(arg: String): Pair<android.net.Uri, Boolean>? =",
          ) &&
          !pick.includes("PickVisualMedia") &&
          !share.includes("PickVisualMedia") &&
          !share.includes("rememberLauncherForActivityResult") &&
          share.includes(
            "fun StatusPhotoScreen(nav: NavController, pickedUri: Uri, pickedIsVideo: Boolean) {",
          ) &&
          app.includes('composable("statuspick") { StatusPickScreen(nav) }') &&
          app.includes('composable("statusphoto/{arg}") { entry ->'),
      );
    }

    // r31-32/33: with a call connected, reopening the app does NOT jump into
    // the call — only the ongoing card's tap (kp_return_call) / Accept do;
    // instead a "Return to call" strip with the live timer sits above EVERY
    // screen while the call UI is minimised, one tap restores it.
    {
      const act = kt("MainActivity.kt");
      const app = kt("KpApp.kt");
      const cs = kt("CallScreens.kt");
      const cn = kt("CallNotify.kt");
      const resume = act.slice(
        act.indexOf("override fun onResume"),
        act.indexOf("override fun onPause"),
      );
      check(
        "r31-32: onResume never restores the call UI (syncNow only when there is no call); handleIntent restores it ONLY for kp_return_call (r32-9: through the companion, which queues a cold-start tap); the ongoing card's tap carries that flag; the ring path still un-minimizes",
        !resume.includes("restoreCallUi()") &&
          resume.includes("if (engine.active == null) engine.syncNow()") &&
          act.includes(
            'if (intent.getBooleanExtra("kp_return_call", false)) CallEngine.onRestoreIntent()',
          ) &&
          !act.includes("restoreCallUi()") &&
          (kt("CallEngine.kt").match(/e\.restoreCallUi\(\)/g) || []).length === 1 &&
          cn.includes('.putExtra("kp_return_call", true),') &&
          kt("CallEngine.kt").includes(
            "minimized = false\n                // Sweep the plain FCM payload card ONCE",
          ),
      );
      check(
        "r31-33: ReturnToCallBanner — composes only while a call is live AND minimised; Green strip, Call/Videocam icon, 'Return to call', live clock (Ringing / Calling… / Connecting… / On hold states); tap = restoreCallUi; mounted ABOVE the NavHost for every screen and it takes over the status-bar inset",
        cs.includes("fun ReturnToCallBanner() {") &&
          cs.includes("if (!engine.minimized) return") &&
          cs.includes('"Return to call",') &&
          cs.includes("else -> clockText(secs)") &&
          cs.includes('engine.onHold -> "On hold"') &&
          cs.includes("engine.restoreCallUi()\n            }\n            .statusBarsPadding()") &&
          app.includes("ReturnToCallBanner()\n              Box(") &&
          app.includes(
            "val bannerUp = callEngine != null && callEngine.active != null && callEngine.minimized",
          ) &&
          app.includes(
            ".then(if (bannerUp) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier),",
          ) &&
          app.indexOf("ReturnToCallBanner()") < app.indexOf("NavHost("),
      );
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

// ── r32: owner list ──────────────────────────────────────────────────────────
{
  const kt = (f) =>
    readFileSync(`native-android/app/src/main/java/app/kuchupuchu/android/${f}`, "utf8");
  const manifest = readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8");
  // Items 1A/1B/26: KpPushService was bound to "com.google.firebase.messaging.RECEIVE"
  // — an action the FCM SDK never dispatches (it resolves the app's service by
  // "com.google.firebase.MESSAGING_EVENT"; its own base service sits on that action
  // at priority -500 with an EMPTY onMessageReceived). So no push ever reached
  // handleIntent / onMessageReceived: the rich message card, the missed-call card
  // with Call back / Message, the background ring and the ring-card retraction
  // never ran from a push — only the OS-drawn payload card (generic glyph, no
  // buttons) did. The lock is on the exact service block, not on the string
  // appearing somewhere in the file.
  const svc = manifest.slice(
    manifest.indexOf('android:name=".KpPushService"'),
    manifest.indexOf("</service>", manifest.indexOf('android:name=".KpPushService"')),
  );
  check(
    "r32-26: KpPushService is bound to com.google.firebase.MESSAGING_EVENT (the only action the FCM SDK dispatches) and not to the phantom messaging.RECEIVE action",
    svc.includes('<action android:name="com.google.firebase.MESSAGING_EVENT" />') &&
      !/<action android:name="com\.google\.firebase\.messaging\.RECEIVE"/.test(manifest),
    svc.replace(/\s+/g, " ").slice(0, 200),
  );
  check(
    "r32-26: OS-drawn payload cards use the brand status icon / colour / message channel by default; Play-services delegation is left ON (the only card an OEM-blocked process can show)",
    manifest.includes(
      'android:name="com.google.firebase.messaging.default_notification_icon"\n            android:resource="@mipmap/ic_stat_kp"',
    ) &&
      manifest.includes(
        'android:name="com.google.firebase.messaging.default_notification_color"\n            android:resource="@color/colorPrimary"',
      ) &&
      manifest.includes(
        'android:name="com.google.firebase.messaging.default_notification_channel_id"\n            android:value="kp_messages_v2"',
      ) &&
      !manifest.includes("firebase_messaging_notification_delegation_enabled"),
  );
  const push = kt("KpPush.kt");
  const omr = push.slice(
    push.indexOf("override fun onMessageReceived(message: RemoteMessage) {"),
    push.indexOf("private fun handleMissedCall("),
  );
  check(
    "r32-26: a push into a freshly started (killed) process restores the session before any handler runs, and a handler throw is contained as a breadcrumb instead of taking the FCM thread down",
    omr.includes("runCatching { Api.loadToken(this) }") &&
      omr.indexOf("runCatching { Api.loadToken(this) }") < omr.indexOf('when (data["type"]) {') &&
      omr.includes(
        '.onFailure { KpCrash.mark("push_${data["type"]}_failed:${it.javaClass.simpleName}") }',
      ),
  );
  const notify = kt("KpNotify.kt");
  check(
    "r32-1A/1B: a refused message / missed-call post is no longer swallowed silently — the runCatching failure branch leaves a breadcrumb (no Log)",
    notify.includes('KpCrash.mark("notify_message_failed:${it.javaClass.simpleName}")') &&
      notify.includes('KpCrash.mark("notify_missed_failed:${it.javaClass.simpleName}")') &&
      !/android\.util\.Log\./.test(notify) &&
      !/\bLog\.[dewiv]\(/.test(notify),
  );
  const src = readFileSync("src/worker/index.ts", "utf8");
  check(
    "r32-26: worker payload cards name the status icon + brand colour, and a call's ring card and missed-call card share one tag (kp_call_<id>) so the OS replaces the stuck 'X is calling' card; the app cancels by (tag, id)",
    src.includes('icon: "ic_stat_kp",\n                            color: "#F59E0B",') &&
      src.includes("...(note.tag ? { tag: note.tag } : {}),") &&
      src.includes("const callTag = (callId: string) => `kp_call_${callId}`;") &&
      src.includes('channel: "kp_calls_v5",\n                tag: callTag(callId),') &&
      src.includes("channel: MISSED_CALL_CHANNEL, tag: callTag(row.id) }") &&
      !src.includes('proxy: "DENY"') &&
      (notify.match(/\.forEach \{ nm\.cancel\(it\.tag, it\.id\) \}/g) || []).length === 2 &&
      !/\.forEach \{ nm\.cancel\(it\.id\) \}/.test(notify),
  );
  // Item 9: the call screen "sometimes" did not open — three cold-start holes.
  // (a) CallEngine.instance was a plain @Volatile var read during composition:
  // CallGate composed against null before the starter thread built the engine
  // and was never told it changed. (b) An Accept / return-to-call tap that
  // reached handleIntent before the engine existed was `instance?.let { }` —
  // a silent no-op. (c) Android 14+ makes USE_FULL_SCREEN_INTENT a special
  // access; without it the ring card cannot take the screen.
  const eng = kt("CallEngine.kt");
  const act = kt("MainActivity.kt");
  const settings = kt("SettingsScreen.kt");
  check(
    "r32-9: CallEngine.instance is Compose state (private set); Accept / return-to-call taps go through the companion, are queued when the engine is not built yet and replayed on start(); a ring-card tap asks for an immediate sync",
    eng.includes(
      "var instance: CallEngine? by mutableStateOf<CallEngine?>(null)\n            private set",
    ) &&
      !/@Volatile\s+var instance/.test(eng) &&
      eng.includes("fun onAcceptIntent() {") &&
      eng.includes("fun onRestoreIntent() {") &&
      eng.includes("internal fun replayPendingIntents() {") &&
      eng.includes("polling = true\n") &&
      eng.indexOf("replayPendingIntents()\n", eng.indexOf("polling = true\n")) -
        eng.indexOf("polling = true\n") <
        400 &&
      act.includes('if (intent.getBooleanExtra("kp_accept", false)) CallEngine.onAcceptIntent()') &&
      act.includes(
        'if (intent.hasExtra("kp_call") || intent.action == CALL_ACCEPT) CallEngine.instance?.syncNow()',
      ) &&
      !act.includes("it.pendingAccept = true"),
  );
  check(
    "r32-9: Permissions screen (API 34+) shows a 'Full-screen calls' toggle backed by canUseFullScreenIntent(), deep-linking to ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT for this package",
    settings.includes(".canUseFullScreenIntent()") &&
      settings.includes('ToggleRow(Icons.Filled.Call, "Full-screen calls", fsi)') &&
      settings.includes("android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT") &&
      settings.includes("if (android.os.Build.VERSION.SDK_INT >= 34) {"),
  );
  // Item 1C: Install did nothing. PackageInstaller.commit() does not show the
  // system confirm sheet by itself — it answers STATUS_PENDING_USER_ACTION with
  // the confirmation activity in EXTRA_INTENT, which the status receiver must
  // start; ours only handled STATUS_SUCCESS. And on Android 8+ the per-source
  // "install unknown apps" grant is required before commit() is honoured.
  const upd = kt("KpUpdate.kt");
  const rx = upd.slice(upd.indexOf("class KpUpdateReceiver"));
  check(
    "r32-1C: the installer receiver starts the EXTRA_INTENT confirm sheet on STATUS_PENDING_USER_ACTION, keeps the APK on a dismissed sheet, and surfaces other failures via downloadError; installReady() routes a missing 'install unknown apps' grant to ACTION_MANAGE_UNKNOWN_APP_SOURCES for this package",
    rx.includes("PackageInstaller.STATUS_PENDING_USER_ACTION -> {") &&
      rx.includes("intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)") &&
      rx.includes("ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))") &&
      rx.includes("PackageInstaller.STATUS_FAILURE_ABORTED -> {}") &&
      rx.includes("intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)") &&
      upd.includes("!ctx.packageManager.canRequestPackageInstalls()") &&
      upd.includes("android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES") &&
      upd.indexOf("canRequestPackageInstalls()") <
        upd.indexOf("withContext(Dispatchers.IO) { install(ctx, apk) }"),
  );
  // Item 27 (owner: Decline ONLY — Approve stays inside the app): the login
  // alert push carries the request id; the card swaps Like for Decline; the
  // receiver posts /api/auth/login/decline and marks the chat read.
  const sam = src.slice(
    src.indexOf("async function sendApprovalMessage("),
    src.indexOf("async function resolveApprovalMessage("),
  );
  check(
    "r32-27: login-alert card has a Decline action (no Approve): the push carries kp_login_req; KpNotify adds Decline instead of Like when it is present; the receiver posts /api/auth/login/decline with that id, then marks read; manifest filter declares the action",
    sam.includes("kp_login_req: requestId,") &&
      notify.includes("loginRequestId: String? = null,") &&
      notify.includes(".setAction(KpNotifActionReceiver.ACTION_DECLINE_LOGIN)") &&
      notify.includes(
        "if (declineAction != null) addAction(declineAction) else addAction(likeAction)",
      ) &&
      notify.includes(
        'Api.post("/api/auth/login/decline", org.json.JSONObject().put("requestId", req))',
      ) &&
      notify.includes(
        'const val ACTION_DECLINE_LOGIN = "app.kuchupuchu.android.NOTIF_DECLINE_LOGIN"',
      ) &&
      !/"Approve"/.test(notify) &&
      push.includes('loginRequestId = data["kp_login_req"],') &&
      manifest.includes('<action android:name="app.kuchupuchu.android.NOTIF_DECLINE_LOGIN" />'),
  );
  // Item 48: multi-photo sent ONE photo. LazyListState.animateScrollToItem is
  // a scroll mutation: the next scroll cancels the coroutine that owns the
  // previous one (CancellationException at that suspension point). sendImage
  // ran the jump-to-bottom INLINE ahead of the upload, so photo #2's launch
  // killed photo #1's coroutine before its upload began, #3 killed #2… and only
  // the last photo of an album ever reached the server. The scroll now lives in
  // its own coroutine (text / voice too), no upload path awaits a scroll, and
  // the grid batch reads photos in selection order.
  const chat32 = kt("ChatScreen.kt");
  const sendImageBody = chat32.slice(
    chat32.indexOf("fun sendImage(dataUrl: String, album: String? = null) {"),
    chat32.indexOf("fun sendFile(name: String, mime: String, file: File"),
  );
  const sendVoiceBody = chat32.slice(
    chat32.indexOf("fun sendVoice(file: File, seconds: Int"),
    chat32.indexOf("fun handleImagePicked("),
  );
  const sendTextBody = chat32.slice(
    chat32.indexOf('fun sendText(body: String, kind: String = "TEXT") {'),
    chat32.indexOf("fun sendImage(dataUrl: String, album: String? = null) {"),
  );
  check(
    "r32-48: no send path awaits a list scroll — sendImage / sendVoice / sendText launch the jump-to-bottom on a separate coroutine wrapped in runCatching, the upload coroutine never contains animateScrollToItem, and the grid batch decodes photos sequentially in tick order via readAndSendImage",
    sendImageBody.includes(
      "scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }",
    ) &&
      sendVoiceBody.includes(
        "scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }",
      ) &&
      sendTextBody.includes(
        "if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }",
      ) &&
      // the upload coroutine starts with the sound, never with a scroll
      sendImageBody.includes(
        "scope.launch {\n            runCatching { KpSounds.send(ctx) }\n            var shotW = 0",
      ) &&
      sendVoiceBody.includes(
        "scope.launch {\n            runCatching { KpSounds.send(ctx) }\n            try {",
      ) &&
      !/scope\.launch \{\n\s+listState\.animateScrollToItem/.test(chat32) &&
      !/scope\.launch \{\n\s+val total = msgs\.size \+ pending\.size\n\s+if \(total > 0\) listState\.animateScrollToItem/.test(
        chat32,
      ) &&
      chat32.includes("suspend fun readAndSendImage(uri: Uri, album: String?) {") &&
      chat32.includes("scope.launch { readAndSendImage(uri, album) }") &&
      chat32.includes(
        "if (item.isVideo) handleDocumentPicked(item.uri) else readAndSendImage(item.uri, album)",
      ) &&
      // refresh's forced scroll + the AI reveal loop survive an interrupted scroll too
      chat32.includes(
        "runCatching { listState.animateScrollToItem(total - 1) }\n                }\n                lastTopId = newTop",
      ) &&
      chat32.includes(
        "if (nearBottom) runCatching { listState.scrollToItem(info.totalItemsCount - 1) }",
      ),
  );
  // Item 43 / 1D (status share screen) — three real defects, all fixed in place:
  //  (a) the preview "loops back after ~1 s": seekTo(int) lands on the previous
  //      keyframe (seconds before the start handle), the next tick saw
  //      position < start - 1.5 s and seeked again → endless stutter. Seeks are
  //      frame-exact on 26+ (SEEK_CLOSEST), never re-issued while one is in
  //      flight, and where a seek landed is the loop floor;
  //  (b) "handles imprecise": 40 px hit zone → 24 dp, nearer handle wins, the
  //      drag is absolute (window at touch-down + travel) and the held handle
  //      scrubs the preview to its exact frame;
  //  (c) "Free crop box can't be moved": the pointerInput block captured the
  //      `box` it was created with (keyed only on lock/aspect), so each drag
  //      moved that stale copy — the block now reads the box through
  //      rememberUpdatedState.
  const share32 = kt("StatusPhotoScreen.kt");
  const playerCls = share32.slice(
    share32.indexOf("private class TrimClipPlayer("),
    share32.indexOf("private fun TrimStrip("),
  );
  const stripFn = share32.slice(
    share32.indexOf("private fun TrimStrip("),
    share32.indexOf("private fun CropOverlay("),
  );
  const cropFn = share32.slice(share32.indexOf("private fun CropOverlay("));
  check(
    "r32-43: trim preview — frame-exact seeks (SEEK_CLOSEST on 26+), a seek in flight is never re-issued, the loop floor is where the last seek landed, a paused/scrubbed picture never loops, and the scrubbed handle's frame is shown while the finger is down",
    playerCls.includes("p.seekTo(ms, android.media.MediaPlayer.SEEK_CLOSEST)") &&
      playerCls.includes("setOnSeekCompleteListener { p ->") &&
      playerCls.includes("if (seeking) return") &&
      playerCls.includes("if (wantPaused) return") &&
      playerCls.includes(
        "if (pos >= endMs || pos < minOf(startMs, landedAt) - 1_000L) seek(m, startMs)",
      ) &&
      !playerCls.includes("m.currentPosition < startMs - 1500L") &&
      playerCls.includes("fun setWindow(s: Long, e: Long, scrubTo: Long = -1L) {") &&
      share32.includes(
        "LaunchedEffect(player, start, end, scrubAt) { player?.setWindow(start, end, scrubAt ?: -1L) }",
      ) &&
      share32.includes("player?.setPaused(paused || userPaused || scrubAt != null)") &&
      share32.includes(
        "StatusTrimPreview(pickedUri, start, end, paused = cropping, scrubAt = scrub)",
      ),
  );
  check(
    "r32-43: trim handles — 24 dp grab zone, the nearer handle wins, absolute drag maths (grabS/grabE + travel), the held handle reports its clip position via onScrub (null on release), 10 dp handle pills",
    stripFn.includes("val grabPx = with(LocalDensity.current) { 24.dp.toPx() }") &&
      stripFn.includes("ds <= grabPx && ds <= de -> 1") &&
      stripFn.includes("de <= grabPx -> 2") &&
      stripFn.includes("travel += drag.x") &&
      stripFn.includes("val deltaMs = (travel / widthPx * total).toLong()") &&
      stripFn.includes("if (mode != 0) scrubCb.value(if (mode == 2) e else s)") &&
      stripFn.includes("scrubCb.value(null)") &&
      stripFn.includes("val hw = 10.dp.toPx()") &&
      !stripFn.includes("val grab = 40f") &&
      share32.includes("onScrub = { scrub = it },"),
  );
  check(
    "r32-43: Free crop box moves — CropOverlay reads the CURRENT box / callback through rememberUpdatedState inside its pointerInput (no stale capture), 28 dp corner grab",
    cropFn.includes("val current = rememberUpdatedState(box)") &&
      cropFn.includes("val changeCb = rememberUpdatedState(onChange)") &&
      cropFn.includes("val b = current.value") &&
      cropFn.includes("1 -> changeCb.value(b.moved(dx, dy))") &&
      cropFn.includes("in 2..5 -> changeCb.value(b.resized(corner, dx, dy, lock, boxAspect))") &&
      cropFn.includes("val grabPx = with(LocalDensity.current) { 28.dp.toPx() }") &&
      !cropFn.includes("1 -> onChange(box.moved(dx, dy))"),
  );
  // Item 28: a message sent while the recipient was offline stayed on ONE tick
  // until the recipient opened that exact chat. The recipient's device being
  // reachable again IS delivery now: the list poll + the /ws/user connect stamp
  // every undelivered inbound row (markInboxDelivered) and tell the senders
  // (room "delivered" + a SILENT list poke — no msg:1, so no false message
  // sound); the list payload carries the newest message's sender + delivery
  // stamp and the list row draws sent / delivered / read from it. Behaviour is
  // driven end-to-end in test 09; this pins the wiring + the D1 cost shape.
  const chatList32 = kt("ChatListScreen.kt");
  check(
    "r32-28: worker — markInboxDelivered is called from GET /api/conversations and /ws/user (off the response path), scans only the caller's chats over the partial undelivered index, updates in 44-id chunks, and pokes senders via pokeUserReceipt (no msg:1)",
    src.includes("async function markInboxDelivered(") &&
      (
        src.match(
          /ctx\.waitUntil\(markInboxDelivered\(env, db, ctx, uid\)\.catch\(\(\) => 0\)\);/g,
        ) || []
      ).length === 2 &&
      src.includes(
        "CREATE INDEX IF NOT EXISTS idx_messages_undelivered ON messages(conv_id, created_at) WHERE delivered_at IS NULL",
      ) &&
      src.includes("WHERE conv_id IN (SELECT conv_id FROM members WHERE user_id = ?)") &&
      src.includes("for (const group of chunked(rows.map((r) => r.id))) {") &&
      src.includes("async function pokeUserReceipt(") &&
      src.includes('body: JSON.stringify({ type: "conv", conversationId, at, receipt: 1 }),') &&
      !src.includes("ctx.waitUntil(pokeUserConversation(env, senderId, convId, deliveredAt));"),
  );
  check(
    "r32-28: list payload carries lastMessageSenderId / lastMessageDeliveredAt (one correlated newest-row seek per chat, no GROUP BY scan), both in the freshness marker with the members' lastReadAt; the single-chat detail carries the same",
    src.includes("lastMessageSenderId: conv.last_message_sender_id ?? null,") &&
      src.includes("lastMessageDeliveredAt: conv.last_message_delivered_at ?? null,") &&
      src.includes(
        "SELECT rowid FROM messages WHERE conv_id = j.value ORDER BY created_at DESC LIMIT 1",
      ) &&
      !src.includes("MAX(created_at) AS created_at") &&
      src.includes("c.lastMessageDeliveredAt,") &&
      src.includes(
        "SELECT sender_id, delivered_at FROM messages WHERE conv_id = ? ORDER BY created_at DESC LIMIT 1",
      ),
  );
  check(
    "r32-28: app — list row ticks have the delivered (two grey) step and read the newest message's sender / delivery stamp from the list payload (cached page only as a fallback)",
    chatList32.includes("private fun ListTicks(read: Boolean, delivered: Boolean = read) {") &&
      chatList32.includes("if (read || delivered) {") &&
      chatList32.includes(
        'val newestSender = conv.optString("lastMessageSenderId").ifBlank { lastMsg?.optString("senderId").orEmpty() }',
      ) &&
      chatList32.includes('conv.optString("lastMessageDeliveredAt").isNotBlank() ||') &&
      chatList32.includes(
        "ListTicks(read = otherRead.isNotBlank() && otherRead >= newestAt, delivered = delivered)",
      ),
  );
  // Items 1 + 2 (Settings › Privacy): every privacy sheet is phrased as the
  // question it answers; the screen-share audio toggle moved here from App.
  const priv32 = settings.slice(
    settings.indexOf("fun PrivacySettingsScreen("),
    settings.indexOf("fun AppearanceSettingsScreen("),
  );
  const app32 = settings.slice(settings.indexOf("fun AppSettingsScreen("));
  check(
    "r32-1: every privacy picker sheet title is a question — number / profile picture / messages / last seen / groups",
    priv32.includes('"privPhone" -> "Who Can View Your Number?"') &&
      priv32.includes('"privAvatar" -> "Who Can View Your Profile Picture?"') &&
      priv32.includes('"privMessages" -> "Who Can Message You?"') &&
      priv32.includes('"privLastSeen" -> "Who Can See Your Last Seen?"') &&
      priv32.includes('else -> "Who Can Add You To Groups?"') &&
      !priv32.includes('"privPhone" -> "My number"'),
  );
  check(
    "r32-2: 'Share Audio Via Screen Share' toggle sits under Privacy (after Private profile) and is gone from App",
    priv32.includes(
      'ToggleRow(Icons.Filled.VolumeUp, "Share Audio Via Screen Share", sysAudio) { on ->',
    ) &&
      priv32.indexOf('"Private profile"') < priv32.indexOf('"Share Audio Via Screen Share"') &&
      !app32.includes("SystemAudioTap") &&
      !settings.includes('"Share audio via screen share"'),
  );
  // Items 15 + 16: no "edited" marker anywhere; "Unsend" wording is gone —
  // the action is "Delete for everyone" (sheet row + selection bar).
  const chat1516 = kt("ChatScreen.kt");
  check(
    "r32-15: no 'edited' / '(edited)' label on any bubble; the emoji-only rule no longer keys on the edited flag",
    !chat1516.includes("(edited)") &&
      !/"Edited"|"edited "|" edited"/.test(chat1516) &&
      chat1516.includes(
        'val emojiOnly = if (kind == "TEXT") emojiOnlyCount(m.optText("body")) else 0',
      ) &&
      !chat1516.includes('!m.optBoolean("edited")) emojiOnlyCount'),
  );
  check(
    "r32-16: the own-message action reads 'Delete for everyone' (long-press sheet + selection bar); no user-facing 'Unsend' string remains",
    chat1516.includes(
      'KpSheetRow(Icons.Filled.DeleteForever, "Delete for everyone", tint = Red) {',
    ) &&
      chat1516.includes(
        'Icon(Icons.Filled.DeleteForever, "Delete for everyone", tint = Red, modifier = Modifier.size(21.dp))',
      ) &&
      !/"Unsend[^"]*"/.test(chat1516),
  );
  // Item 21: a status reply used to arrive as "> null\n<text>" (the client
  // prefixed the status caption, null for a photo). The reply now carries
  // meta.status (server-verified id / kind / text — test 03 drives it) and the
  // bubble draws a small quote: thumbnail for photo / video, caption for text.
  // Item 22: the quoted-original block (in the bubble AND the composer bar) is
  // one compact line — "You  hello" — with a 20 / 22 dp stripe.
  const statusKt32 = kt("StatusScreens.kt");
  check(
    "r32-21: status reply sends body + meta.status.id (no client-built '> caption' prefix); the bubble renders StatusQuote with a 34 dp thumbnail from /api/statuses/:id/media (play glyph for video) or the caption / kind label — never 'null'",
    statusKt32.includes(
      'if (statusId.isNotBlank()) payload.put("meta", JSONObject().put("status", JSONObject().put("id", statusId)))',
    ) &&
      !statusKt32.includes('"> $snippet\\n$text"') &&
      chat1516.includes(
        "private fun StatusQuote(st: JSONObject, mine: Boolean, theme: String) {",
      ) &&
      chat1516.includes('m.optJSONObject("meta")?.optJSONObject("status")?.let { st ->') &&
      chat1516.includes('"/api/statuses/${st.optString("id")}/media",') &&
      chat1516.includes(
        "Box(Modifier.size(34.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x22000000))) {",
      ) &&
      src.includes("async function statusQuote(") &&
      src.includes("...(await statusQuote(db, kind, incomingMeta)),"),
  );
  check(
    "r32-22: compact reply preview — in-bubble quote is ONE annotated line (name bold + text) with a 20 dp stripe and 3 dp vertical padding; the composer's ReplyQuoteBar is one line with a 22 dp stripe",
    chat1516.includes(
      "Box(Modifier.width(2.5.dp).height(20.dp).clip(RoundedCornerShape(2.dp)).background(chatAccent(theme)))",
    ) &&
      chat1516.includes(".padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),") &&
      (chat1516.match(/withStyle\(SpanStyle\(fontWeight = FontWeight\.SemiBold\)\)/g) || [])
        .length >= 2 &&
      !chat1516.includes("Box(Modifier.width(2.5.dp).height(26.dp)") &&
      !chat1516.includes(".height(30.dp)\n                .clip(RoundedCornerShape(2.dp))") &&
      chat1516.includes(".height(22.dp)\n                .clip(RoundedCornerShape(2.dp))"),
  );
  // Item 8: an emoji-only message has NO bubble (no lift, no fill, no 72 dp
  // minimum); the stamp sits in the band under the glyph in the wallpaper's
  // ink, and the ticks follow that ink so they never vanish on a light theme.
  check(
    "r32-8: emoji-only TEXT → transparent bubble (no shadow, transparent fill, min width 0), glyph keeps end room for the stamp/ticks, stamp + ticks use the wallpaper ink",
    chat1516.includes(
      ".then(if (emojiOnly > 0) Modifier else Modifier.shadow(2.dp, bubbleShape))",
    ) &&
      chat1516.includes(
        "emojiOnly > 0 -> Brush.linearGradient(listOf(Color.Transparent, Color.Transparent))",
      ) &&
      chat1516.includes(".widthIn(min = if (emojiOnly > 0) 0.dp else 72.dp, max = bubbleMax)") &&
      chat1516.includes(
        "modifier = Modifier.padding(start = 2.dp, end = if (mine) 30.dp else 10.dp, bottom = 3.dp),",
      ) &&
      chat1516.includes("color = if (mine && emojiOnly == 0) Color(0xD9FFFFFF) else stampInk,") &&
      chat1516.includes(
        "TickIcon(m, pendingEcho, otherReadAt, onWallpaper = emojiOnly > 0, ink = stampInk)",
      ) &&
      chat1516.includes("val grey = if (onWallpaper) ink else Color(0xB3FFFFFF)"),
  );
  // Item 39: the no-photo person glyph is centred in the avatar circle.
  check(
    "r32-39: KpAvatar placeholder glyph is centred (Alignment.Center, 62 % of the circle), not pinned to the bottom edge",
    kt("Ui.kt").includes(
      ".size(inner * 0.62f)\n                        .align(Alignment.Center),",
    ) &&
      !kt("Ui.kt").includes(
        ".size(inner * 0.75f)\n                        .align(Alignment.BottomCenter),",
      ),
  );
  // Items 6 / 7 / 25: the peer profile's actions are ONE ⋮ sheet — Add contact
  // (only when not in the phone book) / Block-Unblock / Hide-Unhide /
  // Mute-Unmute / Report; the body Block button is gone; Blocklist (unblock)
  // sits under Settings › Privacy; the owner's profile shows calls and has no
  // Block row (and the worker refuses the POST — test 17 drives it).
  const profile32 = kt("ProfileScreen.kt");
  const menu32 = profile32.slice(
    profile32.indexOf("if (moreOpen && user != null) {"),
    profile32.indexOf("if (confirmReport) {"),
  );
  check(
    "r32-6: profile ⋮ → KpSheet with Add contact (only when !inBook) / Block-Unblock (never for owner or bots) / Hide-Unhide / Mute-Unmute / Report (confirm sheet → POST /api/reports)",
    profile32.includes('Icon(Icons.Filled.MoreVert, "More", tint = Ink)') &&
      menu32.includes("KpSheet(onDismiss = { moreOpen = false }) {") &&
      menu32.includes(
        'if (!inBook) {\n                    KpSheetRow(Icons.Filled.PersonAdd, "Add contact") {',
      ) &&
      menu32.includes(
        'KpSheetRow(Icons.Filled.Block, if (blocked) "Unblock" else "Block", tint = Red) {',
      ) &&
      menu32.includes("if (!unblockable) {") &&
      menu32.includes(
        'KpSheetRow(Icons.Filled.VisibilityOff, if (hidden) "Unhide" else "Hide") {',
      ) &&
      menu32.includes(
        'KpSheetRow(Icons.Filled.NotificationsOff, if (muted) "Unmute" else "Mute") {',
      ) &&
      menu32.includes('KpSheetRow(Icons.Filled.Flag, "Report", tint = Red) {') &&
      profile32.includes('title = "Report this account?",') &&
      profile32.includes('Api.post("/api/reports", JSONObject().put("userId", userId))') &&
      profile32.includes(
        'val unblockable = isMe || isKpBot(userId) || user?.optText("username") == "rabbihossainltd"',
      ) &&
      !profile32.includes(
        "androidx.compose.material3.TextButton(\n                    onClick = {\n                        scope.launch {\n                            runCatching {\n                                val res = withContext(Dispatchers.IO) {\n                                    if (blocked) Api.delete",
      ) &&
      // exactly one Block CONTROL (the sheet row) — comments aside
      (profile32.match(/else "Block"/g) || []).length === 1 &&
      !profile32.includes(
        "androidx.compose.material3.TextButton(\n                    onClick = {\n                        scope.launch {",
      ),
  );
  check(
    "r32-7: Settings › Privacy has a Blocklist row → settings/blocklist (BlocklistScreen: GET /api/blocks, Unblock per row → DELETE /api/blocks/:id)",
    settings.includes(
      'SettingRow(Icons.Filled.Block, "Blocklist", "") { nav.navigate("settings/blocklist") }',
    ) &&
      settings.includes("fun BlocklistScreen(nav: NavController) {") &&
      settings.includes('Api.get("/api/blocks", true) }.arr("users").objects()') &&
      settings.includes('Api.delete("/api/blocks/$id")') &&
      settings.includes('Text("Unblock", color = Red, fontSize = 13.sp, maxLines = 1)') &&
      kt("KpApp.kt").includes('composable("settings/blocklist") { BlocklistScreen(nav) }') &&
      src.includes('"SELECT target_id FROM blocks WHERE owner_id = ? ORDER BY created_at DESC"') &&
      src.includes("if (user) list.push(userFrom(user, false, true));"),
  );
  // Item 4: the device row shows IP · place · "Signed in <when>" under the
  // name line. The worker stores ip/city/country per auth_devices row at every
  // device transfer and refreshes them on the throttled presence tick.
  check(
    "r32-4: Devices rows show IP · place · signed-in time (worker stores auth_devices.ip/city/country, refreshed with last_seen_at)",
    settings.includes('val ip = d.optText("ip")') &&
      settings.includes('val place = d.optText("place")') &&
      settings.includes('val signedIn = deviceSeen(d.optText("signedInAt"))') &&
      settings.includes('append("Signed in $signedIn")') &&
      src.includes("ALTER TABLE auth_devices ADD COLUMN ip TEXT") &&
      src.includes("ip = excluded.ip, city = excluded.city, country = excluded.country") &&
      src.includes(
        "UPDATE auth_devices SET last_seen_at = ?, ip = COALESCE(?, ip), city = COALESCE(?, city), country = COALESCE(?, country)",
      ) &&
      src.includes('place: [r.city, r.country].filter(Boolean).join(", ") || null,') &&
      src.includes("signedInAt: r.created_at,"),
  );
  // Item 10: the voice-call preview card (peer's shared screen) is 16:9 and
  // sits ABOVE the control grid — the block precedes the first action Row.
  {
    const calls = kt("CallScreens.kt");
    const voice = calls.slice(
      calls.indexOf("fun VoiceCallScreen("),
      calls.indexOf("private fun ShareFullscreen("),
    );
    const card = voice.indexOf("if (engine.peerScreen) {");
    const grid = voice.indexOf("/* control grid");
    check(
      "r32-10: voice-call preview card is 16:9 (72% width) and rendered above the action buttons",
      card > 0 &&
        grid > card &&
        voice.includes(".fillMaxWidth(0.72f)\n                        .aspectRatio(16f / 9f)") &&
        !voice.includes("aspectRatio(4f / 3f)"),
      `card=${card} grid=${grid}`,
    );
    // Item 47: no "waiting for video" state and no auto-join. The video
    // screen shows the peer's avatar whenever their picture is not up (their
    // camera announced off, or no frame yet); our camera is never switched on
    // on their behalf.
    const engine = kt("CallEngine.kt");
    check(
      "r32-47: video call — peer camera off shows their avatar (peerCameraOff from the media flags), no 'Waiting for video…' text, autoJoinCamera removed",
      !calls.includes("Waiting for video") &&
        calls.includes("val remoteUp = engine.hasRemote && !engine.peerCameraOff") &&
        calls.includes("val effSwap = swapped && localFeedUp && remoteUp") &&
        calls.includes("if (!remoteUp) {\n") &&
        engine.includes("var peerCameraOff by mutableStateOf(false)") &&
        engine.includes('peerCameraOff = !camera && !screen && kind == "VIDEO"') &&
        engine.includes('if (m.optBoolean("screen") != peerScreen || off != peerCameraOff) {') &&
        !/^\s*(?:if \(camera\) )?autoJoinCamera\(\)\s*$/m.test(engine) &&
        !engine.includes("private fun autoJoinCamera()"),
    );
  }
  // Item 13: the ten light-cream leaks in dark-blue — every one now rides a
  // themed token (ActionBlue family / ChipSelected / the chat accent), which
  // still resolves to the classic gold in light-cream.
  {
    const chat = kt("ChatScreen.kt");
    const login = kt("LoginScreen.kt");
    const hist = kt("AIHistoryScreen.kt");
    const st = kt("SettingsScreen.kt");
    const cl = kt("ChatListScreen.kt");
    const calls = kt("CallScreens.kt");
    check(
      "r32-13: dark-blue leaks fixed — received file/voice controls (chat accent), AI history clock + View, select-mode Forward/Edit, login wait ring + wordmark, theme swatch border, unread badge, call active buttons, owner card email/website",
      chat.includes(
        ".background(if (mine) Color(0x33FFFFFF) else chatAccent(theme).copy(alpha = 0.18f)),",
      ) &&
        chat.includes("tint = if (mine) AmberInk else chatAccent(theme),") &&
        // r32-34: the document row's "Open" label went with its right-hand slot;
        // the received voice controls still ride the chat accent.
        chat.includes("val ink = if (mine) Color.White else chatAccent(theme)") &&
        chat.includes("val docInk = if (mine) AmberInk else chatAccent(theme)") &&
        chat.includes(
          'Icon(Icons.AutoMirrored.Filled.Send, "Forward", tint = ActionBlueDeep, modifier = Modifier.size(21.dp))',
        ) &&
        chat.includes(
          'Icon(Icons.Filled.Edit, "Edit", tint = ActionBlueDeep, modifier = Modifier.size(21.dp))',
        ) &&
        chat.includes(
          ".background(if (rowSelected) ActionBlue.copy(alpha = 0.16f) else Color.Transparent),",
        ) &&
        chat.includes(
          'Icon(Icons.Filled.Email, "Email", tint = ActionBlueDeep, modifier = Modifier.size(14.dp))',
        ) &&
        chat.includes(
          'Icon(Icons.Filled.Language, "Website", tint = ActionBlueDeep, modifier = Modifier.size(14.dp))',
        ) &&
        !chat.includes(
          "private fun OwnerCardIcon(onClick: () -> Unit, icon: @Composable () -> Unit) {\n    Box(\n        Modifier\n            .size(27.dp)\n            .clip(CircleShape)\n            .background(GoldSoft)",
        ) &&
        hist.includes("Icon(Icons.Filled.Schedule, null, tint = ActionBlueDeep)") &&
        hist.includes(
          'Text("View", fontSize = 12.5.sp, color = ActionBlueDeep, fontWeight = FontWeight.SemiBold)',
        ) &&
        !hist.includes("GoldSoft") &&
        login.includes(
          "drawCircle(color = ActionBlue.copy(alpha = ringAlpha), radius = r, style = Stroke(width = 4f))",
        ) &&
        login.includes(
          'withStyle(SpanStyle(color = ActionBlueDeep, fontWeight = FontWeight.ExtraBold)) { append("Puchu") }',
        ) &&
        !/\bGold\b|GoldDeep|GoldSoft/.test(login) &&
        st.includes(
          ".border(1.dp, if (selected) ActionBlue else Line, RoundedCornerShape(16.dp))",
        ) &&
        st.includes(".border(2.dp, if (selected) ActionBlueDeep else Line, CircleShape),") &&
        !st.includes("GoldSoft") &&
        cl.includes(
          ".clip(CircleShape)\n                            .background(ActionBlue)\n                            .padding(horizontal = 6.dp),",
        ) &&
        !cl.includes("AmberInk") &&
        (calls.match(/lerp\(ActionBlue, Color\.White, 0\.3f\)/g) || []).length === 2 &&
        !/\bGold\b/.test(calls),
    );
  }
  // Item 46: the full-screen photo viewer and the video player carry a ⋮ whose
  // sheet is exactly Save / Forward (the old bottom action strip is gone);
  // forwarding runs through ONE off-main helper shared with multi-select.
  {
    const mv = kt("MediaViewer.kt");
    const chat = kt("ChatScreen.kt");
    const tab = kt("ChatMediaScreen.kt");
    check(
      "r32-46: viewer/player ⋮ → sheet = Save / Forward only; one IO forward helper (forwardMessageTo) used by chat select, photo viewer, video player and the media tab",
      mv.includes("internal fun MediaMenuSheet(") &&
        mv.includes(
          'if (onSave != null) KpSheetRow(Icons.Filled.Download, "Save", onClick = onSave)',
        ) &&
        mv.includes(
          'if (onForward != null) KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward", onClick = onForward)',
        ) &&
        (mv.match(/KpSheetRow\(/g) || []).length === 2 &&
        (mv.match(/Icons\.Filled\.MoreVert, "More"/g) || []).length === 2 &&
        !mv.includes("private fun ViewerAction(") &&
        (mv.match(/\.align\(Alignment\.BottomCenter\)/g) || []).length === 1 &&
        mv.includes("onForward = onForward?.let { f -> { menuOpen = false; f() } },") &&
        mv.includes(
          "onForward = if (canForward) ({ menuOpen = false; forwarding = true }) else null,",
        ) &&
        mv.includes("val ok = targets.all { runCatching { forwardMessageTo(it, m) }.isSuccess }") &&
        chat.includes(
          "internal suspend fun forwardMessageTo(targetConvId: String, m: JSONObject, albumMeta: JSONObject? = null) {\n    withContext(Dispatchers.IO) {",
        ) &&
        chat.includes("runCatching { forwardMessageTo(targetConvId, m, meta) }") &&
        chat.includes("internal fun ForwardDialog(") &&
        tab.includes(
          "onForward = if (privateChat) null else ({ viewer = null; forwardMsg = m }),",
        ) &&
        tab.includes("val ok = targets.all { runCatching { forwardMessageTo(it, m) }.isSuccess }"),
    );
  }
  // Item 37: the forward picker is multi-select — rows tick (rounded check),
  // "N selected", a Send bar fires every picked chat; nothing sends on a tap.
  {
    const chat = kt("ChatScreen.kt");
    check(
      "r32-37: forward picker = multi-recipient select (rounded check rows, 'N selected', Send bar) — a row tap never sends; every caller passes onSend(List)",
      chat.includes(
        "internal fun ForwardDialog(onClose: () -> Unit, onSend: (List<String>) -> Unit) {",
      ) &&
        chat.includes("val picked = remember { mutableStateListOf<String>() }") &&
        chat.includes(".clickable { if (on) picked.remove(id) else picked.add(id) }") &&
        chat.includes(
          'if (picked.isEmpty()) "${convs.size} chats" else "${picked.size} selected",',
        ) &&
        chat.includes(
          "if (on) Icon(Icons.Filled.Check, null, tint = ActionBlueInk, modifier = Modifier.size(14.dp))",
        ) &&
        chat.includes(
          'GoldBtn("Send", modifier = Modifier.width(112.dp)) { onSend(picked.toList()) }',
        ) &&
        chat.includes("fun forwardSelected(targets: List<String>) {") &&
        chat.includes(
          "for (targetConvId in targets) {\n                val album = if (grouped) newAlbumId() else null",
        ) &&
        !/ForwardDialog\([\s\S]{0,120}onPick/.test(chat) &&
        !kt("MediaViewer.kt").includes("onPick") &&
        !kt("ChatMediaScreen.kt").includes("onPick"),
    );
  }
  // Item 12: chat-list long-press → rounded-check multi-select + a sheet
  // (Delete / Mute-Unmute / Pin-Unpin / Create group with <username> / Select);
  // the top bar swaps to "N selected" with ⋮ reopening the same sheet.
  {
    const cl = kt("ChatListScreen.kt");
    const store = kt("ScreenStore.kt");
    const kpapp = kt("KpApp.kt");
    const grp = kt("CreateGroupScreen.kt");
    const sheet = cl.slice(
      cl.indexOf("private fun ChatRowSheet("),
      cl.indexOf("private fun HomeMenuItem("),
    );
    const order = [
      'KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red)',
      'if (allMuted) "Unmute" else "Mute",',
      'KpSheetRow(Icons.Filled.PushPin, if (allPinned) "Unpin" else "Pin")',
      'KpSheetRow(Icons.Filled.GroupAdd, "Create group with $handle")',
      'KpSheetRow(Icons.Filled.CheckCircle, "Select")',
    ].map((t) => sheet.indexOf(t));
    check(
      "r32-12: chat-list long-press = tick + sheet [Delete, Mute/Unmute, Pin/Unpin, Create group with $handle, Select]; rounded checks in select mode; '<n> selected' bar with X and ⋮ (reopens the sheet); pinned rows sort first (persisted kp-pinned.json); newgroup?with= pre-picks members",
      cl.includes("internal object ListSelect {") &&
        cl.includes(".combinedClickable(") &&
        cl.includes("onLongClick = {") &&
        cl.includes("ListSelect.sheetFor = conv") &&
        cl.includes("selecting -> ListSelect.toggle(id)") &&
        cl.includes(
          "if (ticked) Icon(Icons.Filled.Check, null, tint = ActionBlueInk, modifier = Modifier.size(14.dp))",
        ) &&
        cl.includes('"${ListSelect.ids.size} selected",') &&
        cl.includes(
          'ListSelect.sheetFor = convs.firstOrNull { it.optString("id") == first } ?: JSONObject().put("id", first)',
        ) &&
        cl.includes(
          "androidx.activity.compose.BackHandler(enabled = selecting) { ListSelect.clear() }",
        ) &&
        order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])) &&
        (sheet.match(/KpSheetRow\(/g) || []).length === 5 &&
        sheet.includes('if (allMuted) "Unmute" else "Mute",') &&
        sheet.includes('KpSheetRow(Icons.Filled.PushPin, if (allPinned) "Unpin" else "Pin")') &&
        sheet.includes('KpSheetRow(Icons.Filled.GroupAdd, "Create group with $handle")') &&
        sheet.includes('nav.navigate("newgroup?with=${peers.joinToString(",")}")') &&
        sheet.includes(
          'title = if (ids.size > 1) "Delete ${ids.size} chats?" else "Delete chat?",',
        ) &&
        cl.includes('.sortedByDescending { if (it.optString("id") in pinned) 1 else 0 }') &&
        store.includes("val pinnedConvIds = mutableStateListOf<String>()") &&
        store.includes('pinnedFile = File(ctx.filesDir, "kp-pinned.json")') &&
        kpapp.includes('"newgroup?with={with}",') &&
        grp.includes('fun CreateGroupScreen(nav: NavController, with: String = "") {'),
    );
  }
  // Item 24: form inputs are ONE compact 46dp pill (KpInputField) — hint
  // inside, 1dp border, no thick M3 outlined field with a floating label —
  // on the login phone + profile step, the country search and the name /
  // username edit screens.
  {
    const ui = kt("Ui.kt");
    const login = kt("LoginScreen.kt");
    const st = kt("SettingsScreen.kt");
    check(
      "r32-24: login phone / name / username / about + country search + Settings name / username use the compact KpInputField pill (46dp, hint inside) — no OutlinedTextField left on the login screen",
      ui.includes("fun KpInputField(") &&
        ui.includes(".height(46.dp)") &&
        ui.includes(
          ".border(1.dp, borderColor ?: if (focused) ActionBlue else Muted.copy(alpha = 0.35f), RoundedCornerShape(14.dp))",
        ) &&
        ui.includes(
          "if (value.isEmpty()) Text(placeholder, color = Muted.copy(alpha = 0.7f), fontSize = 15.sp, maxLines = 1)",
        ) &&
        !login.includes("OutlinedTextField") &&
        (login.match(/KpInputField\(/g) || []).length === 6 &&
        login.includes(
          'placeholder = if (country.iso == "BD") "1XXXXXXXXX" else "Phone number",',
        ) &&
        login.includes(".height(46.dp)\n                .clip(FieldShape)") &&
        st.includes(
          'KpInputField(first, { first = it.take(40); err = "" }, placeholder = "First name")',
        ) &&
        st.includes(
          'KpInputField(last, { last = it.take(40); err = "" }, placeholder = "Last name")',
        ) &&
        st.includes("borderColor = borderColor,"),
    );
  }
  // Item 44: the About screen lost its double inset — hero edge to edge,
  // founder card as a portrait-left row, ONE 12dp screen margin per block.
  {
    const about = kt("AboutScreen.kt");
    check(
      "r32-44: About screen — edge-to-edge hero (20/22dp padding, 88dp icon), founder row (72dp portrait left, details right), founder + links cards on a single 12dp screen margin; the old 16dp+24/30dp double inset is gone",
      (about.match(/\.padding\(horizontal = 12\.dp\)/g) || []).length === 2 &&
        about.includes("modifier = Modifier.size(72.dp).clip(CircleShape),") &&
        about.includes("modifier = Modifier.size(88.dp).clip(RoundedCornerShape(24.dp)),") &&
        about.includes(".padding(horizontal = 20.dp, vertical = 22.dp),") &&
        about.includes("Column(Modifier.weight(1f)) {") &&
        about.includes(".padding(horizontal = 14.dp, vertical = 13.dp),") &&
        !about.includes("padding(horizontal = 24.dp, vertical = 30.dp)") &&
        !about.includes("padding(horizontal = 16.dp)"),
    );
  }
  // Item 45: voice waveform — compact bubble (36dp button, 22dp wave, the
  // duration line hosts the stamp, no blank 15dp band) and a live wave in the
  // recording strip.
  {
    const vn = kt("VoiceNote.kt");
    const chat = kt("ChatScreen.kt");
    check(
      "r32-45: voice bubble is compact — 36dp play circle, 22dp wave, duration right under it, the bubble keeps a 4dp bottom instead of the blank 15dp band (fileLooksVoice); the recording strip paints VoiceNote.livePeaks (newest 4 s, sqrt curve, LIVE_BARS wide) between the timer and the cancel hint; both draw through DrawScope.drawVoiceBars",
      chat.includes("internal fun fileLooksVoice(m: JSONObject): Boolean {") &&
        chat.includes('val fileRow = kind == "FILE"') &&
        chat.includes("val isVoice = !asDocument && fileLooksVoice(m)") &&
        chat.includes("modifier = Modifier.width(150.dp).height(22.dp),") &&
        !chat.includes("modifier = Modifier.width(150.dp).height(30.dp),") &&
        chat.includes(
          "internal fun DrawScope.drawVoiceBars(bars: List<Int>, progress: Float, played: Color, rest: Color, newest: Boolean = false) {",
        ) &&
        chat.includes("drawVoiceBars(bars, progress, played, rest)") &&
        chat.includes(
          "Canvas(modifier) { drawVoiceBars(VoiceNote.livePeaks, 1f, color, color, newest = true) }",
        ) &&
        chat.includes(
          "LiveVoiceWave(color = accent, modifier = Modifier.weight(1f).height(22.dp))",
        ) &&
        chat.includes('Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)') &&
        (chat.match(/\.size\(36\.dp\)\n\s+\.pressScale\(interaction\)/g) || []).length === 1 &&
        vn.includes("var livePeaks: List<Int> by mutableStateOf(emptyList())") &&
        vn.includes("livePeaks = VoiceWaveform.live(amps)") &&
        (vn.match(/livePeaks = emptyList\(\)/g) || []).length === 3 &&
        vn.includes("const val LIVE_BARS = 40") &&
        vn.includes("fun live(samples: List<Int>, bars: Int = LIVE_BARS): List<Int> {") &&
        readFileSync(
          "native-android/app/src/test/java/app/kuchupuchu/android/VoiceWaveformTest.kt",
          "utf8",
        ).includes("VoiceWaveform.live(listOf(0, 20000))"),
    );
  }
  // Item 20: Settings › Privacy gets "Status updates" (No one / Contacts only /
  // Public) with the question-form sheet; the worker stores priv_status.
  {
    const st = kt("SettingsScreen.kt");
    const priv = st.slice(
      st.indexOf("fun PrivacySettingsScreen("),
      st.indexOf("fun AppearanceSettingsScreen("),
    );
    const src = readFileSync("src/worker/index.ts", "utf8");
    check(
      "r32-20: Privacy has a 'Status updates' row (default Public) → sheet 'Who Can View Your Status?' → PATCH /api/me privStatus; worker: priv_status column, privacy.status in /api/me, canSeeStatusOf + the feed honour it (public = anyone sharing a chat, contacts = 1:1, nobody)",
      priv.includes(
        'SettingRow(Icons.Filled.Circle, "Status updates", privacyLabel(level("status", "public"))) { picker = "privStatus" }',
      ) &&
        priv.includes('"privStatus" -> "Who Can View Your Status?"') &&
        priv.includes('"privStatus" -> "status"') &&
        src.includes("ALTER TABLE users ADD COLUMN priv_status TEXT") &&
        src.includes('["privStatus", "priv_status"],') &&
        src.includes("status: privLevel(row.priv_status, PRIVACY_DEFAULTS.status),") &&
        src.includes(
          "function statusVisibleTo(author: UserRow, soloContact: boolean): boolean {",
        ) &&
        src.includes("if (!statusVisibleTo(userRow, soloContacts.has(contactId))) continue;") &&
        src.includes("const level = privLevel(owner?.priv_status, PRIVACY_DEFAULTS.status);"),
    );
  }
  // Item 34: document send — the upload ring wraps the file icon (left), the
  // size line hosts the stamp (no bottom band, no right slot → no overlap);
  // reliability: streamed copy + streamed upload on a process-level scope,
  // 25 MB pre-check, Outbox hand-off for the POST, retry from the cached copy.
  {
    const chat = kt("ChatScreen.kt");
    const api = kt("Api.kt");
    const files = kt("Files.kt");
    const bubble = chat.slice(
      chat.indexOf("// Documents: the WHOLE row opens"),
      chat.indexOf("textDoc?.let { body ->"),
    );
    check(
      "r32-34: document bubble — progress ring + open spinner sit ON the 40dp icon (36dp ring, themed track), the right-hand slot with 'Open' / the ring is gone, the size line keeps the stamp's corner clear (padding end 50/34dp), a missing file fades the icon",
      bubble.includes("trackColor = docInk.copy(alpha = 0.22f),") &&
        (bubble.match(/modifier = Modifier\.size\(36\.dp\),/g) || []).length === 2 &&
        !bubble.includes("Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {") &&
        // code form only (the comments still mention the old label)
        !/else "Open",/.test(bubble) &&
        !/^\s+"…",$/m.test(bubble) &&
        bubble.includes(
          "modifier = Modifier.size(22.dp).alpha(if (ready || upFrac != null) 1f else 0.5f),",
        ) &&
        bubble.includes("modifier = Modifier.padding(end = if (mine) 50.dp else 34.dp),"),
    );
    check(
      "r32-34: document send reliability — FilesUtil.copyDocument streams the pick into cache (128 KB, day-old sweep), Api.uploadFile streams from the file (64 KB, progress once per percent), Uploads.sendFile runs on a SupervisorJob scope the chat only awaits, refuses > 25 MB up front, hands a blipped POST to the Outbox (4xx still fails), keeps the copy for the retry banner (docPath) and deletes it on success",
      files.includes(
        "fun copyDocument(ctx: Context, uri: Uri, name: String): Pair<String, File>? = runCatching {",
      ) &&
        files.includes("dest.outputStream().use { out -> input.copyTo(out, 128 * 1024) }") &&
        !files.includes("fun readDocument(") &&
        api.includes(
          "fun uploadFile(name: String, mime: String, file: java.io.File, onProgress: ((Long, Long) -> Unit)? = null): JSONObject {",
        ) &&
        api.includes("val buf = ByteArray(65_536)") &&
        api.includes("if (pct != lastPct) {") &&
        chat.includes("object Uploads {") &&
        chat.includes("private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)") &&
        chat.includes(
          "fun sendFile(convId: String, clientId: String, name: String, mime: String, file: File, meta: JSONObject?): Deferred<Throwable?> =",
        ) &&
        chat.includes(
          "val up = Api.uploadFile(name, mime, file) { w, t -> UploadProgress.set(clientId, 0.9f * w / t) }",
        ) &&
        chat.includes("if (e.status in 400..499 && e.status != 408 && e.status != 429) throw e") &&
        (chat.match(/Outbox\.add\(convId, clientId, payload\)/g) || []).length >= 3 &&
        chat.includes("if (file.length() > VideoPlan.UPLOAD_LIMIT) {") &&
        chat.includes(
          "val outcome = Uploads.sendFile(convId, clientId, name, mime, file, docMeta)",
        ) &&
        chat.includes('.put("docPath", file.absolutePath)') &&
        chat.includes("docPath.isNotBlank() -> {") &&
        chat.includes(
          "val pair = withContext(Dispatchers.IO) { FilesUtil.copyDocument(ctx, uri, name) }",
        ) &&
        !chat.includes("Files/documents can't be retried") &&
        !chat.includes("FilesUtil.readDocument("),
    );
  }
  // Item 35: photo notifications show the photo. Worker: the send preview is
  // derived from the stored shape (previewOf), so an uploaded photo reads
  // "Photo"; the push names the picture (kp_media). App: the push handler
  // fetches it under a hard time cap into the shared bitmap cache and the
  // card draws it as the big picture + large icon; the actions stay.
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const push = kt("KpPush.kt");
    const notify = kt("KpNotify.kt");
    const api = kt("Api.kt");
    const ui = kt("Ui.kt");
    const previewOf = src.slice(
      src.indexOf("function previewOf(row: MsgRow): string {"),
      src.indexOf("async function fanOutProfileChange("),
    );
    check(
      "r32-35: worker — send preview comes from previewOf (no 'photo.jpg'), image/video/audio media files read as words, Documents keep their name, push data carries kp_media only for a picture",
      src.includes("const preview = previewOf({") &&
        !src.includes('kind === "FILE" ? String(body.fileName || "File") : "Message"') &&
        previewOf.includes('if (type.startsWith("image/")) return "Photo";') &&
        previewOf.includes('if (type.startsWith("video/")) return "Video";') &&
        previewOf.includes("if (meta.document !== true) {") &&
        src.includes("const pictureUrl = message.hasImage") &&
        src.includes("...(pictureUrl ? { kp_media: pictureUrl } : {}),"),
    );
    check(
      "r32-35: app — bounded fetch (Api.downloadWithin via Bitmaps.fetchWithin, cache-first, stored for the chat), only an /api/ path is fetched, the card sets the large icon + BigPictureStyle and keeps Reply / Like / Mark-as-read",
      api.includes("fun downloadWithin(pathOrKey: String, millis: Long): ByteArray? {") &&
        api.includes("http.newBuilder().callTimeout(millis, TimeUnit.MILLISECONDS).build()") &&
        ui.includes("fun fetchWithin(url: String, millis: Long, maxSide: Int = 720): Bitmap? {") &&
        ui.includes("val bytes = Api.downloadWithin(url, millis) ?: return null") &&
        ui.includes("fun ensureInit(ctx: android.content.Context) {") &&
        push.includes('data["kp_media"]?.takeIf { it.startsWith("/api/") }?.let {') &&
        push.includes("Bitmaps.ensureInit(this)") &&
        push.includes("picture = picture,") &&
        notify.includes("picture: android.graphics.Bitmap? = null,") &&
        notify.includes("NotificationCompat.BigPictureStyle()") &&
        notify.includes(".bigPicture(picture)") &&
        notify.includes("setLargeIcon(picture)") &&
        notify.indexOf("NotificationCompat.BigPictureStyle()") <
          notify.indexOf('if (!convoId.contains("kp_official_bot")) addAction(replyAction)') &&
        notify.includes(".addAction(readAction)"),
    );
  }
  // Item 11: one open swipe row at a time — another row's touch, a scroll, or
  // a touch on blank list space closes it (main, archive and hidden lists).
  {
    const cl = kt("ChatListScreen.kt");
    check(
      "r32-11: chat-list swipe reveal auto-closes — SwipeOpen focus holder, row watcher (LaunchedEffect on SwipeOpen.id), touch-on-other-row / blank-space / scroll observers on all three lists",
      cl.includes("private object SwipeOpen {") &&
        cl.includes("var id by mutableStateOf<String?>(null)") &&
        cl.includes("if (SwipeOpen.id != convId && dragged != 0f) dragged = 0f") &&
        cl.includes("if (SwipeOpen.id != null && SwipeOpen.id != id) SwipeOpen.id = null") &&
        cl.includes("if (!onRow) SwipeOpen.id = null") &&
        cl.includes(
          "snapshotFlow { listState.isScrollInProgress }.collect { if (it) SwipeOpen.id = null }",
        ) &&
        cl.includes("if (dragged != 0f) SwipeOpen.id = convId") &&
        (cl.match(/CloseSwipeOnScroll\(/g) || []).length === 4 &&
        (cl.match(/swipeFocusList[ ]?[({]/g) || []).length === 5 &&
        cl.includes(".then(swipeFocusTouch(convId))"),
    );
  }
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`bots-verified: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
