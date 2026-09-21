// Bots & badges (owner round): the KuchuPuchu AI welcome message (fixed
// fallback when no HF key), both bot accounts verified with the bundled logo
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
    "welcome message from KuchuPuchu AI (fallback text without HF_TOKEN)",
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

// ---- r34-10: @tachinahamed carries the verified badge ----
{
  const k = await mk();
  const a = await k.reg("tachin@x.com", "tachin");
  k.db._db.prepare("UPDATE users SET username = 'tachinahamed' WHERE id = ?").run(a.user.id);
  // The migration statement itself, executed verbatim from the worker source.
  const src10 = readFileSync("src/worker/index.ts", "utf8");
  const mig = src10.match(/`UPDATE users SET verified = 1 WHERE username = 'tachinahamed'[^`]*`/);
  check("r34-10: the badge migration exists in the worker", !!mig, mig?.[0]?.slice(0, 60));
  if (mig) {
    k.db._db.exec(mig[0].slice(1, -1));
    const row = k.db._db.prepare("SELECT verified FROM users WHERE id = ?").get(a.user.id);
    check("r34-10: the migration badges @tachinahamed", row?.verified === 1, String(row?.verified));
  }
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

  // Photo-create intent without HF_TOKEN: no IMAGE message, the text
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
    "stamp sits at the last line's end (rounds 12→13; r33-5: measured, no no-break-space reserve)",
    // r33-5: the NBSP reserve only fit Roboto — Bangla / emoji bodies had the
    // stamp on the glyphs. KpStamped reads the last line's end from the
    // TextLayoutResult instead; no reserve string is left anywhere in the file.
    !chat.includes("\u00A0\u00A0") &&
      // r32-45/34: FILE rows (voice + document) keep no band (their second line hosts the stamp);
      // r33-5: text-like bodies (text, emoji-only, sticker, deleted) carry the stamp in-column.
      // v169: the voice body is back to the shared frame; the stamp left the
      // bubble entirely (it rides under it now).
      chat.includes(
        "bottom = if (voiceRow) 0.dp else if (fileRow) 4.dp else if (textLike) 0.dp else 15.dp",
      ) &&
      chat.includes('val textLike = kind == "TEXT" || kind == "STICKER" || kind == "DELETED"'),
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
      // Owner round 45 (item 1): the screen-on hold spans the open AI chat
      // (the per-reply flag flip dimmed the panel for a second).
      chat.includes("DisposableEffect(isAiChat)") &&
      chat.includes("FLAG_KEEP_SCREEN_ON") &&
      chat.includes("TypingBubble(chatAccent(chatTheme))") &&
      !chat.includes('typingNow -> "typing..."') &&
      // Owner round 42 (item 3): an image coming gets the shimmer card.
      // v167: the slot's FIRST branch is the live AI reply when the stream has
      // already painted text (the dots are what is left when it has not).
      chat.includes("if (aiTyping && aiLiveBody.isNotBlank()) {") &&
      chat.includes('} else if (aiTyping && otherTypingKind == "image") {') &&
      chat.includes("private fun ImageCreatingBubble() {") &&
      chat.includes("val shimmer = rememberShimmerAlpha()") &&
      chat.includes('typingKind = data.optString("typingKind").takeIf { it.isNotBlank() }') &&
      chat.includes("otherTypingKind = parsed.typingKind"),
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
    "owner card photo bigger: 70% width card (E8) + square photo",
    chat.includes(
      "minOf(420.dp, (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.70f).dp)",
    ) && chat.includes(".aspectRatio(1f)"),
  );
  check(
    "stamp can never wrap to its own line (inline machinery retired r12)",
    !chat.includes("appendInlineContent") && !chat.includes("InlineTextContent"),
  );
  check("timestamp parsing memoized (scroll perf)", chat.includes("stampCache"));
  check(
    "round 14 + M7: 3s poll when socket down, 8s net when active, 30s idle backoff + 10s rejoin",
    chat.includes("if (down) 3_000L else upCadence") &&
      chat.includes("30_000L else 8_000L") &&
      chat.includes("120_000L") &&
      chat.includes("lastFrameAt") &&
      chat.includes("KpSocket.joinChat(convId)") &&
      chat.includes("lastRejoin") &&
      chat.includes("chatLive(convId)"),
  );

  // ---- Owner round 7 (2026-09-04) ----
  check(
    "AI replies: live HF chain (Kimi-K2 → Kimi-K2.5 → DeepSeek-V3.2 → Llama-3.3-70B) then Workers-AI then Gemini rescue — the HF credit running out (hf-stt 402) used to take EVERY reply down silently; chain verdicts now land in error_log (r48)",
    src.includes('"moonshotai/Kimi-K2-Instruct"') &&
      src.includes('"moonshotai/Kimi-K2.5"') &&
      src.includes('"deepseek-ai/DeepSeek-V3.2"') &&
      src.includes('"meta-llama/Llama-3.3-70B-Instruct"') &&
      src.includes("const HF_CHAT_MODELS") &&
      src.includes("async function cfAiChat(") &&
      src.includes("async function geminiChat(") &&
      src.includes("async function aiBrain(") &&
      src.includes("`hf-chat ${lastErrs"),
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
    "AI: each HF model capped (12s) so one 503 can't starve the rest",
    src.includes("perCallMs = 12_000") && src.includes("HF_CALL_BUDGET_MS"),
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
    src.includes('[{ role: "user", content: prompt + voicePrompt + photoPrompt }],') &&
      // v166: the photo turn is hedged (Gemini vs the HF vision leg) — the HF
      // leg still asks with the FULL prompt at the 900-token budget, and so
      // does the text leg that answers when there are no bytes to look at.
      src.includes("          900,\n          [HF_VISION_MODEL],") &&
      // v167: the same 900-token legs, now on the STREAMING brain (the answer
      // is painted as it is written; the budget is unchanged).
      src.includes(
        'answer = await aiBrainStream(env, [{ role: "user", content: fullPrompt }], 900, push);',
      ) &&
      src.includes("900,\n        push,\n      );"),
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
    "v169: timestamp + ticks ride OUTSIDE the bubble - one row under it on every kind (end for mine, start for theirs); nothing is pinned inside the bubble any more",
    chat.includes("horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,") &&
      chat.includes(
        'BubbleStamp(m, mine, pendingEcho, otherReadAt, if (kind == "STICKER") 1 else emojiOnly, stampInk)',
      ) &&
      !chat.includes("Modifier.align(Alignment.BottomEnd).padding(end = 2.dp, bottom = 1.dp),") &&
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
    "r51: the updater RELAUNCHES the app after an update install (setDontKillApp is API 34+ — below it a full install KILLS the process and nothing brought it back; MY_PACKAGE_REPLACED reaches the NEW build and starts the launcher again)",
    readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8").includes(
      "android.intent.action.MY_PACKAGE_REPLACED",
    ) &&
      readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8").includes(
        ".KpRelaunchReceiver",
      ) &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpUpdate.kt",
        "utf8",
      ).includes("class KpRelaunchReceiver") &&
      readFileSync(
        "native-android/app/src/main/java/app/kuchupuchu/android/KpUpdate.kt",
        "utf8",
      ).includes("getLaunchIntentForPackage(ctx.packageName)"),
  );
  check(
    "keyboard glide: ONE shared spring on the composer pad AND the thread RIDES it — a per-frame delta scroll at bottom (r45b's padding version buried the latest row and opened a scrollable void past the end; padding is constant again) — open glides like close, no 250 ms teleport",
    chat.includes("private fun rememberImeGlidePx(): Int") &&
      !chat.includes("snapshotFlow { kpIme") &&
      !chat.includes("KpImeAutoScroll") &&
      chat.includes("LaunchedEffect(glidePx) {") &&
      chat.includes("glideApplied += runCatching { listState.scrollBy(delta) }") &&
      // Owner round 52: at-bottom is geometric (last row's bottom edge
      // at the viewport floor) — index counts lie with zero-size items.
      chat.includes("tail.offset + tail.size <= info.viewportEndOffset + 24") &&
      chat.includes("padForIme = if (!showAttach && !showStickers) imeGlideDp else 0.dp,") &&
      chat.includes("top = 6.dp, bottom = 6.dp),") &&
      !chat.includes("bottom = 6.dp + imeGlideDp") &&
      // Owner round 44: open glides like close. Owner round 45 (item 3):
      // a critical spring — frame streams are tracked live, single jumps
      // glide. Polish 2026-09-18: tween 280 FastOutSlowInEasing is also
      // accepted — WhatsApp-style smooth glide both ways.
      chat.includes("ViewTreeObserver.OnGlobalLayoutListener") &&
      (chat.includes(
        "spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessHigh)",
      ) ||
        chat.includes("tween(durationMillis = 280") ||
        chat.includes("tween(")) &&
      // Owner round 44: the glide reads the view tree (ime is unresolvable
      // on this BOM) — always behind an isAlive guard (round 13).
      chat.includes("if (tree.isAlive)") &&
      chat.includes(".padding(bottom = padForIme)"),
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
      // r31-29: text, photo, video AND the grouped photo bubble (4 sites);
      // r32-17: + the view-once card (5); r33-17: + the tappable quote inside
      // a bubble, whose long-press still opens the bubble's sheet (6).
      (
        chat.match(
          /if \(selectedIds\.isNotEmpty\(\)\) onToggleSelect\(m\) else onLongPress\(m\)/g,
        ) || []
      ).length === 6,
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
      // r31-29: text, photo, video + the grouped photo bubble (4 sites);
      // r32-17: + the view-once card (5).
      chat.split("MessageReactions(m)").length - 1 === 5,
  );
  check(
    "r18-3/r25: unsent messages VANISH (no tombstone) — filtered before render (r38-4: except mid-vanish, so the dust plays out)",
    chat.includes(
      '(m.optString("kind") != "DELETED" || albumPhotos(m).any { it.optString("id") in vanishingIds }) && run {',
    ),
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
        // v167 (owner: "video 3 dot ta upore rotate button ta remove kore okhane thakbe"):
        // the rotate button + its landscape machinery left the player; the dots took
        // its seat in the top bar, and Save fetches a clip that is not on the phone yet.
        mediaViewer.includes(
          'Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))',
        ) &&
        !mediaViewer.includes("Icons.Filled.ScreenRotation") &&
        !mediaViewer.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE") &&
        mediaViewer.includes("if (dest.exists() && dest.length() > 0L) {") &&
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
        // r33-20: the tile's tap branches — a video → the app's player, a photo → the viewer.
        mediaTab.includes(".clickable(enabled = url.isNotBlank()) {") &&
        mediaTab.includes("else viewer = m") &&
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
    "r21-sweep: chat ⋮ menu rows blue (r32-5: KpSheetRow icons take ActionBlueDeep by design) + reply/quote bars carry the chat accent",
    chat.includes(
      'KpSheetRow(Icons.Filled.Search, "Search in chat") { menuOpen = false; showChatSearch = true }',
    ) && chat.includes("background(chatAccent(theme))"),
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
    chat.includes(
      'KpSheetRow(Icons.Filled.Search, "Search in chat") { menuOpen = false; showChatSearch = true }',
    ) &&
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
      // v163: the row also hands the ✕ (cancel send) down.
      chat.includes(
        "ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onReply, onLongPress, theme, onCancelSend)",
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
    "15: AI replies fail over per-model (12s HF cap) + both APKs per CI run (r22)",
    src.includes("perCallMs = 12_000") &&
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
      engine23.includes("withTimeoutOrNull(4_500)"),
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
    "r25/r32-29/r33-18: photos smaller (120dp inline preview, ≤160dp tall) + JPEG quality 90; voice/call stamps bottom-right; ONE back closes reaction+selection",
    (chat.match(/\.widthIn\(max = 120\.dp\)/g) || []).length === 3 &&
      (chat.match(/\.heightIn\(max = 160\.dp\)/g) || []).length === 2 &&
      !chat.includes(".widthIn(max = 185.dp)") &&
      !chat.includes(".widthIn(max = 150.dp)") &&
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
    chat.includes("Column(horizontalAlignment = Alignment.CenterHorizontally) {") &&
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
      "native-android/app/src/main/java/app/kuchupuchu/android/MediaEditScreen.kt",
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
    "r28-5/r31/r32-3: the settings cog is gone; the home ⋮ menu is exactly My Profile, New contact, All contacts, New group, Settings — in that order, each a real route (r32-3: About Us removed; it stays under Settings › App) — bottom sheet (no DropdownMenu)",
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
      !list.includes("DropdownMenu") &&
      list.includes("fun HomeMenuSheet(") &&
      list.includes("KpSheet(onDismiss = onDismiss) {") &&
      list.includes("if (homeMenu) {") &&
      list.includes("HomeMenuSheet(onDismiss = { homeMenu = false }, nav = nav)"),
  );
  const profile = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
    "utf8",
  );
  check(
    "r28-5/r31: my own profile edits IN PLACE (photo tap + Name/Username/About/Phone rows) instead of call/search/block — no intermediate edit screen",
    profile.includes("val isMe = userId.isNotBlank() && userId == Store.myId()") &&
      // r32-25: calls / search on EVERY peer profile (the owner's too)
      profile.includes("if (!isMe && !isKpBot(userId) && !requestOpen) {\n        Row(") &&
      !profile.includes(
        'if (!isMe && !isKpBot(userId) && u.optText("username") != "rabbihossainltd")',
      ) &&
      !profile.includes('Text("Edit profile"') &&
      !profile.includes('"myprofile"') &&
      !kpapp.includes('composable("myprofile")') &&
      ["editfield/name", "editfield/username", "editfield/about", "editfield/phone"].every((r) =>
        profile.includes(`nav.navigate("${r}")`),
      ) &&
      profile.includes("AvatarGallerySheet(") &&
      profile.includes("loadMediaPool(ctx)") &&
      !profile.includes("PickVisualMedia"),
  );
  check(
    "r34-1: profile photo opens the app's own attach-style gallery (pool + cells, images only), never the system picker",
    profile.includes("fun AvatarGallerySheet(") &&
      profile.includes("loadMediaPool(ctx)") &&
      profile.includes("MediaCell(") &&
      profile.includes("filter { !it.isVideo }") &&
      profile.includes("RequestMultiplePermissions") &&
      profile.includes("onPick(item.uri)") &&
      profile.includes("FilesUtil.imageToDataUrl") &&
      profile.includes("galleryOpen = true") &&
      !profile.includes("PickVisualMedia"),
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
      chat.includes('PhoneBook.entries.any { it.user?.optString("id") == otherUserId }') &&
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
      !kt("CropTrimKit.kt").includes('Text("Caption")'),
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
    const scene = kt("KpUpdateScene.kt");
    check(
      "r31-10: update = popup Dialog (not bottom sheet) with the app-accent maintenance-crew scene (ActionBlue family — never a lone Gold bar) and explicit Install step (ready APK kept, installReady on tap) — non-skippable, appears on any screen",
      kpapp.includes("fun KpUpdateGate()") &&
        kpapp.includes("Dialog(") &&
        kpapp.includes("dismissOnBackPress = false") &&
        kpapp.includes("dismissOnClickOutside = false") &&
        !kpapp.includes("KpSheet(") &&
        // v166 (owner's own update demo, recoloured to the app): the plain
        // ActionBlue LinearProgressIndicator is gone — the popup draws
        // KpUpdateScene for available / downloading / done, whose accent IS
        // ActionBlue and whose bar is that same accent family (blue in the
        // dark app, the gold accent in the light one).
        kpapp.includes("KpUpdateScene(KpUpdatePhase.AVAILABLE, 0f") &&
        kpapp.includes("KpUpdateScene(KpUpdatePhase.DOWNLOADING, KpUpdate.progress") &&
        kpapp.includes("KpUpdateScene(KpUpdatePhase.DONE, 1f") &&
        scene.includes("val accent = ActionBlue") &&
        scene.includes("listOf(accent, ActionBlueDeep, accent)") &&
        // the BAR is the accent family; the demo's amber survives only in the
        // sparks (they are sparks) — the old Gold→blue bar gradient is gone.
        !scene.includes("listOf(Gold, GoldDeep, accent)") &&
        scene.includes("val track = Line") &&
        kpapp.includes('GoldBtn("Install", Modifier.fillMaxWidth())') &&
        kpapp.includes("KpUpdate.installReady(ctx)") &&
        update.includes("var ready by mutableStateOf<File?>(null)") &&
        update.includes("ready = apk") &&
        update.includes("suspend fun installReady(ctx: Context)") &&
        update.includes("installViaIntent") &&
        !update.includes(
          "withContext(Dispatchers.IO) { install(ctx, apk) }\n            available = null",
        ),
    );
    check(
      "r31-7: chat popups are sheets — edit message, disappearing timer, chat theme, document viewer menu; crash report + status delete too",
      (() => {
        const chat = kt("ChatScreen.kt");
        return (
          chat.includes('KpSheet(onDismiss = onClose, title = "Edit message")') &&
          chat.includes('KpSheet(onDismiss = onClose, title = "Disappearing messages")') &&
          chat.includes('KpSheet(onDismiss = onClose, title = "Chat theme")') &&
          // r32-33: the text-file sheet became the document viewer screen.
          kt("DocViewerScreen.kt").includes("KpSheet(onDismiss = { menuOpen = false }) {") &&
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
    "r31-12 + N3r: StickerPanel uses Card/Ink/Muted/ActionBlue tokens only; emoji-only (1–3) TEXT bubbles render 44/34 glyph rows with the stamp in the bottom band",
    !/0x[0-9A-F]{2}1C1917/.test(kt("StickerSheet.kt")) &&
      !kt("StickerSheet.kt").includes("GoldDeep") &&
      !kt("StickerSheet.kt").includes("color = Color.White") &&
      kt("StickerSheet.kt").includes("if (sel) ActionBlueDeep else Muted") &&
      kt("ChatScreen.kt").includes("internal fun emojiOnlyCount(body: String): Int") &&
      kt("ChatScreen.kt").includes(
        'EmojiGlyphRow(m.optText("body").trim(), 44f, fxFresh, m.optString("id"))',
      ) &&
      kt("ChatScreen.kt").includes(
        'EmojiGlyphRow(m.optText("body").trim(), 34f, fxFresh, m.optString("id"))',
      ) &&
      kt("ChatScreen.kt").includes(
        'Icon(Icons.Filled.Mood, "Stickers", tint = accent, modifier = Modifier.size(20.dp))',
      ),
  );
  {
    check(
      "r31-16: a photo/video/audio picked through Document is SENT and SHOWN as a document (meta.document), opening in the app's own viewer/player or playing inline",
      // r32-17: both signatures grew a trailing viewOnce flag.
      chat.includes(
        'fun handleDocumentPicked(uri: Uri, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "")',
      ) &&
        chat.includes(
          // v166 (fb#5): suspend, and the clip's own w / h / durMs ride along.
          'suspend fun sendFile(\n        name: String,\n        mime: String,\n        file: File,\n        asDocument: Boolean = false,\n        viewOnce: Boolean = false,\n        sendAt: java.time.Instant? = null,\n        caption: String = "",\n        w: Int = 0,\n        h: Int = 0,\n        durMs: Long = 0L,\n    ) {',
        ) &&
        chat.includes('asDocument -> JSONObject().put("document", true)') &&
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
        // v163: the doc row also hands the ✕ (cancel send) down.
        chat.includes(
          '"FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme, onOpenDoc, onToggleSelect, onLongPress, selecting = selectedIds.isNotEmpty(), onCancelSend = onCancelSend, fxGrow = fxFresh)',
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "...(incomingMeta.document === true ? { document: true } : {}),",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          'String(meta.type || "").startsWith("image/") && meta.document !== true',
        ),
    );

    check(
      "r31-17: the hold-mic gesture always awaits the pointer down first (a disabled mic no longer spins the main thread), and the AI answers voice notes via Whisper transcription",
      chat.includes(
        "val down = awaitFirstDown(requireUnconsumed = false)\n                    if (!enabled) {\n                        down.consume()\n                        return@awaitEachGesture\n                    }",
      ) &&
        !chat.includes("if (!enabled) return@awaitEachGesture") &&
        // Owner round 42 (item 3): two attempts, 503-sleep, error_log.
        readFileSync("src/worker/index.ts", "utf8").includes("async function hfTranscribe(") &&
        readFileSync("src/worker/index.ts", "utf8").includes(
          "Promise<{ text: string | null; err: string }>",
        ) &&
        readFileSync("src/worker/index.ts", "utf8").includes("hf-stt-loading") &&
        readFileSync("src/worker/index.ts", "utf8").includes("`hf-stt ${heard.err}`") &&
        readFileSync("src/worker/index.ts", "utf8").includes("openai/whisper-large-v3-turbo") &&
        // Owner round 43 (item 5): the cron keeps Whisper warm.
        readFileSync("src/worker/index.ts", "utf8").includes("function wavSilence()") &&
        readFileSync("src/worker/index.ts", "utf8").includes('"content-type": "audio/wav"') &&
        readFileSync("src/worker/index.ts", "utf8").includes("this is what they said:") &&
        readFileSync("src/worker/index.ts", "utf8").includes("the clip could not be heard: say so"),
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
        // r32-5c: a group video call branches to the grid first.
        kt("CallScreens.kt").includes(
          "if (call.group) GroupVideoScreen(call) else InCallVideoScreen(call)\n                } else {\n                    VoiceCallScreen(call)",
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
        // v168: selfPrivate left the gate - a private profile protects against
        // others, never against the owner themself (the peer rule is intact).
        chat.includes("val privateChat = KpSecure.privatePeer(c) || privateGroup") &&
        chat.includes("KpSecure.Guard(privateChat)") &&
        // r32-17: a view-once photo / video rides the same guards.
        chat.includes("if (!echo && !privateChat && !isViewOnce(m)) {") &&
        chat.includes("canSave = !privateChat && !once,") &&
        chat.includes('.put("kpPrivate", privateChat)') &&
        kt("CallScreens.kt").includes("KpSecure.Guard(call.otherPrivate)") &&
        // r32-5b: a group call reads privateGroup instead — same field, two sources.
        kt("CallEngine.kt").includes(
          'else other.optBoolean("privateProfile") || current?.otherPrivate == true,',
        ) &&
        kt("ProfileScreen.kt").includes("KpSecure.Guard(privatePerson)") &&
        kt("ProfileScreen.kt").includes("canSave = !privatePerson,") &&
        kt("MediaViewer.kt").includes("KpSecure.Guard(secure || !canSave)") &&
        kt("MediaViewer.kt").includes('val privateClip = m?.optBoolean("kpPrivate") == true') &&
        // v167 (owner: "video 3 dot ta upore rotate button ta remove kore
        // okhane thakbe"): Save is offered whenever the clip can be put on the
        // phone (it fetches one that is not there yet) — but a private clip
        // STILL gets neither Save nor Forward, and Delete stays reachable for
        // it because the ⋮ is a fixed bar seat now instead of a floating twin
        // the auto-hiding chrome could leave behind.
        kt("MediaViewer.kt").includes("if (m != null && !privateClip && !saved) {") &&
        kt("MediaViewer.kt").includes("if (dest.exists() && dest.length() > 0L) {") &&
        kt("MediaViewer.kt").includes(
          'Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))',
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
        // a hides the chat — r33-6: with the secret key's hash
        const keyHash = "3".repeat(64);
        const hide = await call(
          "POST",
          `/api/conversations/${cid}/hide`,
          { hidden: true, key: keyHash },
          a.token,
        );
        // r33-6: while hidden, message search must not surface the chat's
        // messages to a (b still finds them)
        const searchA = await call("GET", "/api/search?q=one", undefined, a.token);
        const searchB = await call("GET", "/api/search?q=one", undefined, b.token);
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
          "r33-6: the hide carries the secret key's hash — stored per member (members.hidden_key), echoed on the caller's list row as `hiddenKey` (never on the other member's), cleared by unhide; message search skips the hider's hidden chats and nobody else's",
          rowA?.hiddenKey === keyHash &&
            rowB?.hiddenKey === null &&
            rowA2?.hiddenKey === null &&
            (searchA.json.messages ?? []).every((m) => m.convoId !== cid) &&
            (searchB.json.messages ?? []).some((m) => m.convoId === cid),
          JSON.stringify({
            a: rowA?.hiddenKey,
            b: rowB?.hiddenKey,
            after: rowA2?.hiddenKey,
            searchA: (searchA.json.messages ?? []).length,
            searchB: (searchB.json.messages ?? []).length,
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
        {
          const w = readFileSync("src/worker/index.ts", "utf8");
          check(
            "r33-6: worker — members.hidden_key migration, MEMBER_COLS carries it, /hide writes hidden + hidden_key in one UPDATE (key only on a hide, trimmed, ≤128), the detail exposes hiddenKey for the caller only, the marker moves with it, /api/search joins members with hidden = 0",
            w.includes("`ALTER TABLE members ADD COLUMN hidden_key TEXT`,") &&
              w.includes(
                'const MEMBER_COLS = "conv_id, user_id, role, muted, unread, last_read_at, hidden, hidden_key";',
              ) &&
              w.includes(
                '"UPDATE members SET hidden = ?, hidden_key = ? WHERE conv_id = ? AND user_id = ?",',
              ) &&
              w.includes('hidden === 1 && typeof rawKey === "string" && rawKey.trim()') &&
              w.includes("? rawKey.trim().slice(0, 128)") &&
              w.includes("meHiddenKey = meHidden ? (row.hidden_key ?? null) : null;") &&
              w.includes("hiddenKey: meHiddenKey,") &&
              w.includes("          c.hiddenKey,\n") &&
              w.includes(
                "JOIN members mem ON mem.conv_id = m.conv_id AND mem.user_id = ? AND COALESCE(mem.hidden, 0) = 0",
              ),
          );
        }
        const cl = kt("ChatListScreen.kt");
        const row = cl.slice(
          cl.indexOf("private fun SwipeConvRow("),
          cl.indexOf("private fun RowScope.ActionSlot("),
        );
        check(
          "r31-26: app — swipe right shows Hide beside Archive (main list); hidden rows leave the main list AND the archive; the badge ignores them (r33-6: no Unhide slot, no hiddenMode — Search unhides)",
          row.includes('label = "Hide",') &&
            !row.includes('label = "Unhide",') &&
            !row.includes("hiddenMode") &&
            row.includes(
              'Api.post("/api/conversations/$id/hide", JSONObject().put("hidden", true).put("key", hash))',
            ) &&
            row.includes("if (offset < 0f && !archivedMode) {") &&
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
        // r33-6: the owner's new system. No gesture, no Hidden screen, no
        // `hidden` route: EVERY hide asks for a free-form secret key (sheet
        // with one field + one button), the app stores SHA-256(key) on the
        // row (server: members.hidden_key), and typing the FULL key in
        // Search reveals exactly the chats hidden with it — before the
        // two-character server guard, so a one-emoji key works.
        const store = kt("ScreenStore.kt");
        const search = kt("SearchScreen.kt");
        const profile = kt("ProfileScreen.kt");
        check(
          "r33-6: the three-tap-blank opener, HiddenChatsScreen and the `hidden` route are gone; swipeFocusList() keeps only the row-closing job",
          !cl.includes("HiddenChatsScreen") &&
            !cl.includes("onTripleTapBlank") &&
            !cl.includes("if (taps >= 3) {") &&
            !cl.includes('nav.navigate("hidden")') &&
            !kt("KpApp.kt").includes('composable("hidden")') &&
            !kt("KpApp.kt").includes("HiddenChatsScreen") &&
            cl.includes("private fun swipeFocusList(): Modifier =") &&
            cl.includes("val onRow = SwipeOpen.downOn != null") &&
            !cl.includes("threeFingerDoubleTap") &&
            !cl.includes("maxFingers >= 3") &&
            !cl.includes('"Hidden chats"') &&
            !cl.includes("HomeMenuItem(Icons.Filled.VisibilityOff"),
        );
        check(
          "r33-6: HideKeySheet — KpSheet 'Hide chat' with ONE KpInputField (placeholder 'Secret key', ≤64 chars, focused on open, IME Done submits) + one 'Hide' button (disabled while blank), imePadding; both hide entry points use it: the swipe Hide slot (ChatListScreen) and the profile ⋮ Hide (ProfileScreen); unhide from the profile needs no key",
          cl.includes(
            "internal fun HideKeySheet(onDismiss: () -> Unit, onHide: (String) -> Unit) {",
          ) &&
            cl.includes('KpSheet(onDismiss = onDismiss, title = "Hide chat") {') &&
            cl.includes("Column(Modifier.padding(horizontal = 14.dp).imePadding()) {") &&
            cl.includes('placeholder = "Secret key",') &&
            cl.includes("{ key = it.take(64) },") &&
            cl.includes("focusRequester = focus,") &&
            cl.includes(
              "keyboardActions = KeyboardActions(onDone = { if (key.isNotBlank()) onHide(key.trim()) }),",
            ) &&
            cl.includes(
              'GoldBtn("Hide", Modifier.fillMaxWidth(), enabled = key.isNotBlank()) { onHide(key.trim()) }',
            ) &&
            row.includes("var askKey by remember { mutableStateOf(false) }") &&
            row.includes("HideKeySheet(onDismiss = { askKey = false }) { key ->") &&
            row.includes("val hash = ScreenStore.hiddenKeyHash(key)") &&
            row.includes("ScreenStore.setHidden(id, true, hash)") &&
            profile.includes("var askHideKey by remember { mutableStateOf(false) }") &&
            profile.includes("HideKeySheet(onDismiss = { askHideKey = false }) { key ->") &&
            profile.includes("withConv { cid -> setHidden(cid, true, key) }") &&
            profile.includes("withConv { cid -> setHidden(cid, false, null) }") &&
            profile.includes(
              'Api.post("/api/conversations/$cid/hide", JSONObject().put("hidden", next).put("key", hash))',
            ) &&
            kt("Ui.kt").includes("focusRequester: FocusRequester? = null,") &&
            kt("Ui.kt").includes(
              ".let { m -> if (focusRequester != null) m.focusRequester(focusRequester) else m }",
            ),
        );
        check(
          "r33-6: ScreenStore — setHidden(convId, hidden, keyHash) keeps `hiddenKey` on the row (dropped on unhide), hiddenKeyHash = SHA-256 hex of the trimmed key, hiddenFor(hash) lists the chats hidden with it, hiddenKeyOf / hiddenCallConv helpers; the key hash is part of the list signature",
          store.includes(
            "fun setHidden(convId: String, hidden: Boolean, keyHash: String? = null) {",
          ) &&
            store.includes(
              'if (hidden && keyHash != null) row.put("hiddenKey", keyHash) else row.remove("hiddenKey")',
            ) &&
            store.includes("fun hiddenKeyHash(key: String): String =") &&
            store.includes('java.security.MessageDigest.getInstance("SHA-256")') &&
            store.includes(".digest(key.trim().toByteArray())") &&
            store.includes("fun hiddenFor(hash: String): List<JSONObject> =") &&
            store.includes(
              'convs.filter { it.optBoolean("hidden", false) && it.optIso("hiddenKey") == hash }',
            ) &&
            store.includes("fun hiddenKeyOf(convId: String): String? {") &&
            store.includes("fun hiddenCallConv(call: JSONObject): String? {") &&
            store.includes("append(c.optString(\"hiddenKey\")).append('|')"),
        );
        check(
          "r33-6: Search — SHA-256(query.trim()) is matched against the hidden chats BEFORE the ≥2-char server guard; matches render under 'Hidden' (HiddenChatRow: tap opens chat/{id}, eye unhides → POST /hide {hidden:false}, rollback keeps the old hash) plus the calls with those people; every other hidden chat is concealed from People / Chats / Media / Docs / Messages",
          search.includes(
            "val keyHash = remember(query) { query.trim().takeIf { it.isNotEmpty() }?.let { ScreenStore.hiddenKeyHash(it) } }",
          ) &&
            search.includes(
              "val revealed = if (keyHash == null) emptyList() else ScreenStore.hiddenFor(keyHash)",
            ) &&
            search.includes(
              "fun concealed(convId: String): Boolean = convId.isNotBlank() && convId !in revealedIds && ScreenStore.isHidden(convId)",
            ) &&
            search.includes(
              '.filter { u -> !concealed(ScreenStore.convIdForUser[u.optString("id")].orEmpty()) }',
            ) &&
            search.includes(
              'val chats = (result?.arr("chats")?.objects() ?: emptyList()).filter { !concealed(it.optString("id")) }',
            ) &&
            search.includes(
              'val allMessages = (result?.arr("messages")?.objects() ?: emptyList()).filter { !concealed(it.optString("convoId")) }',
            ) &&
            search.includes("val typed = query.trim().length >= 2") &&
            search.includes("if (!typed && revealed.isEmpty()) {") &&
            search.includes('item { SectionLabel("Hidden") }') &&
            search.includes(
              'items(revealed, key = { "h" + it.optString("id") }) { c -> HiddenChatRow(c, nav) }',
            ) &&
            search.includes(
              'items(revealedCalls, key = { "call_" + it.optString("id") }) { call ->',
            ) &&
            search.includes("private fun HiddenChatRow(conv: JSONObject, nav: NavController) {") &&
            search.includes(
              'ResultCard(onClick = { haptics.tap(); nav.navigate("chat/$id") { popUpTo("main") } }) {',
            ) &&
            search.includes(
              'withContext(Dispatchers.IO) { Api.post("/api/conversations/$id/hide", JSONObject().put("hidden", false)) }',
            ) &&
            search.includes("}.onFailure { ScreenStore.setHidden(id, true, prev) }") &&
            search.includes(
              'Icon(Icons.Filled.Visibility, "Unhide", tint = ActionBlueDeep, modifier = Modifier.size(22.dp))',
            ),
        );
        check(
          "r32-23: hidden calls — call rows whose chat is hidden leave the Calls tab (ScreenStore.isHiddenCall via hiddenCallConv / convIdForUser) and come back with the chat under a Calls heading in Search",
          store.includes("fun isHiddenCall(call: JSONObject): Boolean {") &&
            store.includes("val cid = hiddenCallConv(call) ?: return false") &&
            store.includes("fun callPeerId(call: JSONObject): String =") &&
            kt("CallsTabScreen.kt").includes("calls.filter { !ScreenStore.isHiddenCall(it) }") &&
            kt("CallsTabScreen.kt").includes("} else if (shown.isEmpty()) {") &&
            kt("CallsTabScreen.kt").includes(
              "internal fun CallRow(call: JSONObject, onOpenChat: () -> Unit) {",
            ) &&
            search.includes(
              "else ScreenStore.calls.filter { call -> ScreenStore.hiddenCallConv(call)?.let { it in revealedIds } == true }",
            ) &&
            search.includes('item { SectionLabel("Calls") }'),
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
          chat.includes("VoiceWaveform.pseudo(barSeed)") &&
          chat.includes('m.optString("clientId").ifBlank { id }') &&
          chat.includes("color = if (x <= playedUntil) played else rest,") &&
          chat.includes("cap = StrokeCap.Round,") &&
          // r33-1: the tap seek reads the rememberUpdatedState holder (`seek`).
          chat.includes("seek((up.position.x / size.width).coerceIn(0f, 1f))") &&
          chat.includes(
            "if (!pendingEcho && fileKey.isNotBlank()) player.seekTo(ctx, id, fileKey, frac)",
          ) &&
          // r33-1: the time line also follows a scrub on the bars.
          chat.includes("(active || scrubAt != null) && secs > 0 -> {") &&
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
            '"FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme, onOpenDoc, onToggleSelect, onLongPress, selecting = selectedIds.isNotEmpty(), onCancelSend = onCancelSend, fxGrow = fxFresh)',
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
          // r32-17: a view-once photo joins no album.
          src.includes("...(album && !viewOnce ? { album } : {}),") &&
          src.includes("if (meta.document === true || meta.voice === true) return null;") &&
          src.includes("album?: string;"),
      );
    }
    check(
      "r31-29: app — the grid send stamps ONE album id on 2+ photos (single photo: none), the pending row + both payloads carry it, a retry keeps it, forwarding 2+ photos re-groups them",
      chat.includes("internal fun newAlbumId(): String =") &&
        // r36-1: once ITEMS join no album (the batch switch is gone).
        chat.includes(
          "val album = if (batch.count { !it.isVideo && !it.once } >= 2) newAlbumId() else null",
        ) &&
        chat.includes(
          'fun sendImage(\n        dataUrl: String,\n        album: String? = null,\n        viewOnce: Boolean = false,\n        sendAt: java.time.Instant? = null,\n        caption: String = "",\n        w: Int = 0,\n        h: Int = 0,\n    ) {',
        ) &&
        chat.includes('if (album != null) o.put("album", album)') &&
        chat.includes('.also { row -> metaWith(w, h)?.let { row.put("meta", it) } }') &&
        (chat.match(/metaWith\(shotW, shotH\)\?\.let \{ payload\.put\("meta", it\) \}/g) || [])
          .length === 1 &&
        chat.includes("fun handleImagePicked(uri: Uri, album: String? = null) {") &&
        chat.includes(
          'url.isNotBlank() -> sendImage(url, p.optJSONObject("meta")?.optString("album")?.ifBlank { null }, isViewOnce(p))',
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

    // r31-30: status lands straight in the editor (round 37 retired the
    // share screen) — full-bleed dark stage, Close on top, ONE Done check, no
    // caption bar; video trim (first minute preselected, window slides
    // anywhere, never over a minute) + crop for photo AND video; the clip is
    // cut on the phone (GPU re-encode, sample-copy fallback) and only the
    // result is uploaded.
    {
      const kit = kt("CropTrimKit.kt");
      const edit30 = kt("MediaEditScreen.kt");
      const exp = kt("VideoExport.kt");
      const plan = readFileSync(
        "native-android/app/src/test/java/app/kuchupuchu/android/VideoPlanTest.kt",
        "utf8",
      );
      check(
        "r31-30: status mode — no caption bar (posts carry no text), no Post / 'Choose photo or video' buttons; dark stage + Close + one Done check; the >60s rejection is gone",
        // v164: the guard also keeps the caption bar out of the profile-photo
        // flow, which shares this screen.
        edit30.includes("if (!statusMode && !avatarMode) {") &&
          !edit30.includes('GoldBtn("Post")') &&
          !edit30.includes('GoldBtn("Choose photo or video")') &&
          !edit30.includes("Video status can be at most 1 minute.") &&
          edit30.includes(".fillMaxSize()\n            .background(Color.Black)") &&
          edit30.includes('Icon(Icons.Filled.Close, "Close", tint = Color.White') &&
          edit30.includes('"Done"') &&
          edit30.includes("contentDescription =") &&
          edit30.includes('.put("text", ""),'),
      );
      check(
        "r31-30: video — status preselects the first minute (VideoPlan.defaultWindow), a trim strip with slide/start/end handles, a crop overlay with Original/9:16/1:1/Free, the cut clip's real length goes up as `seconds`",
        edit30.includes("val (s, e) = VideoPlan.defaultWindow(src.durationMs)") &&
          kit.includes("internal fun TrimStrip(") &&
          // r32-43: the drag is absolute (window at touch-down + total travel)
          kit.includes(
            "1 -> VideoPlan.moveStart(grabS, grabE, durationMs, grabS + deltaMs, maxMs)",
          ) &&
          kit.includes(
            "2 -> VideoPlan.moveEnd(grabS, grabE, durationMs, grabE + deltaMs, maxMs)",
          ) &&
          kit.includes("3 -> VideoPlan.slide(grabS, grabE, durationMs, deltaMs)") &&
          kit.includes("internal fun CropOverlay(") &&
          edit30.includes('listOf("Original", "9:16", "1:1", "Free").forEach { name ->') &&
          edit30.includes('.put("seconds", ((e - s + 500L) / 1000L).toInt().coerceAtLeast(1))') &&
          // v164: the bakes read the editor's WORKING media (Done can bake an
          // applied copy into it), which is the pick until it does.
          edit30.includes("VideoExport.export(ctx, mediaUri, s, e, box, cut,") &&
          edit30.includes("VideoExport.passthrough(ctx, mediaUri, s, e, cut)") &&
          edit30.includes(
            "if (!VideoPlan.needsTranscode(box, s, e, vSource.durationMs, size, mime) && !hasEdits) {",
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
      const kit31 = kt("CropTrimKit.kt");
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
        "r31-31: the picker IS the app gallery — loadMediaPool + MediaCell from the attach panel, folder chips, 4 columns, one tap → the editor in status mode replacing the picker; no system picker anywhere in the flow",
        at.includes(
          "internal fun loadMediaPool(ctx: android.content.Context): List<MediaItem> {",
        ) &&
          at.includes("internal fun MediaCell(") &&
          pick.includes(
            "pool = withContext(Dispatchers.IO) { runCatching { loadMediaPool(ctx) }.getOrDefault(emptyList()) }",
          ) &&
          pick.includes("columns = GridCells.Fixed(4),") &&
          pick.includes('ScreenStore.editTitle = "Status"') &&
          pick.includes('nav.navigate("mediaedit/status/0/" + statusPickArg(item)) {') &&
          pick.includes('popUpTo("statuspick") { inclusive = true }') &&
          pick.includes("internal fun statusPickArg(item: MediaItem): String =") &&
          pick.includes(
            "internal fun statusPickDecode(arg: String): Pair<android.net.Uri, Boolean>? =",
          ) &&
          !pick.includes("PickVisualMedia") &&
          !kit31.includes("PickVisualMedia") &&
          !kit31.includes("rememberLauncherForActivityResult") &&
          app.includes('composable("statuspick") { StatusPickScreen(nav) }') &&
          app.includes('composable("mediaedit/{conv}/{once}/{arg}") { entry ->') &&
          !app.includes("statusphoto/") &&
          !app.includes("StatusPhotoScreen("),
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
      "onPress = {\n                                    pressedAt = android.os.SystemClock.uptimeMillis()\n                                    holding = true\n                                    tryAwaitRelease()\n                                    holding = false",
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
      rx.includes("PackageInstaller.STATUS_FAILURE_ABORTED -> {") &&
      rx.includes("KpUpdate.installing = false") &&
      rx.includes("KpUpdate.noteStatus(ctx, code, null)") &&
      rx.includes("intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)") &&
      upd.includes("!ctx.packageManager.canRequestPackageInstalls()") &&
      upd.includes("android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES") &&
      upd.indexOf("canRequestPackageInstalls()") <
        upd.indexOf("withContext(Dispatchers.IO) { install(ctx, apk) }"),
  );
  // Release solidity: the update flow leaves breadcrumbs, so a crash
  // anywhere past the Update tap names its phase in the report — and
  // the report keeps the whole stack (the sheet scrolls).
  check(
    "release: crash-report solidity — update_ready / update_committed success marks, update_dl/install/session _failed marks with the exception name, the saved report keeps 4000 chars",
    (() => {
      const crash = kt("KpCrash.kt");
      return (
        upd.includes('KpCrash.mark("update_ready")') &&
        upd.includes('KpCrash.mark("update_committed")') &&
        upd.includes('KpCrash.mark("update_dl_failed:${e.javaClass.simpleName}")') &&
        upd.includes('KpCrash.mark("update_install_failed:${it.javaClass.simpleName}")') &&
        upd.includes('KpCrash.mark("update_session_failed:${e.javaClass.simpleName}")') &&
        crash.includes("?.readText()?.take(4000)")
      );
    })(),
  );
  check(
    "r34-2: the updater verifies the APK before any session (bytes vs Content-Length, getPackageArchiveInfo parse, same package, strictly newer build, signing-cert match with the install — fail open when certs are unreadable) and fetches the flavor-matching asset, so a damaged or mis-signed file never reaches the system installer; sessions are attributed and abandoned on failure, and the status receiver can never crash the app",
    upd.includes("FLAG_DEBUGGABLE") &&
      upd.includes('name.contains("debug", ignoreCase = true) == wantDebug') &&
      upd.includes("apkUrl = url ?: fallback ?: return@runCatching") &&
      upd.includes("out.length() != total") &&
      upd.includes("verifyUpdateApk(ctx, out)") &&
      upd.includes("private fun verifyUpdateApk(ctx: Context, apk: File)") &&
      upd.includes("getPackageArchiveInfo") &&
      upd.includes("GET_SIGNING_CERTIFICATES") &&
      upd.includes("apkContentsSigners") &&
      upd.includes("archiveCode <= installedVersionCode(ctx)") &&
      upd.includes("mine != null && theirs != null && mine != theirs") &&
      upd.includes("wasn't built for your install") &&
      upd.includes("params.setAppPackageName(ctx.packageName)") &&
      upd.includes("installer.abandonSession(sessionId)") &&
      rx.includes("runCatching {\n            val code = intent.getIntExtra") &&
      rx.includes("when (code) {"),
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
  // v166: sendImage / sendFile grew their own w / h (and sendFile a durMs),
  // so the bodies are located by their stable opening lines.
  const sendImageBody = chat32.slice(
    chat32.indexOf("fun sendImage("),
    chat32.indexOf("suspend fun sendFile("),
  );
  const sendVoiceBody = chat32.slice(
    chat32.indexOf("fun sendVoice(file: File, seconds: Int"),
    chat32.indexOf("fun handleImagePicked("),
  );
  const sendTextBody = chat32.slice(
    chat32.indexOf('fun sendText(body: String, kind: String = "TEXT") {'),
    chat32.indexOf("fun sendImage("),
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
        "scope.launch {\n            runCatching { KpSounds.send(ctx) }\n            // Owner round 33 (item 3)",
      ) &&
      !/scope\.launch \{\n\s+listState\.animateScrollToItem/.test(chat32) &&
      !/scope\.launch \{\n\s+val total = msgs\.size \+ pending\.size\n\s+if \(total > 0\) listState\.animateScrollToItem/.test(
        chat32,
      ) &&
      chat32.includes(
        'suspend fun readAndSendImage(uri: Uri, album: String?, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "", hd: Boolean = false) {',
      ) &&
      chat32.includes("scope.launch { readAndSendImage(uri, album) }") &&
      chat32.includes(
        "if (item.isVideo) handleDocumentPicked(item.uri, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, album, sendAt = sendAt, caption = item.caption, hd = item.hd)",
      ) &&
      // refresh's forced scroll survives an interrupted scroll too (r45
      // item 1: the AI reveal loop this used to name is gone — no
      // entrance effects of any kind)
      chat32.includes(
        "runCatching { listState.animateScrollToItem(total - 1) }\n                }\n                lastTopId = newTop",
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
  const share32 = kt("CropTrimKit.kt");
  const edit43 = kt("MediaEditScreen.kt");
  const playerCls = share32.slice(
    share32.indexOf("private class TrimClipPlayer("),
    share32.indexOf("internal fun TrimStrip("),
  );
  const stripFn = share32.slice(
    share32.indexOf("internal fun TrimStrip("),
    share32.indexOf("internal fun CropOverlay("),
  );
  const cropFn = share32.slice(share32.indexOf("internal fun CropOverlay("));
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
      edit43.includes(
        // v164: the preview plays the working media.
        "paused = vidPaused,\n                                    turn = rotation,",
      ) &&
      edit43.includes("onPosition = { playAt = it }"),
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
      edit43.includes("onScrub = { scrub = it },"),
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
    "r32-28: app — list no longer shows ticks (owner: chat list theke tick remove)",
    !chatList32.includes(
      "ListTicks(read = otherRead.isNotBlank() && otherRead >= newestAt, delivered = delivered)",
    ) && chatList32.includes("private fun ListTicks(read: Boolean, delivered: Boolean = read) {"),
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
  const emo = kt("EmojiAnim.kt");
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
    "r32-22: compact reply preview — in-bubble quote is ONE annotated line (name bold + text) with a 20 dp stripe and 3 dp vertical padding; the composer's ReplyQuoteBar is one line with a 22 dp stripe (r33-17: 34 dp when a media card sits beside it)",
    chat1516.includes(
      "Box(Modifier.width(2.5.dp).height(if (thumbed) 34.dp else 20.dp).clip(RoundedCornerShape(2.dp)).background(chatAccent(theme)))",
    ) &&
      chat1516.includes(".padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),") &&
      (chat1516.match(/withStyle\(SpanStyle\(fontWeight = FontWeight\.SemiBold\)\)/g) || [])
        .length >= 2 &&
      !chat1516.includes("Box(Modifier.width(2.5.dp).height(26.dp)") &&
      !chat1516.includes(".height(30.dp)\n                .clip(RoundedCornerShape(2.dp))") &&
      chat1516.includes(
        ".height(if (thumbed) 34.dp else 22.dp)\n                .clip(RoundedCornerShape(2.dp))",
      ),
  );
  // Item 8: an emoji-only message has NO bubble (no lift, no fill, no 72 dp
  // minimum); the stamp sits in the band under the glyph in the wallpaper's
  // ink, and the ticks follow that ink so they never vanish on a light theme.
  check(
    "r32-8 + N3a + N3r: emoji-only TEXT (+ STICKER now) → transparent bubble (no shadow, transparent fill, min width 0), glyph row keeps the 2dp side room for the stamp/ticks, stamp + ticks use the wallpaper ink",
    chat1516.includes(".then(if (noBubble) Modifier else Modifier.shadow(2.dp, bubbleShape))") &&
      chat1516.includes(
        "noBubble -> Brush.linearGradient(listOf(Color.Transparent, Color.Transparent))",
      ) &&
      // v170: the floor is now 96 dp - wide enough for the stamp under it.
      chat1516.includes(".widthIn(max = bubbleMax)") &&
      chat1516.includes(".wrapContentWidth()") &&
      // r46 item 4: the floor is a requiredMinWidth AFTER wrapContentWidth -
      // wrapContentWidth ignores the incoming MIN, so a widthIn(min=...)
      // placed outside it never held on device (72 dp and 104 dp both lost).
      chat1516.includes(
        ".then(if (emojiOnly > 0) Modifier else Modifier.requiredWidthIn(min = 79.dp))",
      ) &&
      // r33-5: the fixed 30 dp end room is gone — the stamp gets its own
      // measured row under the glyph (KpStamped below = true).
      emo.includes(".padding(start = 2.dp, end = 2.dp)") &&
      !chat1516.includes("end = if (mine) 30.dp else 10.dp") &&
      chat1516.includes("color = stampInk,") &&
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
        kt("DeleteAnim.kt").includes(
          ".background(if (rowSelected) ActionBlue.copy(alpha = 0.16f) else Color.Transparent)",
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
  // Owner round 39 (item 1): the photo viewer wires a third row, Edit
  // (Save / Forward / Edit order); the player leaves it null (Save /
  // Forward as before).
  {
    const mv = kt("MediaViewer.kt");
    const chat = kt("ChatScreen.kt");
    const tab = kt("ChatMediaScreen.kt");
    check(
      "r32-46: viewer ⋮ → sheet = Save / Forward / Edit (player: Save / Forward; v166: + Delete everywhere, both directions); one IO forward helper (forwardMessageTo) used by chat select, photo viewer, video player and the media tab",
      mv.includes("internal fun MediaMenuSheet(") &&
        mv.includes(
          'if (onSave != null) KpSheetRow(Icons.Filled.Download, "Save", onClick = onSave)',
        ) &&
        mv.includes(
          'if (onForward != null) KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward", onClick = onForward)',
        ) &&
        mv.includes(
          'if (onEdit != null) KpSheetRow(Icons.Filled.Brush, "Edit", onClick = onEdit)',
        ) &&
        // v166 (owner: "okhane Save, Forward, Delete"): the Delete row joins
        // the sheet for every surface — it opens the shared confirm
        // (KpDeleteSheet), whose wording is the chat's own.
        mv.includes(
          'if (onDelete != null) KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red, onClick = onDelete)',
        ) &&
        // 4 in the action sheet + the 2 in the shared delete confirm
        // 4 in the action sheet + 2 in the delete confirm + v167's Dismiss
        (mv.match(/KpSheetRow\(/g) || []).length === 7 &&
        // Only the photo viewer passes onEdit (the player relies on the null default).
        (mv.match(/onEdit = /g) || []).length === 1 &&
        mv.includes("onEdit = onEdit?.let { e -> { menuOpen = false; e() } },") &&
        // The chat's Edit downloads the current page into cache and opens
        // the existing media editor (Done → pendingEdited → sent).
        chat.includes('FilesUtil.cacheFile(ctx, "viewer-edit.jpg", bytes, "image/jpeg")') &&
        (mv.match(/Icons\.Filled\.MoreVert, "More"/g) || []).length === 2 &&
        !mv.includes("private fun ViewerAction(") &&
        // r34-6: the album position pill joins the player's seek bar at the bottom.
        (mv.match(/\.align\(Alignment\.BottomCenter\)/g) || []).length === 2 &&
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
        'internal fun ForwardDialog(onClose: () -> Unit, onSend: (List<String>) -> Unit, title: String = "Forward to") {',
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
      "r32-45: voice bubble is compact — a 28dp play circle (v168, was 32/36), a 16dp wave (was 18/22), duration right under it, the bubble keeps a 3dp bottom for voice notes instead of the blank 15dp band (voiceNote); the recording strip paints VoiceNote.livePeaks (newest 4 s, sqrt curve, LIVE_BARS wide) between the timer and the cancel hint; both draw through DrawScope.drawVoiceBars",
      chat.includes("internal fun fileLooksVoice(m: JSONObject): Boolean {") &&
        chat.includes('val fileRow = kind == "FILE"') &&
        chat.includes("val isVoice = !asDocument && fileLooksVoice(m)") &&
        chat.includes("modifier = Modifier.width(150.dp).height(22.dp),") &&
        !chat.includes("modifier = Modifier.width(150.dp).height(30.dp),") &&
        chat.includes(
          "internal fun DrawScope.drawVoiceBars(bars: List<Int>, progress: Float, played: Color, rest: Color, newest: Boolean = false, reveal: Float = Float.MAX_VALUE) {",
        ) &&
        chat.includes("drawVoiceBars(bars, progress, played, rest, reveal =") &&
        chat.includes("val g = (reveal - i).coerceIn(0f, 1f)") &&
        chat.includes(
          "Canvas(modifier) { drawVoiceBars(VoiceNote.livePeaks, 1f, color, color, newest = true) }",
        ) &&
        chat.includes(
          "LiveVoiceWave(color = accent, modifier = Modifier.weight(1f).height(22.dp))",
        ) &&
        chat.includes('Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)') &&
        (chat.match(/\.size\(28\.dp\)\n\s+\.pressScale\(interaction\)/g) || []).length === 1 &&
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
        'SettingRow(icon = null, statusGlyph = true, label = "Status updates", value = privacyLabel(level("status", "public"))) { picker = "privStatus" }',
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
      chat.indexOf("private fun compactFileName("),
    );
    check(
      "r32-34: document bubble — progress ring + open spinner sit ON the 40dp icon (36dp ring, themed track), the right-hand slot with 'Open' / the ring is gone, the size line keeps the stamp's corner clear (padding end 50/34dp), a missing file fades the icon",
      bubble.includes("trackColor = docInk.copy(alpha = 0.22f),") &&
        // r32-33: the open spinner went with the in-bubble download — the
        // viewer screen downloads now; only the upload ring remains.
        (bubble.match(/modifier = Modifier\.size\(36\.dp\),/g) || []).length === 1 &&
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
        // r33-3b: the upload moved into the queue (Outbox.materialize) — queue-first.
        chat.includes("fun sendFile(\n        convId: String,\n        clientId: String,") &&
        // v163: the same callback also stops the bytes when the send was
        // cancelled (the ✕), which is what makes cancel mean cancel.
        kt("Cache.kt").includes("Api.uploadFile(name, mime, f) { w, t ->") &&
        kt("Cache.kt").includes(
          'if (isCancelled(clientId)) throw ApiException(499, "Cancelled.")',
        ) &&
        kt("Cache.kt").includes("UploadProgress.set(clientId, 0.9f * w / t)") &&
        kt("Cache.kt").includes("if (status in 400..499 && status != 408 && status != 429) {") &&
        // v163: the flat 25 MB refusal became the per-kind ceiling.
        chat.includes("val cap = Api.limitFor(mime, name)") &&
        chat.includes("if (file.length() > cap) {") &&
        chat.includes(
          "Uploads.sendFile(convId, clientId, name, mime, file, docMeta) { outcome ->",
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
      "r32-35: worker — send preview comes from previewOf (no 'photo.jpg'), image/video/audio media files read as words (r33-12: Documents read 'Document'), push data carries kp_media only for a picture",
      src.includes("const preview = previewOf({") &&
        !src.includes('kind === "FILE" ? String(body.fileName || "File") : "Message"') &&
        // r32-17: "Photo · View once" rides the same lines.
        previewOf.includes('if (type.startsWith("image/")) return `Photo${once}`;') &&
        previewOf.includes('if (type.startsWith("video/")) return `Video${once}`;') &&
        previewOf.includes("if (meta.document !== true) {") &&
        src.includes("const pictureUrl =\n      message.hasImage && !message.viewOnce") &&
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
  // Item 36: KuchuPuchu in the system share sheet. A dedicated translucent
  // ShareActivity (SEND / SEND_MULTIPLE for text, image, video, audio,
  // application) copies the shared content into the cache while the sender's
  // URI grant is valid, hands it to MainActivity.pendingShare, brings the app
  // forward and finishes; KpApp shows the multi-select picker titled "Send to";
  // ShareSend uploads each file once on its own scope and posts to every
  // picked chat (photo → JPEG photo with dims / album, video → media, else
  // document; > 25 MB skipped).
  {
    const share = kt("ShareIntake.kt");
    const app = kt("KpApp.kt");
    const main = kt("MainActivity.kt");
    const svc = manifest.slice(
      manifest.indexOf('android:name=".ShareActivity"'),
      manifest.indexOf("</activity>", manifest.indexOf('android:name=".ShareActivity"')),
    );
    check(
      "r32-36: manifest — ShareActivity is exported, translucent, out of recents, filters SEND (text/image/video/audio/application) and SEND_MULTIPLE; MainActivity keeps only its launcher filter",
      svc.includes('android:exported="true"') &&
        svc.includes('android:excludeFromRecents="true"') &&
        svc.includes('android:noHistory="true"') &&
        svc.includes('android:theme="@android:style/Theme.Translucent.NoTitleBar"') &&
        svc.includes('<action android:name="android.intent.action.SEND" />') &&
        svc.includes('<action android:name="android.intent.action.SEND_MULTIPLE" />') &&
        (svc.match(/<data android:mimeType="image\/\*" \/>/g) || []).length === 2 &&
        svc.includes('<data android:mimeType="text/*" />') &&
        svc.includes('<data android:mimeType="application/*" />') &&
        !/android:name="\.MainActivity"[\s\S]*?android\.intent\.action\.SEND[\s\S]*?<\/activity>/.test(
          manifest.slice(0, manifest.indexOf('android:name=".ShareActivity"')),
        ),
      svc.replace(/\s+/g, " ").slice(0, 160),
    );
    check(
      "r32-36: intake — ShareActivity copies off the main thread via FilesUtil.copyDocument (EXTRA_STREAM via IntentCompat, clip fallback), skips > 25 MB non-pictures before copying, publishes MainActivity.pendingShare, brings MainActivity forward and finishes",
      share.includes("class ShareActivity : ComponentActivity() {") &&
        share.includes(
          "IntentCompat.getParcelableArrayListExtra(i, Intent.EXTRA_STREAM, Uri::class.java)",
        ) &&
        share.includes(
          "IntentCompat.getParcelableExtra(i, Intent.EXTRA_STREAM, Uri::class.java)",
        ) &&
        share.includes("val clip = i.clipData ?: return emptyList()") &&
        share.includes("FilesUtil.copyDocument(app, uri, name) ?: return@runCatching null") &&
        share.includes(
          // v163: pictures skip the check only because their own ceiling is
          // read from the same helper.
          'if (!declared.startsWith("image/") && querySize(app, uri) > Api.limitFor(declared, name)) {',
        ) &&
        share.includes("MainActivity.pendingShare.value = SharePayload(text, items)") &&
        share.includes(
          "Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,",
        ) &&
        main.includes(
          "internal val pendingShare = kotlinx.coroutines.flow.MutableStateFlow<SharePayload?>(null)",
        ),
    );
    check(
      "r32-36: picker + send — KpApp collects pendingShare into the ForwardDialog titled 'Send to' (close discards the copies, one target opens that chat); ShareSend runs on a SupervisorJob scope, uploads once per file, posts per target, photo → JPEG with dims (album when 2+), video → media, else document, deletes the copies, pokes the inbox",
      app.includes("val share by MainActivity.pendingShare.collectAsState()") &&
        app.includes('title = "Send to",') &&
        app.includes("ShareSend.discard(payload)") &&
        app.includes("ShareSend.send(appCtx, targets, payload) { ok ->") &&
        app.includes(
          'runCatching { nav.navigate("chat/${targets[0]}") { launchSingleTop = true } }',
        ) &&
        share.includes("internal object ShareSend {") &&
        share.includes("private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)") &&
        share.includes(
          "val jpeg = FilesUtil.imageToJpeg(Uri.fromFile(item.file), ctx, maxSide = 1440, maxBytes = 285_000)",
        ) &&
        share.includes("val album = if (photos >= 2) newAlbumId() else null") &&
        share.includes(
          'if (!item.mime.startsWith("video/")) body.put("meta", JSONObject().put("document", true))',
        ) &&
        share.includes(
          "if (item.file.length() > Api.limitFor(item.mime, item.file.name)) return null",
        ) &&
        share.includes("payload.items.forEach { runCatching { it.file.delete() } }") &&
        share.includes("ScreenStore.pokeInbox()"),
    );
  }
  // Item 38: message requests. A first chat opened from username search with
  // someone outside the phone book is a request (conversations.request_from);
  // the recipient gets Accept / Block in place of the composer; calls, shared
  // media and last seen wait on both sides (server-enforced); a reply accepts.
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const chat = kt("ChatScreen.kt");
    const profile = kt("ProfileScreen.kt");
    const search = kt("SearchScreen.kt");
    const newChat = kt("NewChatScreen.kt");
    check(
      "r32-38: worker — request_from column, `request: true` marks a stranger's first chat, requestFrom / requestPending in the detail, POST /accept (recipient only, both sides poked), a reply accepts, calls + media refuse REQUEST_PENDING, isContact/contactSet exclude pending pairs, last seen withheld across a request",
      src.includes("ALTER TABLE conversations ADD COLUMN request_from TEXT") &&
        src.includes(
          "body.request === true && other !== OFFICIAL_BOT_ID && other !== AI_BOT_ID ? uid : null",
        ) &&
        src.includes("requestFrom: solo ? (conv.request_from ?? null) : null,") &&
        src.includes("requestPending: solo && !!conv.request_from && conv.request_from !== uid,") &&
        src.includes(
          "const acceptMatch = path.match(/^\\/api\\/conversations\\/([^/]+)\\/accept$/);",
        ) &&
        src.includes('fail(403, "The other person accepts this request.", "FORBIDDEN");') &&
        src.includes(
          'if (conv.kind === "SOLO" && conv.request_from && conv.request_from !== uid) {',
        ) &&
        (src.match(/fail\(403, "Accept the message request first\.", "REQUEST_PENDING"\);/g) || [])
          .length === 2 &&
        src.includes('"SELECT id FROM conversations WHERE id = ? AND request_from IS NULL",') &&
        src.includes(
          "async function requestPendingBetween(db: D1Database, uid: string, otherId: string) {",
        ) &&
        src.includes("if (solo && conv.request_from && row.user_id !== uid) {") &&
        src.includes("c.requestFrom,"),
    );
    check(
      "r32-38: app — search / new-chat opens pass `request` = not in the phone book; the chat shows Block / Accept in place of the composer while requestPending (Accept → POST /accept, Block → POST /api/blocks + leave); header calls, the media menu entry and last seen hide while a request is open; the profile hides calls + shared media too",
      search.includes('JSONObject().put("userId", userId).put("request", !known)') &&
        newChat.includes(
          'JSONObject().put("userId", user.optString("id")).put("request", !known),',
        ) &&
        chat.includes('val requestPending = !isGroup && c?.optBoolean("requestPending") == true') &&
        chat.includes("val requestOpen = requestPending || requestSent") &&
        chat.includes("if (!isGroup && c != null && !botChat && !requestOpen && !blockWall) {") &&
        chat.includes('requestOpen -> " "') &&
        chat.includes(
          'if (!requestOpen) {\n                            KpSheetRow(Icons.Filled.PermMedia, "Media, links, and docs")',
        ) &&
        chat.includes("if (requestPending) {") &&
        chat.includes('Api.post("/api/conversations/$convId/accept")') &&
        chat.includes('Api.post("/api/blocks", JSONObject().put("userId", otherUserId))') &&
        chat.includes(
          '{ Text("Accept", color = ActionBlueInk, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }',
        ) &&
        chat.includes(
          '{ Text("Block", color = Red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }',
        ) &&
        profile.includes(
          'val requestOpen = peerConv?.optText("requestFrom")?.isNotBlank() == true',
        ) &&
        profile.includes("if (!isMe && !isKpBot(userId) && !requestOpen) {") &&
        profile.includes(
          "if (!isMe && !requestOpen) Column(Modifier.padding(horizontal = 16.dp).weight(1f)) {",
        ),
    );
  }
  // Items 30/31: ONE badge row (UserBadges) on every screen — chat list, chat
  // header, profile, all call screens, status list + viewer, group members —
  // driven by the server's `badge` choice; multi-badge accounts pick All /
  // Verified / Moderator / None from a bottom sheet on their own profile.
  {
    const ui = kt("Ui.kt");
    const chat = kt("ChatScreen.kt");
    const cl = kt("ChatListScreen.kt");
    const profile = kt("ProfileScreen.kt");
    const calls = kt("CallScreens.kt");
    const engine = kt("CallEngine.kt");
    const status = kt("StatusScreens.kt");
    const group = kt("GroupInfoScreen.kt");
    const src = readFileSync("src/worker/index.ts", "utf8");
    check(
      "r32-30: UserBadges(user, size, gap) in Ui.kt honours badge = verified / moderator / none / null(all); used on the chat list row, chat header, profile, every call screen name line (CallUi.otherUser), status list + viewer header and the group member list — the old per-screen verified/moderator pairs are gone",
      ui.includes("fun UserBadges(user: JSONObject?, size: Dp = 16.dp, gap: Dp = 5.dp) {") &&
        ui.includes('if (choice == "none") return') &&
        ui.includes(
          'val verified = user.optBoolean("verified") && (choice == null || choice == "verified")',
        ) &&
        cl.includes("if (!isGroup) UserBadges(other)") &&
        chat.includes("if (!isGroup) UserBadges(other)") &&
        !chat.includes(
          'val verified = !isGroup && c?.optJSONObject("other")?.optBoolean("verified") == true',
        ) &&
        profile.includes("UserBadges(u, 16.dp, gap = 6.dp)") &&
        engine.includes("val otherUser: JSONObject? = null,") &&
        // r32-5b: a group call has no single peer to badge.
        engine.includes(
          'otherUser = if (!isGroup && other.has("id")) other else current?.otherUser,',
        ) &&
        (calls.match(/UserBadges\(call\.otherUser/g) || []).length === 5 &&
        status.includes("UserBadges(user)") &&
        status.includes("UserBadges(user ?: Store.me, 14.dp)") &&
        group.includes("UserBadges(u, 14.dp)") &&
        !/VerifiedBadge\(\)\s*\}\s*if \(.*moderator/.test(cl + chat + profile),
    );
    check(
      "r32-31: worker — users.badge column, badgeChoice() validated against the held flags on every user shape, PATCH /api/me badge ∈ verified|moderator|none|null (400 BAD_BADGE otherwise / not held); app — own profile with 2+ badges shows a 'Badge' row → sheet 'Which badge to show?' with All / Verified / Moderator / None → PATCH /api/me",
      src.includes("ALTER TABLE users ADD COLUMN badge TEXT") &&
        src.includes("function badgeChoice(row: UserRow): string | null {") &&
        src.includes("badge: badgeChoice(row),") &&
        src.includes('fail(400, "You don\'t hold that badge.", "BAD_BADGE");') &&
        profile.includes('if (u.optBoolean("verified") && u.optBoolean("moderator")) {') &&
        profile.includes('ProfileEditRow(Icons.Filled.Verified, "Badge", shown) {') &&
        profile.includes(
          'KpSheet(onDismiss = { badgeSheet = false }, title = "Which badge to show?") {',
        ) &&
        profile.includes('KpSheetRow(Icons.Filled.VisibilityOff, "None"') &&
        profile.includes(
          'Api.patch("/api/me", JSONObject().put("badge", choice ?: JSONObject.NULL))',
        ),
    );
  }
  // Item 32: links in a chat are clickable and carry a preview card.
  {
    const lp = kt("LinkPreview.kt");
    const chat = kt("ChatScreen.kt");
    const cache = kt("Cache.kt");
    check(
      "r32-32: LinkPreview.kt — Links.RE / clean / first / annotate (LinkAnnotation.Url + underline, taps handled by Links.open — no default handler throw), LinkPreviews (snapshot map + one file, fetched through /api/link-preview) and LinkPreviewCard (v166: a 96dp worker-relayed picture band, title 2 lines, description 1 line, host); Cache.init warms the card file",
      lp.includes(
        'val RE = Regex("""(?:https?://|www\\.)[^\\s<>"\']+""", RegexOption.IGNORE_CASE)',
      ) &&
        lp.includes(
          "fun annotate(text: String, ink: Color, open: (String) -> Unit): AnnotatedString? {",
        ) &&
        lp.includes("withLink(LinkAnnotation.Url(u, styles, listener)) { append(u) }") &&
        lp.includes("textDecoration = TextDecoration.Underline") &&
        lp.includes('Api.request("/api/link-preview?url=${Api.q(url)}", "GET", null)') &&
        lp.includes(
          "internal fun LinkPreviewCard(url: String, mine: Boolean, ink: Color, onOpen: (() -> Unit)?) {",
        ) &&
        lp.includes('model = if (image.startsWith("/")) Api.BASE + image else image,') &&
        // v166 (owner: "chat a link dile link card bubble ta compact koro
        // choto koro"): the full-width 1.91:1 banner is a short fixed band.
        lp.includes("private val LINK_THUMB_H = 96.dp") &&
        lp.includes("modifier = Modifier.fillMaxWidth().height(LINK_THUMB_H),") &&
        cache.includes("runCatching { LinkPreviews.init(app) }"),
    );
    check(
      "r32-32: the TEXT bubble annotates its body (plain Text again in select mode so taps go to the bubble) and shows LinkPreviewCard for the first link above the text",
      chat.includes("else Links.annotate(full, bodyInk) { u -> Links.open(ctx, u) }") &&
        chat.includes("val firstLink = remember(full) { Links.first(full) }") &&
        chat.includes("onOpen = if (selecting) null else ({ Links.open(ctx, firstLink) }),") &&
        chat.includes("linked,\n                                        fontSize = 14.5.sp,") &&
        chat.includes("maxLines = if (capped) BODY_COLLAPSE_LINES else Int.MAX_VALUE,") &&
        chat.indexOf("LinkPreviewCard(") < chat.indexOf("linked,"),
    );
  }
  // Item 33: documents open inside the app.
  {
    const doc = kt("DocViewerScreen.kt");
    const tiff = kt("TiffDecoder.kt");
    const arc = kt("ArchiveList.kt");
    const chat = kt("ChatScreen.kt");
    const media = kt("ChatMediaScreen.kt");
    const app = kt("KpApp.kt");
    check(
      "r32-33: DocViewerScreen (route docviewer/{b64}) renders PDF pages (PdfRenderer, pinch zoom, locked → 'Locked PDF'), text (selectable monospace), pictures, SVG (offline WebView: no JS / network / file access, scripts stripped), TIFF (own decoder), ZIP / RAR contents (lock mark), and a name / type / size card for the rest; ⋮ → bottom sheet Save / Forward / Open with",
      app.includes('composable("docviewer/{b64}") { entry ->') &&
        doc.includes("fun DocViewerScreen(nav: NavController, b64: String) {") &&
        doc.includes(
          "private enum class DocKind { PDF, TEXT, IMAGE, SVG, TIFF, ARCHIVE, OTHER }",
        ) &&
        doc.includes("val r = PdfRenderer(pfd)") &&
        doc.includes("locked = e is SecurityException") &&
        doc.includes("page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)") &&
        doc.includes("SelectionContainer {") &&
        doc.includes("settings.javaScriptEnabled = false") &&
        doc.includes("settings.blockNetworkLoads = true") &&
        doc.includes("settings.allowFileAccess = false") &&
        doc.includes('loadDataWithBaseURL("about:blank", page, "text/html", "utf-8", null)') &&
        doc.includes("val img = withContext(Dispatchers.IO) { TiffDecoder.decode(file, 2048) }") &&
        doc.includes("val l = withContext(Dispatchers.IO) { ArchiveList.list(file) }") &&
        doc.includes("KpSheet(onDismiss = { menuOpen = false }) {") &&
        doc.includes('KpSheetRow(Icons.Filled.Download, "Save")') &&
        doc.includes('KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward")') &&
        doc.includes('KpSheetRow(Icons.AutoMirrored.Filled.OpenInNew, "Open with")') &&
        doc.includes("KpSecure.Guard(privateDoc)") &&
        tiff.includes("object TiffDecoder {") &&
        tiff.includes("if (compression !in intArrayOf(1, 5, 8, 32773, 32946)) return null") &&
        arc.includes("object ArchiveList {") &&
        arc.includes("private fun rar3(raf: RandomAccessFile, start: Long): Listing {") &&
        arc.includes("private fun rar5(raf: RandomAccessFile, start: Long): Listing {"),
    );
    check(
      "r32-33: the document bubble and the Docs tab hand every non-media file to the viewer (onOpenDoc → docviewer, kpPrivate carried) — no in-bubble download, no system ACTION_VIEW from the chat, the old text-file sheet is gone",
      chat.includes("onOpenDoc: (JSONObject) -> Unit = {},") &&
        chat.includes('nav.navigate("docviewer/${mediaArg(arg)}")') &&
        chat.includes("onOpenDoc(m)") &&
        !chat.includes("var textDoc by remember") &&
        !chat.includes(
          "FilesUtil.openFile(ctx, fileName, dest, FilesUtil.mimeFor(fileName, fileType))",
        ) &&
        !chat.includes("fun isTextLike(): Boolean {") &&
        media.includes(
          'else nav.navigate("docviewer/${mediaArg(JSONObject(m.toString()).put("kpPrivate", privateChat))}")',
        ),
    );
  }
  // Item 5 (a): group chat ⋮ / group profile ⋮ / Group Settings (Private group).
  {
    const chat = kt("ChatScreen.kt");
    const group = kt("GroupInfoScreen.kt");
    const app = kt("KpApp.kt");
    const src = readFileSync("src/worker/index.ts", "utf8");
    const groupMenu = chat.slice(
      chat.indexOf("isGroup -> {"),
      chat.indexOf("else -> {", chat.indexOf("isGroup -> {")),
    );
    const order = [
      '"Add Members"',
      '"Group Media"',
      '"Theme"',
      '"Search"',
      'if (muted) "Unmute" else "Mute"',
      '"Leave Group"',
    ];
    check(
      "r32-5a: the chat ⋮ is a KpSheet (no DropdownMenu anywhere in the chat); a group's list is exactly Add Members (admin, open group) / Group Media (open group) / Theme / Search / Mute-Unmute / Leave Group (confirm sheet → DELETE members/me) in that order",
      !chat.includes("DropdownMenu") &&
        chat.includes("KpSheet(onDismiss = { menuOpen = false }) {") &&
        order.every(
          (l, i) =>
            groupMenu.includes(l) &&
            (i === 0 || groupMenu.indexOf(l) > groupMenu.indexOf(order[i - 1])),
        ) &&
        groupMenu.includes("if (groupAdmin && !privateGroup) {") &&
        groupMenu.includes("if (!privateGroup) {") &&
        groupMenu.includes(
          'KpSheetRow(Icons.AutoMirrored.Filled.Logout, "Leave Group", tint = Red) { menuOpen = false; confirmLeave = true }',
        ) &&
        chat.includes('Api.delete("/api/conversations/$convId/members/${Store.myId()}")') &&
        chat.includes('val privateGroup = isGroup && c?.optBoolean("privateGroup") == true') &&
        chat.includes("val privateChat = KpSecure.privatePeer(c) || privateGroup") &&
        chat.includes("AddMembersSheet(") &&
        group.includes("internal fun AddMembersSheet("),
    );
    check(
      "r32-5a: group profile ⋮ (admin) = Add Members / Settings → GroupSettingsScreen (route group/{id}/settings) with the single 'Private group' switch (PATCH privateGroup; admin only, others read-only); the body's Add members row is gone",
      group.includes('KpSheetRow(Icons.Filled.PersonAdd, "Add Members") {') &&
        group.includes('KpSheetRow(Icons.Filled.Settings, "Settings") {') &&
        group.includes('nav.navigate("group/$convId/settings")') &&
        group.includes("fun GroupSettingsScreen(nav: NavController, convId: String) {") &&
        group.includes(
          'Text("Group Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)',
        ) &&
        group.includes('Text("Private group", fontSize = 14.5.sp') &&
        group.includes(
          'Api.patch("/api/conversations/$convId", JSONObject().put("privateGroup", on))',
        ) &&
        group.includes("enabled = isAdmin && !busy && c != null,") &&
        group.includes("KpSecure.Guard(privateGroup)") &&
        !group.includes('Text("Add members", fontSize = 15.sp') &&
        app.includes(
          'composable("group/{id}/settings") { GroupSettingsScreen(nav, it.arguments?.getString("id") ?: "") }',
        ),
    );
    check(
      "r32-5a: worker — conversations.private_group (admin PATCH privateGroup, system line), private → member add and the media gallery answer 403 PRIVATE_GROUP, detail carries privateGroup",
      src.includes(
        "ALTER TABLE conversations ADD COLUMN private_group INTEGER NOT NULL DEFAULT 0",
      ) &&
        src.includes("body.privateGroup !== undefined;") &&
        src.includes('if (conv.kind !== "GROUP") fail(400, "Only groups can be private.");') &&
        src.includes(
          'if (conv.private_group) fail(403, "This group is private.", "PRIVATE_GROUP");',
        ) &&
        src.includes(
          'if (mediaConv.private_group) fail(403, "This group is private.", "PRIVATE_GROUP");',
        ) &&
        src.includes(
          'privateGroup: conv.kind === "GROUP" && Number(conv.private_group ?? 0) === 1,',
        ),
    );
  }
  // Item 5 (b): group AUDIO calls — one row per group call, per-pair mesh.
  {
    const eng = kt("CallEngine.kt");
    const calls = kt("CallScreens.kt");
    const chat = kt("ChatScreen.kt");
    const tab = kt("CallsTabScreen.kt");
    const store = kt("ScreenStore.kt");
    const src = readFileSync("src/worker/index.ts", "utf8");
    check(
      "r32-5b: worker — call_members / call_peers tables + call_ice.target_id; POST /api/calls/group (member, GROUP only; running call → existing), /join, /peer (per-pair offer/answer), per-peer ICE; every call route admits a group member via callParticipant; leave/decline settle the row (settleGroupCall), the bubble lands in the group chat, missed group rings push the rung members",
      src.includes(
        "CREATE TABLE IF NOT EXISTS call_members (call_id TEXT NOT NULL, user_id TEXT NOT NULL, state TEXT NOT NULL, joined_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY (call_id, user_id))",
      ) &&
        src.includes(
          "CREATE TABLE IF NOT EXISTS call_peers (call_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, offer_sdp TEXT, answer_sdp TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (call_id, from_id, to_id))",
        ) &&
        src.includes("ALTER TABLE call_ice ADD COLUMN target_id TEXT") &&
        src.includes('if (path === "/api/calls/group" && method === "POST") {') &&
        src.includes("const joinMatch = path.match(/^\\/api\\/calls\\/([^/]+)\\/join$/);") &&
        src.includes("const peerMatch = path.match(/^\\/api\\/calls\\/([^/]+)\\/peer$/);") &&
        src.includes('const isGroupCall = (row: { callee_id: string }) => row.callee_id === "";') &&
        (
          src.match(
            /if \(!\(await callParticipant\(db, row, uid\)\)\) fail\(403, "Not your call\./g,
          ) || []
        ).length >= 5 &&
        src.includes("async function settleGroupCall(") &&
        src.includes("async function logGroupCallEvent(") &&
        src.includes("async function ringGroupMember(") &&
        src.includes("async function notifyMissedGroupCall(") &&
        src.includes(
          "AND c.status IN ('RINGING', 'ACTIVE') AND m.state IN ('RINGING', 'JOINED') ORDER BY c.created_at DESC",
        ),
    );
    check(
      "r32-5b: engine — startGroupCall / joinGroup / groupSync mesh: one PeerConnection per JOINED member sharing the kp-a track, the lexically smaller id offers, ICE is posted with `to`, legs close on leave and in hangupLocal; a group ring's Accept = /join; CallUi carries group/starterName/participants",
      eng.includes(
        'fun startGroupCall(convId: String, kind: String, title: String, avatarRef: String = "") {',
      ) &&
        eng.includes("private suspend fun joinGroup(callId: String) {") &&
        eng.includes("private suspend fun groupSync(ui: CallUi) {") &&
        eng.includes("private fun newGroupPc(peerId: String): PeerConnection {") &&
        eng.includes(
          "private val groupPeers = java.util.concurrent.ConcurrentHashMap<String, PeerConnection>()",
        ) &&
        eng.includes('audioTrack?.let { peer.addTrack(it, listOf("kp")) }') &&
        eng.includes("if (me < peerId && peerId !in groupOffered) {") &&
        eng.includes('val body = JSONObject().put("candidate", payload).put("to", peerId)') &&
        eng.includes("groupPeers.values.forEach { runCatching { it.close() } }") &&
        eng.includes("if (rec.group) {\n            scope.launch {") &&
        eng.includes("joinGroup(rec.id)") &&
        eng.includes("val group: Boolean = false,") &&
        eng.includes("val participants: List<JSONObject> = emptyList(),") &&
        eng.includes('if (status == "ACTIVE" && myState == "JOINED") groupSync(ui)'),
    );
    check(
      "r32-5b: screens — the group chat header gets a voice-call button (startGroupCall); ring + in-call screens show the group picture (CallAvatar), '<starter> · Group voice call', the participant avatar row and 'N on call'; Calls tab rows for group calls show the group title / call-back rings the group / tap opens the group; hidden-call + peer helpers know group rows; missed group card's Call back opens a group call",
      chat.includes(
        'CallEngine.instance?.startGroupCall(convId, "AUDIO", title, avatarRef ?: "")',
      ) &&
        chat.includes("if (isGroup && c != null) {\n                HeaderCallBtn(onClick = {") &&
        calls.includes("internal fun ParticipantRow(call: CallUi) {") &&
        calls.includes(
          "internal fun CallAvatar(call: CallUi, size: androidx.compose.ui.unit.Dp) {",
        ) &&
        calls.includes('call.group -> "${call.starterName} · Group voice call"') &&
        calls.includes(
          'call.group && call.status == "ACTIVE" && connected -> "${othersOn + 1} on call · ${clockText(secs)}"',
        ) &&
        (calls.match(/ParticipantRow\(call\)/g) || []).length === 2 &&
        tab.includes(
          // r32-5c: the call-back keeps the kind (video row → group video).
          'CallEngine.instance?.startGroupCall(otherId, if (video) "VIDEO" else "AUDIO", name, avatarRef ?: "")',
        ) &&
        tab.includes('group && missed -> "Missed group ${if (video) "video" else "voice"} call"') &&
        // r33-2 re-indented the tab's LazyColumn (state + KpKeepTop); whitespace-tolerant.
        /if \(groupConv\.isNotBlank\(\)\) \{\s*\n\s*nav\.navigate\("chat\/\$groupConv"\)/.test(
          tab,
        ) &&
        store.includes('call.optBoolean("group") -> ""') &&
        kt("KpPush.kt").includes('group = data["group"] == "1",') &&
        kt("KpNotify.kt").includes('.putExtra("kp_callback_group", group)') &&
        kt("MainActivity.kt").includes(
          "if (group) CallEngine.instance?.startGroupCall(otherId, kind, name)",
        ),
    );
  }
  // Item 5 (c): group VIDEO calls on the same mesh — per-member tiles.
  {
    const eng = kt("CallEngine.kt");
    const calls = kt("CallScreens.kt");
    const chat = kt("ChatScreen.kt");
    check(
      "r32-5c: engine — every mesh leg carries a video m-line (camera track or a sendrecv transceiver), each member's remote video is bound by id (bindGroupRemote, live from the first real frame, hidden by their camera:false flag), toggleCamera swaps ONE camera into every leg with setTrack and announces it via /media; the old 'coming in the next update' stub is gone",
      eng.includes(
        "private val groupRemoteVideo = java.util.concurrent.ConcurrentHashMap<String, VideoTrack>()",
      ) &&
        eng.includes("var groupVideoVersion by mutableStateOf(0)") &&
        eng.includes("fun groupVideoLive(peerId: String): Boolean =") &&
        eng.includes("private fun bindGroupRemote(peerId: String, track: VideoTrack) {") &&
        eng.includes("if (track is VideoTrack) bindGroupRemote(peerId, track)") &&
        eng.includes(
          "private fun applyGroupPeerMedia(peerId: String, camera: Boolean, kind: String) {",
        ) &&
        eng.includes("if (active?.group == true) applyGroupPeerMedia(who, camera, kind)") &&
        eng.includes(
          'runCatching { if (sender != null) sender.setTrack(track, false) else peer.addTrack(track, listOf("kp")) }',
        ) &&
        !eng.includes("Group video calling is coming in the next update."),
    );
    check(
      "r32-5c: screens — a group VIDEO call renders GroupVideoScreen (grid of GroupTile per joined member: their video when live, avatar otherwise — no waiting state; own camera tile bottom-right; ringing members dimmed under the title); the group chat header has a video-call button; call-back keeps the kind",
      calls.includes("fun GroupVideoScreen(call: CallUi) {") &&
        calls.includes(
          "private fun GroupTile(engine: CallEngine, p: JSONObject, modifier: Modifier) {",
        ) &&
        calls.includes("if (call.group) GroupVideoScreen(call) else InCallVideoScreen(call)") &&
        calls.includes('call.kind == "VIDEO" && call.group -> GroupVideoScreen(call)') &&
        calls.includes("val live = engine.groupVideoLive(id)") &&
        calls.includes("engine.attachGroupRemote(id, this)") &&
        !calls.includes("Waiting for video") &&
        chat.includes(
          'CallEngine.instance?.startGroupCall(convId, "VIDEO", title, avatarRef ?: "")',
        ) &&
        kt("MainActivity.kt").includes(
          'val kind = intent.getStringExtra("kp_callback_kind") ?: "AUDIO"',
        ),
    );
  }
  // r32-17: "View once" for photos / videos. Worker: meta.viewOnce only on a
  // photo / video message (no album, no dims), preview "Photo · View once",
  // no push thumbnail, gallery skips it, POST /api/messages/:id/view spends
  // the one opening (recipient only, once; media cleared + GC'd, room frame),
  // spent rows expose no media, a recipient cannot re-post the key. App: ①
  // toggle in the attach panel, ViewOnceRow card instead of a preview, viewer /
  // player under capture guard with no Save / Forward, opening reported via
  // ViewOnce.spend, no Forward in the sheet / selection bar, quotes + list say
  // "Photo · View once".
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const chat = kt("ChatScreen.kt");
    const attach = kt("AttachSheet.kt");
    const viewer = kt("MediaViewer.kt");
    const list = kt("ChatListScreen.kt");
    const viewRoute = src.slice(
      src.indexOf("const msgViewMatch = path.match(/^\\/api\\/messages\\/([^/]+)\\/view$/);"),
      src.indexOf("  const statusMatch = path.match("),
    );
    check(
      "r32-17: worker — viewOnceFlag admits the flag only on an IMAGE / image-or-video FILE that is not a document or voice note; a view-once row stores no album but DOES store dims (E3f — no 1 s fake ratio); the preview reads 'Photo · View once' / 'Video · View once'; the push carries no kp_media for it; the gallery skips it; msgFrom hides fileKey / mediaUrl / hasImage once spent and publishes viewOnce / viewedAt / viewedBy; the page marker folds viewedAt in",
      src.includes("function viewOnceFlag(") &&
        src.includes("if (meta.viewOnce !== true || !hasMedia) return false;") &&
        src.includes("if (meta.document === true || meta.voice === true) return false;") &&
        src.includes(
          '(kind === "FILE" && (fileType.startsWith("image/") || fileType.startsWith("video/")))',
        ) &&
        src.includes("...(Object.keys(dims).length ? dims : {}),") &&
        src.includes("...(album && !viewOnce ? { album } : {}),") &&
        src.includes("...(viewOnce ? { viewOnce: true } : {}),") &&
        src.includes('const once = meta.viewOnce === true ? " · View once" : "";') &&
        src.includes("message.hasImage && !message.viewOnce") &&
        src.includes("if (m.viewOnce) continue;") &&
        src.includes("const spent = viewOnceSpent(meta);") &&
        src.includes('hasImage: !spent && ((row.kind === "IMAGE" && !!row.media) || imageFile),') &&
        src.includes('fileKey: row.kind === "FILE" && !spent ? row.media : undefined,') &&
        src.includes("viewOnce: meta.viewOnce === true ? true : undefined,") &&
        src.includes("viewedAt: spent ? meta.viewedAt : undefined,") &&
        src.includes("items.map((m) => [m.id, m.body, m.edited, m.deliveredAt, m.viewedAt]),"),
    );
    check(
      "E3f: a view-once send keeps its true ratio end to end — the worker stores the sender's dims on once-rows (no !viewOnce strip), the photo payload carries w/h under the once flag, and the live file payload carries the measured box (clipMeta preferred over the bare flag)",
      !src.includes("Object.keys(dims).length && !viewOnce") &&
        chat.includes('if (w > 0 && h > 0) o.put("w", w).put("h", h)') &&
        chat.includes("if (clipMeta.length() > 0) clipMeta else docMeta"),
    );
    check(
      "r34-16a: worker — POST /api/messages/:id/view: member only, 400 NOT_VIEW_ONCE on an ordinary message, 403 OWN_MESSAGE for the sender; the opening DELETES the row (conditional — a race loser is 410 VIEWED, later taps 404), the object is collected before the answer, syncPreviewAfterDelete recomputes preview + unread, the room gets the VANISHED frame and the sender's list a conv poke; a recipient re-posting someone else's view-once key is 403 VIEW_ONCE",
      viewRoute.includes("await requireMember(db, row.conv_id, uid);") &&
        viewRoute.includes(
          'if (meta.viewOnce !== true) fail(400, "Not a view-once message.", "NOT_VIEW_ONCE");',
        ) &&
        viewRoute.includes(
          'if (row.sender_id === uid) fail(403, "You sent this.", "OWN_MESSAGE");',
        ) &&
        viewRoute.includes("\"DELETE FROM messages WHERE id = ? AND kind != 'DELETED'\",") &&
        viewRoute.includes('if (!cleared) fail(410, "This was already opened.", "VIEWED");') &&
        viewRoute.includes("if (row.media) await collectOrphanedMedia(env, db, [row.media]);") &&
        viewRoute.includes("await syncPreviewAfterDelete(db, row);") &&
        viewRoute.includes('kind: "VANISHED",') &&
        viewRoute.includes("return json({ ok: true, vanished: true });") &&
        viewRoute.includes("broadcastRoomEvent(env, `user:${row.sender_id}`") &&
        !viewRoute.includes("viewedAt") &&
        src.includes('if (foreignOnce) fail(403, "This was sent as view once.", "VIEW_ONCE");') &&
        src.includes('"SELECT sender_id, meta_json FROM messages WHERE media = ? LIMIT 8",'),
    );
    check(
      "r32-17: app — once rides PER ITEM (round 36 killed the panel ① toggle): a once item sends with meta.viewOnce + dims (E3f) and no album, the rest share the album; sendImage / sendFile / readAndSendImage / handleDocumentPicked carry the flag; the pending echo is marked viewOnce so it draws as the card",
      attach.includes("val once: Boolean = false,") &&
        chat.includes("if (item.once) {") &&
        chat.includes(
          "val album = if (batch.count { !it.isVideo && !it.once } >= 2) newAlbumId() else null",
        ) &&
        chat.includes(
          "if (item.isVideo) handleDocumentPicked(item.uri, viewOnce = true, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, null, viewOnce = true, sendAt = sendAt, caption = item.caption, hd = item.hd)",
        ) &&
        chat.includes(
          'fun sendImage(\n        dataUrl: String,\n        album: String? = null,\n        viewOnce: Boolean = false,\n        sendAt: java.time.Instant? = null,\n        caption: String = "",\n        w: Int = 0,\n        h: Int = 0,\n    ) {',
        ) &&
        chat.includes(
          'if (viewOnce) {\n                o.put("viewOnce", true)\n                if (w > 0 && h > 0) o.put("w", w).put("h", h)\n                return o\n            }',
        ) &&
        chat.includes('.also { row -> if (viewOnce) row.put("viewOnce", true) }') &&
        chat.includes(
          'suspend fun sendFile(\n        name: String,\n        mime: String,\n        file: File,\n        asDocument: Boolean = false,\n        viewOnce: Boolean = false,\n        sendAt: java.time.Instant? = null,\n        caption: String = "",\n        w: Int = 0,\n        h: Int = 0,\n        durMs: Long = 0L,\n    ) {',
        ) &&
        chat.includes('viewOnce -> JSONObject().put("viewOnce", true)') &&
        chat.includes(
          'suspend fun readAndSendImage(uri: Uri, album: String?, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "", hd: Boolean = false) {',
        ) &&
        chat.includes(
          'fun handleDocumentPicked(uri: Uri, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "") {',
        ),
    );
    const onceRow = chat.slice(
      chat.indexOf("private fun ViewOnceRow("),
      chat.indexOf("internal fun sentAsDocument(m: JSONObject): Boolean ="),
    );
    check(
      "r34-16a: app — a view-once message renders ViewOnceRow: the photo at its original ratio (ImageRatios-cached) blurred past recognition via ViewOnceBlur, the ViewOnceOneIcon mark in the middle, a dark tile for video / uploads; the recipient opens it (sender's tap does nothing), reply-drag + long-press intact, no 'Opened' state anywhere; the album fold, resend and the media grid never take it",
      chat.includes(
        "if (isViewOnce(m)) {\n        Box(Modifier.fxSlotOpen(fxFresh).fxFlyIn(fxFresh, 700, isSent = mine)) {\n            ViewOnceRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onOpenVideo, onReply, onLongPress, theme)",
      ) &&
        chat.indexOf("if (isViewOnce(m)) {") <
          chat.indexOf(
            'if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))) {',
          ) &&
        onceRow.includes("val openable = !mine && !pendingEcho") &&
        onceRow.includes("openable -> if (video) onOpenVideo(m) else onOpenImage(m)") &&
        onceRow.includes("detectHorizontalDragGestures(") &&
        onceRow.includes("if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)") &&
        onceRow.includes(".transformations(ViewOnceBlur)") &&
        onceRow.includes("coil.compose.AsyncImage(") &&
        onceRow.includes("ViewOnceOneIcon(56.dp)") &&
        onceRow.includes("ImageRatios.put(photoUrl,") &&
        onceRow.includes("DeleteGeoms.put(m, it.boundsInWindow())") &&
        !onceRow.includes("viewOnceSpent") &&
        !chat.includes('"Opened"') &&
        chat.includes("internal fun isViewOnce(m: JSONObject): Boolean =") &&
        !chat.includes("internal fun viewOnceSpent(m: JSONObject): Boolean =") &&
        chat.includes('return if (a.isNotBlank() && isPhotoMsg(m) && !isViewOnce(m)) a else ""') &&
        chat.includes(
          '(it.optString("kind") == "IMAGE" || it.optString("kind") == "FILE") && !isViewOnce(it)',
        ),
    );
    const icon = kt("ViewOnceIcon.kt");
    check(
      "r34-16a: app — the 1 mark is the owner's SVG traced exactly (260.2° arc on center 40/50, the 5 gap dots, the bold 1 at x 38 / baseline 62) and shared with the editor; the blur is a coil Transformation (48 px + triple box pass, every API level); a VANISHED frame plays the vanish show and drops the row without a tombstone",
      icon.includes("internal fun ViewOnceOneIcon(iconSize: Dp, tint: Color = Color.White)") &&
        icon.includes("startAngle = 49.9f,") &&
        icon.includes("sweepAngle = 260.2f,") &&
        icon.includes("60.6f, 25.5f, 2.5f,") &&
        icon.includes("72f, 50f, 4.2f,") &&
        icon.includes('"1",') &&
        icon.includes("38f * u,") &&
        icon.includes("62f * u,") &&
        icon.includes("android.graphics.Typeface.DEFAULT_BOLD") &&
        icon.includes("internal object ViewOnceBlur : coil.transform.Transformation") &&
        icon.includes('"kp-viewonce-blur-v1"') &&
        icon.includes("repeat(3) { boxBlurPass(pix, sw, sh, 4) }") &&
        chat.includes('if (liveMsg.optString("kind") == "VANISHED" && liveId.isNotBlank()) {') &&
        chat.includes("vanishingIds.add(liveId)") &&
        chat.includes('msgs.removeAll { it.optString("id") == liveId }') &&
        chat.includes("ScreenStore.pokeInbox()"),
    );
    check(
      "r32-17: app — the opening: the photo viewer gets onShown (fired by KpNetImage.onLoaded once the picture is really on screen, never on a failed load) → ViewOnce.spend(id) (process-level, de-duplicated, POST /api/messages/:id/view, retried on a network miss); the player spends a kpOnce clip once it is ready; both run under capture guard with Save / Forward withheld; Forward is absent from the long-press sheet and the selection bar for view-once rows; the quotes and the chat list read 'Photo · View once'",
      viewer.includes("onShown: (() -> Unit)? = null,") &&
        viewer.includes("onLoaded = onShown,") &&
        kt("Ui.kt").includes("onLoaded: (() -> Unit)? = null,") &&
        kt("Ui.kt").includes("onSuccess = onLoaded?.let { cb -> { _ -> cb() } },") &&
        kt("Ui.kt").includes("LaunchedEffect(url) { onLoaded?.invoke() }") &&
        viewer.includes('val onceClip = m?.optBoolean("kpOnce") == true') &&
        viewer.includes(
          'if (onceClip && state == 1) ViewOnce.spend(m?.optString("id").orEmpty())',
        ) &&
        chat.includes("object ViewOnce {") &&
        chat.includes("if (messageId.isBlank() || !spent.add(messageId)) return") &&
        chat.includes('runCatching { Api.post("/api/messages/$messageId/view", JSONObject()) }') &&
        chat.includes(".fold(onSuccess = { true }, onFailure = { terminal(it) })") &&
        chat.includes("if (!ok) spent.remove(messageId)") &&
        chat.includes('onShown = if (once) ({ ViewOnce.spend(m.optString("id")) }) else null,') &&
        chat.includes("canSave = !privateChat && !once,") &&
        chat.includes("secure = privateChat || once,") &&
        chat.includes("if (privateChat || once) {\n                        null") &&
        chat.includes('.put("kpPrivate", privateChat || once)') &&
        chat.includes('.also { if (once) it.put("kpOnce", true) }') &&
        chat.includes("if (!echo && !privateChat && !isViewOnce(m)) {") &&
        chat.includes("if (!privateChat && selectedMessages().none { isViewOnce(it) }) {") &&
        chat.includes(
          'if (q != null && isViewOnce(q)) (if (fileLooksVideo(q)) "Video · View once" else "Photo · View once")',
        ) &&
        chat.includes(
          'if (isViewOnce(replyTo)) (if (fileLooksVideo(replyTo)) "Video · View once" else "Photo · View once")',
        ) &&
        list.includes('if (t == "Photo · View once" || t == "Video · View once") return t'),
    );
  }
  // r32-18: hold Send → "send later" (scheduled messages).
  {
    const chat = kt("ChatScreen.kt");
    const src = readFileSync("src/worker/index.ts", "utf8");
    const t27 = readFileSync("test/cases/27-row-read-budget.mjs", "utf8");
    check(
      "r32-18: worker — POST /messages with `sendAt` parks the body in scheduled_messages (never in `messages`) AFTER the member / request / one-way / privacy / block checks, answers 202 { scheduled }, and the window is 1 min .. 30 days (400 BAD_SEND_AT otherwise, never clamped)",
      src.includes(
        "CREATE TABLE IF NOT EXISTS scheduled_messages (\n      id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, sender_id TEXT NOT NULL,\n      body_json TEXT NOT NULL, send_at TEXT NOT NULL, created_at TEXT NOT NULL,\n      status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0",
      ) &&
        src.includes(
          "CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(status, send_at)",
        ) &&
        src.includes('if (typeof body.sendAt === "string" && body.sendAt) {') &&
        // the schedule branch sits after the block check and before the text parse
        src.indexOf('if (typeof body.sendAt === "string" && body.sendAt) {') >
          src.indexOf('if (hit) fail(403, "You can\'t reach this player.", "BLOCKED");') &&
        src.indexOf('if (typeof body.sendAt === "string" && body.sendAt) {') <
          src.indexOf('const requestedKind = String(body.kind || "TEXT").toUpperCase();') &&
        src.includes(
          'if (!when) fail(400, "Pick a time within the next 30 days.", "BAD_SEND_AT");',
        ) &&
        src.includes("const SCHEDULE_MIN_MS = 60_000;") &&
        src.includes("const SCHEDULE_MAX_MS = 30 * 86_400_000;") &&
        src.includes("function scheduleTime(raw: string): string | null {") &&
        src.includes(
          "INSERT INTO scheduled_messages (id, conv_id, sender_id, body_json, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ) &&
        src.includes("        202,\n      );") &&
        src.includes("function scheduledFrom(row: ScheduledRow) {"),
    );
    check(
      "r32-18: worker — GET /conversations/:id/scheduled lists the caller's own PENDING rows of that chat; DELETE /scheduled/:id cancels only an unclaimed row of the caller (404 for anyone else, 409 ALREADY_SENT once claimed) and collects a parked upload's object",
      src.includes(
        "const scheduledListMatch = path.match(/^\\/api\\/conversations\\/([^/]+)\\/scheduled$/);",
      ) &&
        src.includes(
          "SELECT * FROM scheduled_messages WHERE sender_id = ? AND conv_id = ? AND status = 'PENDING' ORDER BY send_at ASC LIMIT 50",
        ) &&
        src.includes("const scheduledMatch = path.match(/^\\/api\\/scheduled\\/([^/]+)$/);") &&
        src.includes("SELECT * FROM scheduled_messages WHERE id = ? AND sender_id = ?") &&
        src.includes("DELETE FROM scheduled_messages WHERE id = ? AND status = 'PENDING'") &&
        src.includes('if (!gone) fail(409, "Already sent.", "ALREADY_SENT");') &&
        src.includes("if (key) await collectOrphanedMedia(env, db, [key]);"),
    );
    check(
      "r32-18: worker — the cron dispatches due rows every tick (index-served, LIMIT 20), CLAIMS each with a conditional UPDATE, replays it through the ordinary POST /messages route as its author (internal origin + per-isolate nonce — the header alone opens nothing), deletes it on 2xx or 4xx, re-queues otherwise (10 attempts), and the cron log gained `dispatched`",
      src.includes("dispatched = await dispatchScheduledMessages(env, ctx);") &&
        src.includes('"cron_schedule_error"') &&
        src.includes(
          "SELECT * FROM scheduled_messages WHERE status = 'PENDING' AND send_at <= ? ORDER BY send_at ASC LIMIT 20",
        ) &&
        src.includes(
          "UPDATE scheduled_messages SET status = 'SENDING', attempts = attempts + 1 WHERE id = ? AND status = 'PENDING'",
        ) &&
        src.includes("if (!claimed) continue;") &&
        src.includes("`https://scheduled.internal/api/conversations/${row.conv_id}/messages`") &&
        src.includes('"x-kp-scheduled": row.sender_id,') &&
        src.includes('"x-kp-scheduled-nonce": SCHEDULE_NONCE(),') &&
        src.includes(
          "function SCHEDULE_NONCE(): string {\n  if (!scheduleNonce) scheduleNonce = crypto.randomUUID();",
        ) &&
        !src.includes("const SCHEDULE_NONCE = crypto.randomUUID();") &&
        src.includes('new URL(request.url).host === "scheduled.internal" &&') &&
        src.includes('request.headers.get("x-kp-scheduled-nonce") === SCHEDULE_NONCE()') &&
        src.includes("if (status >= 200 && status < 300) {") &&
        src.includes(
          "} else if ((status >= 400 && status < 500) || Number(row.attempts ?? 0) + 1 >= 10) {",
        ) &&
        src.includes("UPDATE scheduled_messages SET status = 'PENDING' WHERE id = ?") &&
        src.includes("          lat,\n          dispatched,\n        }),") &&
        // v163: + the status sweep / upload counts the tick now reports.
        t27.includes(
          '"reaped|pruneRan|pruned|devices|statuses|staleUploads|metrics|lat|dispatched"',
        ),
    );
    check(
      "r32-18: app — the send circle is combinedClickable: tap sends, HOLD (text typed only) opens the 'Send later' sheet — quick picks (In 1 hour / Tonight 9 PM / Tomorrow 8 AM / Tomorrow 6 PM) then 'Pick date & time' with day chips + hour / minute steppers + AM / PM, a Schedule button; the pick POSTs the text with sendAt (reply kept) and clears the composer; a refusal returns the text",
      chat.includes("onScheduleSend: () -> Unit = {},") &&
        chat.includes("onScheduleSend = { haptics.tap(); showSchedule = true },") &&
        chat.includes(
          ".combinedClickable(\n                        interactionSource = sendInteraction,\n                        indication = null,\n                        onLongClick = if (input.isNotBlank()) onScheduleSend else null,\n                    ) {",
        ) &&
        chat.includes(
          "@OptIn(ExperimentalFoundationApi::class)\n@Composable\nprivate fun Composer(",
        ) &&
        chat.includes(
          "private fun ScheduleSheet(onClose: () -> Unit, onPick: (java.time.Instant) -> Unit) {",
        ) &&
        chat.includes('KpSheet(onDismiss = onClose, title = "Send later") {') &&
        [
          '"In 1 hour"',
          '"Tonight 9 PM"',
          '"Tomorrow 8 AM"',
          '"Tomorrow 6 PM"',
          '"Pick date & time"',
        ].every((l) => chat.includes(l)) &&
        chat.includes(
          'listOf(0 to "Today", 1 to "Tomorrow", 2 to "In 2 days", 7 to "In a week")',
        ) &&
        chat.includes("private fun NumberWheel(") &&
        chat.includes(
          "NumberWheel(value = hour12, range = 1..12, modifier = Modifier.weight(1f)) { hour12 = it }",
        ) &&
        chat.includes(
          "NumberWheel(value = minute, range = 0..55 step 5, pad = true, modifier = Modifier.weight(1f)) { minute = it }",
        ) &&
        chat.includes('GoldBtn(\n                "Schedule",') &&
        chat.includes("fun scheduleText(body: String, at: java.time.Instant) {") &&
        chat.includes('.put("clientId", clientId).put("sendAt", at.toString())') &&
        chat.includes(
          '                    scheduleText(input, at)\n                    input = ""',
        ) &&
        chat.includes("if (input.isBlank()) input = body") &&
        // the sheet is a bottom sheet, no dialog anywhere in it
        !chat
          .slice(
            chat.indexOf("private fun ScheduleSheet("),
            chat.indexOf("private fun ScheduledSheet("),
          )
          .includes("AlertDialog"),
    );
    check(
      "r32-18: app — the chat's parked rows come from the server (GET …/scheduled on open, after every schedule / cancel) and show as ONE clock chip above the composer (count · next time, 'Today 9:30 PM' style in Bangladesh time); tap → 'Scheduled' sheet listing preview · time with X = DELETE /scheduled/:id; the cron's send (room frame with our clientId) drops the row from the chip",
      chat.includes("val scheduledRows = remember { mutableStateListOf<JSONObject>() }") &&
        chat.includes('Api.get("/api/conversations/$convId/scheduled", force = true)') &&
        chat.includes("LaunchedEffect(convId) { loadScheduled() }") &&
        chat.includes("ScheduledChip(scheduledRows, chatTheme) { showScheduled = true }") &&
        chat.includes(
          "private fun ScheduledChip(rows: List<JSONObject>, theme: String, onOpen: () -> Unit) {",
        ) &&
        chat.includes(
          '(if (rows.size > 1) "${rows.size} · " else "") + scheduleStamp(next.optString("sendAt"))',
        ) &&
        chat.includes("internal fun scheduleStamp(iso: String): String {") &&
        chat.includes('now.toLocalDate() -> "Today"') &&
        chat.includes('now.toLocalDate().plusDays(1) -> "Tomorrow"') &&
        chat.includes('KpSheet(onDismiss = onClose, title = "Scheduled") {') &&
        chat.includes('Api.delete("/api/scheduled/$id")') &&
        chat.includes(
          'if (liveCid.isNotBlank() && scheduledRows.any { it.optString("clientId") == liveCid }) {',
        ) &&
        chat.includes("LaunchedEffect(rows.size) { if (rows.isEmpty()) onClose() }"),
    );
    check(
      "r34-17: the parked chip is transient (flashes 4s whenever the parked set reloads, then hides) and the ⋮ menu carries 'Scheduled messages' in all three menus (AI / group / chat) only while parked rows exist — opening the same Scheduled sheet (worker-computed preview per row, so text + photo + video all cancel from there)",
      chat.includes("var schedFlashUntil by remember { mutableStateOf(0L) }") &&
        chat.includes("LaunchedEffect(scheduledRows.size) {") &&
        chat.includes("schedFlashUntil = System.currentTimeMillis() + 4000L") &&
        chat.includes("delay(4000L)") &&
        chat.includes(
          "if (scheduledRows.isNotEmpty() && System.currentTimeMillis() < schedFlashUntil) {",
        ) &&
        chat.includes("ScheduledChip(scheduledRows, chatTheme) { showScheduled = true }") &&
        (chat.match(/KpSheetRow\(Icons\.Filled\.Schedule, "Scheduled messages"\)/g) || [])
          .length === 3 &&
        chat.includes(
          'KpSheetRow(Icons.Filled.Schedule, "Scheduled messages") { menuOpen = false; showScheduled = true }',
        ) &&
        chat.includes(
          'r.optString("preview").ifBlank { r.optString("body") }.ifBlank { "Message" }',
        ) &&
        src.includes("preview: preview.slice(0, 120)"),
    );
  }
  // r32-19: attach flow — the mic stays the mic; the panel owns the media Send
  // (tap = now, hold = later); one picked photo / video gets Edit → the light
  // editor (pen for a photo, trim for a video).
  {
    const chat = kt("ChatScreen.kt");
    const attach = kt("AttachSheet.kt");
    const edit = kt("MediaEditScreen.kt");
    const share = kt("CropTrimKit.kt");
    const plan = kt("VideoExport.kt");
    const store = kt("ScreenStore.kt");
    const app = kt("KpApp.kt");
    // Owner round 45 (item 7): swipe-browse the pool inside the editor.
    check(
      "r45-7: attach editor browses the pool — lone pencil stages ScreenStore.editPool, the editor sessions item screens with per-photo EditBits snapshots + a horizontal swipe, the stage dies with the screen",
      store.includes("var editPool: List<MediaItem> = emptyList()") &&
        attach.includes("onPool: (List<MediaItem>) -> Unit = {},") &&
        attach.includes("LaunchedEffect(pool) { if (pool.isNotEmpty()) onPool(pool) }") &&
        chat.includes("ScreenStore.editPool = attachPool") &&
        edit.includes("private class EditBits") &&
        edit.includes("@Composable\nprivate fun MediaEditItemScreen(") &&
        edit.includes('pointerInput("editbrowse")') &&
        // Owner round 47 (item 5): the chevrons were his removal order —
        // the swipe itself is fixed ON the photo: an Initial-pass claim
        // ahead of the stage's own gestures (the Main-pass detector only
        // fired in the border margins before).
        edit.includes(
          "awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)",
        ) &&
        edit.includes("ch.consume()") &&
        !edit.includes("KeyboardArrowLeft") &&
        !edit.includes("KeyboardArrowRight") &&
        edit.includes("travel < -140f") &&
        edit.includes("works[uriKey] = bits") &&
        edit.includes(
          "DisposableEffect(Unit) { onDispose { ScreenStore.editPool = emptyList() } }",
        ),
    );
    check(
      "v167 no-fly: the morph-&-fly engine of r46-r49 is GONE — a send lands in its own place with no travel, no clone, no landing bounce, and every launch/report hint the flight needed is gone with the engine (dead origin hints, not code); all five send paths still exist and still paint their pending echo row",
      // The engine and everything it needed. Every one of these is an
      // ABSENCE pin: re-adding any of it re-adds a flying message.
      !chat.includes("private class FlySpec(") &&
        !chat.includes("private fun KpFlySend(") &&
        !chat.includes("private fun KpFlyLandFlash(") &&
        !chat.includes("private object KpFlyTarget") &&
        !chat.includes("fun launchFly(") &&
        !chat.includes("fun armFly()") &&
        !chat.includes("flyHidden") &&
        !chat.includes("flyLanded") &&
        !chat.includes("flyQueue") &&
        !chat.includes("sendFromRect") &&
        !chat.includes("onFieldRect") &&
        !chat.includes("onActionRect") &&
        !chat.includes("attachSendRect") &&
        !chat.includes("transformOrigin = TransformOrigin.Center") &&
        !attach.includes("onSendRect") &&
        // …and the sends themselves are untouched: the echo rows are added
        // and painted by the same five paths (text, photo, file/clip, voice,
        // batch) — a land-in-place animation must never cost a send.
        (chat.match(/pending\.add\(/g) || []).length >= 4 &&
        chat.includes('fun sendText(body: String, kind: String = "TEXT") {') &&
        chat.includes("suspend fun sendFile(") &&
        chat.includes("fun sendImage(") &&
        chat.includes("bornKeys.add(clientId)") &&
        // the pending rows and the thread rows are plain rows now: no alpha
        // gate, no scale gate anywhere on a message row.
        !chat.includes(".alpha(if (rowKey in") &&
        !chat.includes("scaleX = flyLand.value"),
    );
    // Owner round 39 (item 6): the 'N selected' header + Edit chip are
    // gone — the picker is Recents ▾ · HD over the grid, with the
    // selection bar (pencil, caption, ①, send-with-count) under it.
    // Owner round 45 (item 4): the header's close button is retired —
    // swipe-down folds, system back closes (see r45-5's dismiss lock).
    check(
      "r39-6: attach picker — fullscreen header (no close button since r45-4; 'Recents'/folder + chevron, HD pill); collapsed tiles + vertical recents grid (r40-1: the strip is gone, a grid tap ticks + opens fullscreen); selection bar (pencil edits the last tick, caption rides sel[0], ① batch toggle, ActionBlue send with count badge, hold = later); no preview anywhere",
      !attach.includes('Icons.Filled.Close, "Close"') &&
        attach.includes("onScheduleBatch: () -> Unit = {},") &&
        attach.includes("onEdit: (MediaItem) -> Unit = {},") &&
        attach.includes(
          "@OptIn(ExperimentalFoundationApi::class)\n@Composable\nfun AttachPanel(",
        ) &&
        attach.includes('folder ?: "Recents",') &&
        attach.includes('"HD",') &&
        attach.includes("val hdOn = if (sel.isEmpty()) hdArm else sel.all { it.hd }") &&
        attach.includes("if (!fullscreen) {") &&
        (attach.match(/LazyVerticalGrid\(/g) || []).length === 2 &&
        !attach.includes("LazyRow") &&
        attach.includes("setFullscreen(true)") &&
        // Owner round 41 (item 1): the fullscreen header drags down.
        attach.includes('"headerDrag"') &&
        // Owner round 43 (item 3): 1.7 sources + an accumulated pre-side,
        // and the bar drag covers the caption pill too.
        attach.includes("NestedScrollSource.SideEffect") &&
        attach.includes("NestedScrollSource.UserInput") &&
        attach.includes("gridPreTotal") &&
        // Owner round 45 (item 2, second pass): the top-gate is
        // canScrollBackward (a phantom pixel used to read "not at top"
        // forever) and the fold is claimed from the touch stream itself —
        // Initial pass, ahead of the grid's scrollable.
        attach.includes("gridPreDownTotal") &&
        attach.includes("!gridState.canScrollBackward") &&
        attach.includes("awaitEachGesture") &&
        attach.includes("PointerEventPass.Initial") &&
        attach.includes('.pointerInput("foldcheck")') &&
        attach.includes('"barDrag"') &&
        attach.includes("barDragDetect") &&
        attach.includes("if (sel.isNotEmpty()) {") &&
        attach.includes("sel.lastOrNull()?.let(onEdit)") &&
        attach.includes("sel[0] = sel[0].copy(caption = t.take(1000))") &&
        // Owner round 40 (item 4): the ring is centered + shrunk (layout-only).
        attach.includes("CenteredOnceIcon(28.dp, tint = if (allOnce) Color.White else Muted)") &&
        attach.includes("sel.replaceAll { it.copy(once = v) }") &&
        attach.includes("onScheduleBatch()") &&
        attach.includes("onSendBatch()") &&
        // Owner round 42 (item 2): blue badge, white number, pinned center.
        attach.includes('"${sel.size}"') &&
        attach.includes("textAlign = TextAlign.Center") &&
        // Owner round 43 (item 2): the glyph itself centers (no font pad).
        attach.includes("PlatformTextStyle(includeFontPadding = false)") &&
        attach.includes("LineHeightStyle.Trim.Both") &&
        attach.includes(".border(1.dp, Color.White, CircleShape)") &&
        // Owner round 41 (item 3): the whole bar is 28.dp (badge 15).
        attach.includes(".offset(x = 2.dp, y = (-2).dp)") &&
        attach.includes(
          "if (allOnce) Box(Modifier.size(30.dp).clip(CircleShape).background(ActionBlue))",
        ) &&
        attach.includes(".height(28.dp)") &&
        // Owner round 41 (item 4): the HD pill carries no border.
        !attach.includes(".border(1.dp, if (hdOn)") &&
        // Owner round 40 (item 3): the keyboard pushes the bar up.
        attach.includes(".imePadding(),") &&
        !attach.includes("PreviewPane") &&
        !attach.includes("previewUri") &&
        !attach.includes('"${sel.size} selected"') &&
        !attach.includes("the composer's mic IS the\n                // send button") &&
        // Owner round 41 (item 2): the composer stays until a tick / swipe-up.
        chat.includes("} else if (!showAttach || (attachSel.isEmpty() && !attachFs)) {") &&
        chat.includes("onFullscreenChange = { attachFs = it }") &&
        attach.includes("onFullscreenChange(value)") &&
        // the composer's circle is the MIC while a gallery pick is active
        !chat.includes("gridSelCount") &&
        !chat.includes("onSendGrid") &&
        chat.includes("if (!input.isBlank() || selectCount > 0) {") &&
        chat.includes("if (input.isNotBlank()) onSend() else onSendSelection()"),
    );
    check(
      "r32-19: chat — the panel's hold opens item 18's ScheduleSheet for the batch (sendAttachSelection(sendAt)); a scheduled photo / video / document uploads now and parks on the server with sendAt (no bubble, the clock chip lists it); Edit clears the pick and opens mediaedit/{conv}/0/{arg} (unarmed; once is the editor\u2019s own toggle)",
      chat.includes("var showScheduleMedia by remember { mutableStateOf(false) }") &&
        chat.includes("onScheduleBatch = { showScheduleMedia = true },") &&
        chat.includes("                    sendAttachSelection(sendAt = at)") &&
        chat.includes("fun sendAttachSelection(sendAt: java.time.Instant? = null) {") &&
        chat.includes(
          "if (item.isVideo) handleDocumentPicked(item.uri, viewOnce = true, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, null, viewOnce = true, sendAt = sendAt, caption = item.caption, hd = item.hd)",
        ) &&
        chat.includes(
          "if (item.isVideo) handleDocumentPicked(item.uri, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, album, sendAt = sendAt, caption = item.caption, hd = item.hd)",
        ) &&
        (chat.match(/\.put\("sendAt", sendAt\.toString\(\)\)/g) || []).length === 2 &&
        chat.includes(
          'val up = withContext(Dispatchers.IO) { Api.upload("photo.jpg", "image/jpeg", jpeg) }',
        ) &&
        chat.includes(
          "val up = withContext(Dispatchers.IO) { Api.uploadFile(name, mime, file) }",
        ) &&
        (chat.match(/res\.optJSONObject\("scheduled"\)\?\.let \{ row ->/g) || []).length === 3 &&
        chat.includes('nav.navigate("mediaedit/$convId/0/${statusPickArg(item)}")') &&
        app.includes('composable("mediaedit/{conv}/{once}/{arg}") { entry ->') &&
        app.includes('viewOnce = entry.arguments?.getString("once") == "1",'),
    );
    check(
      "r32-19: MediaEditScreen — own screen (black stage, media at its own aspect): a photo gets a pen (6 colours, 3 widths, undo, clear; strokes in normalised picture units, baked at the picture's own resolution into a JPEG data URL (standard ≤380K, HD ≤1.2MB)); a video gets the shared TrimStrip with NO minute cap (maxMs = Long.MAX_VALUE) + the loop preview + (round 36) the photo toolset — pen / text / sticker / filters / rotate baked through the export; Send hands an EditedResult back via ScreenStore.pendingEdited (Photo / Video / Untouched / Failed) and the chat sends it like any pick, view-once kept",
      edit.includes(
        "fun MediaEditScreen(nav: NavController, pickedUri: Uri, pickedIsVideo: Boolean, convId: String, viewOnce: Boolean) {",
      ) &&
        edit.includes(".fillMaxSize()\n            .background(Color.Black)") &&
        edit.includes(
          "internal class PenStroke(val color: Color, val width: Float, val points: MutableList<Offset>)",
        ) &&
        edit.includes("private val PEN_WIDTHS = listOf(0.006f, 0.012f, 0.024f)") &&
        (edit.match(/Color\(0xFF[0-9A-F]{6}\)/g) || []).length >= 6 &&
        edit.includes(
          "internal fun bakePen(bmp: ImageBitmap, strokes: List<PenStroke>): String? =",
        ) &&
        edit.includes("paint.strokeWidth = st.width * w") &&
        edit.includes("if (bytes.size <= budget || quality <= minQuality) break") &&
        edit.includes("strokes.removeAt(strokes.size - 1)") &&
        edit.includes("Icons.AutoMirrored.Filled.Undo") &&
        edit.includes("maxMs = Long.MAX_VALUE,") &&
        edit.includes(
          // v164: the stage / preview / bakes all read the WORKING media
          // (mediaUri) — pickedUri until Done bakes an applied copy into it.
          "paused = vidPaused,\n                                    turn = rotation,",
        ) &&
        edit.includes("onPosition = { playAt = it }") &&
        edit.includes(
          "VideoExport.export(ctx, mediaUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)",
        ) &&
        edit.includes("VideoExport.passthrough(ctx, mediaUri, s, e, out)") &&
        edit.includes(
          "ScreenStore.pendingEdited.value = EditedResult(convId, once, result, cap)",
        ) &&
        edit.includes(
          'data class EditedResult(val convId: String, val viewOnce: Boolean, val media: EditedMedia, val caption: String = "")',
        ) &&
        [
          // v166: the bake hands back the file's own pixels + duration, so a
          // send can lay its bubble out like the sent row (fb#5).
          "Photo(val dataUrl: String, val w: Int = 0, val h: Int = 0)",
          "Video(\n        val file: java.io.File,\n        val mime: String,\n        val w: Int = 0,\n        val h: Int = 0,\n        val durMs: Long = 0L,\n    )",
          "Untouched(val uri: Uri, val isVideo: Boolean)",
          "Failed(val message: String)",
        ].every((l) => edit.includes(l)) &&
        !edit.includes("AlertDialog") &&
        // round 37: the fire-and-forget status post toasts (it pops
        // first) — every Toast lives in sendStatus, nowhere else.
        (edit.match(/Toast/g) || []).length === 4 &&
        edit
          .slice(edit.indexOf("fun sendStatus() {"), edit.indexOf("/** The caption bar's +"))
          .includes("Sharing status…") &&
        store.includes(
          "val pendingEdited = kotlinx.coroutines.flow.MutableStateFlow<EditedResult?>(null)",
        ) &&
        chat.includes("ScreenStore.pendingEdited.collect { edited ->") &&
        chat.includes("if (edited == null || edited.convId != convId) return@collect") &&
        chat.includes(
          "is EditedMedia.Photo -> sendImage(m.dataUrl, null, edited.viewOnce, caption = edited.caption, w = m.w, h = m.h)",
        ) &&
        chat.includes(
          'is EditedMedia.Video -> sendFile("video.mp4", m.mime, m.file, viewOnce = edited.viewOnce, caption = edited.caption, w = m.w, h = m.h, durMs = m.durMs)',
        ) &&
        chat.includes("is EditedMedia.Failed -> error = m.message") &&
        // the shared pieces: TrimStrip / StatusTrimPreview are internal, the cap is a parameter
        share.includes("internal fun TrimStrip(") &&
        share.includes("internal fun StatusTrimPreview(") &&
        share.includes("maxMs: Long = VideoPlan.MAX_STATUS_MS,") &&
        plan.includes(
          "fun moveStart(start: Long, end: Long, durationMs: Long, newStart: Long, maxMs: Long = MAX_STATUS_MS): Pair<Long, Long> {",
        ) &&
        plan.includes(
          "fun moveEnd(start: Long, end: Long, durationMs: Long, newEnd: Long, maxMs: Long = MAX_STATUS_MS): Pair<Long, Long> {",
        ),
    );
  }
  // r34-16b: the attach editor goes full WhatsApp — a lone grid tap opens
  // it; close · save · HD · rotate · sticker · text · pen on top, swipe-up
  // filters, the caption bar (+, caption, the editor-owned ①), the recipient
  // chip + blue send; captions ride the send path and render under bubbles.
  {
    const chat = kt("ChatScreen.kt");
    const attach = kt("AttachSheet.kt");
    const edit = kt("MediaEditScreen.kt");
    const store = kt("ScreenStore.kt");
    const files = kt("Files.kt");
    check(
      "r34-16b: editor screen — top bar (save, HD pill, rotate, sticker, Aa, pen), swipe-up filter strip (preview + bake share one ColorMatrix), caption bar (caption field, borderless centered-once toggle — no add-more button), recipient chip + blue send; rotate carries the normalised overlays, HD bakes bigger, no dialogs; toasts only for the status post",
      edit.includes("Icons.Filled.Download") &&
        edit.includes('Text("HD", color = if (hd) Color.Black else Color.White') &&
        edit.includes("Icons.Filled.RotateRight") &&
        edit.includes("Icons.Filled.EmojiEmotions") &&
        edit.includes('Text("Aa", color = Color.White') &&
        edit.includes("Icons.Filled.Edit") &&
        edit.includes("CenteredOnceIcon(28.dp") &&
        // v169: the swipe-up hint is gone; the rail owns the filter strip.
        !edit.includes("Swipe up for filters") &&
        edit.includes("Icons.Filled.AutoAwesome") &&
        edit.includes("ColorMatrix(filterMatrix.array)") &&
        edit.includes("Add a caption...") &&
        edit.includes("ScreenStore.editTitle") &&
        edit.includes(".background(ActionBlue)") &&
        edit.includes("rotation = (rotation + 1) % 4") &&
        edit.includes("Stickers.packs") &&
        edit.includes("KpSheet(onDismiss = { showTextSheet = false }") &&
        edit.includes("KpSheet(onDismiss = { showStickerSheet = false }") &&
        edit.includes("FilesUtil.saveImage(ctx, bytes") &&
        edit.includes("FilesUtil.saveVideo(ctx, f") &&
        files.includes("fun saveVideo(ctx: Context, file: File, displayName: String): Uri?") &&
        !edit.includes("AlertDialog") &&
        // the fire-and-forget status post toasts (it pops first); the chat
        // editor itself stays silent — every Toast lives in sendStatus.
        (edit.match(/Toast/g) || []).length === 4 &&
        edit
          .slice(edit.indexOf("fun sendStatus() {"), edit.indexOf("/** The caption bar's +"))
          .includes("Sharing status…"),
    );
    check(
      "r34-16b: editor flow + captions — a grid tap ticks in place (strip + grid share the hd-aware toggle), the bar pencil opens the editor, the panel caption bar writes sel[0], the result carries the caption, MediaItem / the send path / forwards keep it, captioned rows render it",
      (attach.match(/sel\.add\(item\.copy\(hd = hdOn\)\)/g) || []).length === 2 &&
        attach.includes("if (pos >= 0) sel.removeAll { it.uri == item.uri }") &&
        attach.includes('val caption: String = "",') &&
        attach.includes("val hd: Boolean = false,") &&
        store.includes(
          "val pendingAddMore = kotlinx.coroutines.flow.MutableStateFlow<AddMore?>(null)",
        ) &&
        store.includes(
          'data class AddMore(val convId: String, val item: MediaItem, val once: Boolean, val replaceUri: String = "")',
        ) &&
        chat.includes("ScreenStore.pendingAddMore.collect { more ->") &&
        chat.includes("ScreenStore.editTitle = title") &&
        (chat.match(/\.put\("body", caption\)/g) || []).length === 6 &&
        chat.includes('MediaCaption(m.optText("body"), mine, theme)') &&
        chat.includes("MediaCaption(albumCaption, mine, theme)") &&
        // Owner round 45 (item 5): every close forgets the ticks — the
        // r44-3 confirm sheet is retired, back swipes the selection too.
        !chat.includes("showDeselect") &&
        !chat.includes('title = "Deselect media?"') &&
        chat.includes("onDismiss = {\n                    attachSel.clear()") &&
        chat.includes("if (showAttach) attachSel.clear()") &&
        // Owner round 44 (item 6): the caption is its own bubble now.
        // Owner round 45 (item 6): compact — 7x3 padding, 12.sp, no shadow.
        chat.includes("private fun MediaCaption(body: String, mine: Boolean, theme: String)") &&
        chat.includes("val captionShape =") &&
        chat.includes(".padding(horizontal = 7.dp, vertical = 3.dp)") &&
        chat.includes("platformStyle = PlatformTextStyle(includeFontPadding = false)") &&
        !chat.includes(".shadow(2.dp, captionShape)") &&
        // Owner round 42 (item 3): every media column hugs MY side.
        (
          chat.match(
            /Column\(horizontalAlignment = if \(mine\) Alignment\.End else Alignment\.Start\) \{/g,
          ) || []
        ).length === 5 &&
        (chat.match(/\.put\("body", m\.optText\("body"\)\)/g) || []).length >= 3,
    );
  }
  // r32-40: haptics polish — a five-verb vocabulary (tap / confirm / heavy /
  // toggle / reject) wired through the SHARED primitives so every sheet row,
  // primary button and confirm sheet buzzes, plus the missing moments.
  {
    const feel = kt("Feel.kt");
    const ui = kt("Ui.kt");
    const chat = kt("ChatScreen.kt");
    const cl = kt("ChatListScreen.kt");
    const calls = kt("CallScreens.kt");
    const settings = kt("SettingsScreen.kt");
    const login = kt("LoginScreen.kt");
    check(
      "r32-40: Haptics gains toggle(on) (TOGGLE_ON / TOGGLE_OFF on 34+, KEYBOARD_TAP below) and reject() (REJECT on 30+, LONG_PRESS below); all through View.performHapticFeedback so the system touch-feedback setting is honoured; no Vibrator use",
      feel.includes("fun toggle(on: Boolean) {") &&
        feel.includes(
          "if (on) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.TOGGLE_OFF",
        ) &&
        feel.includes("fun reject() {") &&
        feel.includes("v.performHapticFeedback(HapticFeedbackConstants.REJECT)") &&
        feel.includes("android.os.Build.VERSION.SDK_INT >= 34") &&
        feel.includes("android.os.Build.VERSION.SDK_INT >= 30") &&
        !feel.includes("Vibrator") &&
        !feel.includes("VibrationEffect"),
    );
    check(
      "r32-40: shared primitives buzz on their own — GoldBtn / ActionBtn tap, KpSheetRow taps, KpConfirmSheet Cancel taps and the confirm thuds (danger) or confirms, CompactSearchBar's clear taps",
      (ui.match(/onClick = \{ haptics\.tap\(\); onClick\(\) \},/g) || []).length === 2 &&
        ui.includes(
          ".clickable { haptics.tap(); onClick() }\n            .padding(horizontal = 14.dp, vertical = 13.dp),",
        ) &&
        ui.includes(".clickable { haptics.tap(); onDismiss() }") &&
        ui.includes(
          "if (danger) haptics.heavy() else haptics.confirm()\n                            onConfirm()",
        ) &&
        ui.includes('.clickable { haptics.tap(); onValueChange("") }'),
    );
    check(
      "r32-40: switches flip with toggle(on) (Settings ToggleRow, Crash reports, Private group); Settings hub / setting rows / logout / theme + ringtone picks tap; the username live-check's verdict buzzes (free taps, taken rejects)",
      (settings.match(/haptics\.toggle\(on\)/g) || []).length === 2 &&
        kt("GroupInfoScreen.kt").includes(
          "haptics.toggle(it)\n                        setPrivate(it)",
        ) &&
        settings.includes(
          ".let { m -> if (clickable) m.clickable { haptics.tap(); onClick() } else m }",
        ) &&
        settings.includes(
          "private fun HubRow(icon: ImageVector, label: String, onClick: () -> Unit) {\n    val haptics = rememberHaptics()",
        ) &&
        settings.includes(".clickable { haptics.tap(); confirmLogout = true }") &&
        settings.includes(
          "haptics.confirm()\n                            KpThemeMode.set(ctx, o.dark)",
        ) &&
        settings.includes("if (available == true) haptics.tap() else haptics.reject()"),
    );
    check(
      "r32-40: chat — the reply swipe taps once when it ARMS (all five bubble kinds), the select bar's actions buzz (copy confirms, delete-for-everyone / delete-for-me thud), the ⋮ taps, an error line rejects once when it appears, schedule-sheet chips / steppers / theme swatches tap, a parked message's X thuds, voice play taps",
      (chat.match(/if \(!wasArmed && kotlin\.math\.abs\(replyDrag\) >= /g) || []).length === 5 &&
        chat.includes(
          'cm.setPrimaryClip(android.content.ClipData.newPlainText("KuchuPuchu", text))\n                        haptics.confirm()',
        ) &&
        chat.includes("IconButton(onClick = { haptics.heavy(); unsendSelected() })") &&
        chat.includes("IconButton(onClick = { haptics.heavy(); deleteForMe() })") &&
        chat.includes("IconButton(onClick = { haptics.tap(); forwarding = true })") &&
        chat.includes(
          "IconButton(onClick = { haptics.tap(); menuOpen = true }, modifier = Modifier.size(36.dp))",
        ) &&
        chat.includes("LaunchedEffect(error) { if (error.isNotBlank()) haptics.reject() }") &&
        chat.includes(".clickable { haptics.tap(); dayOff = d }") &&
        chat.includes(".clickable { haptics.tap(); pm = isPm }") &&
        chat.includes(".clickable { haptics.tap(); onChange(values[(idx + 1) % values.size]) },") &&
        chat.includes(".clickable { haptics.tap(); onPick(o.id) }") &&
        chat.includes(
          'IconButton(onClick = { haptics.heavy(); onCancel(r.optString("id")) }, modifier = Modifier.size(30.dp))',
        ) &&
        chat.includes(
          "if (pendingEcho || fileKey.isBlank()) return@clickable // still uploading\n                        haptics.tap()\n                        player.toggle(ctx, id, fileKey)",
        ),
    );
    check(
      "r32-40: chat list — a selection tick taps, the hidden-chats triple tap and the archive opening confirm; calls — one confirm when the call connects (first remote media), the minimise chevron / Message / Remind me tap, the swipe circles tap at the arm point and confirm on release; login — Number verified / All set confirm, an error rejects; new group member tick, media tabs, video play / rotate tap",
      cl.includes("if (selecting && !revealed) haptics.tap()") &&
        cl.includes(
          "state.logo = true\n                    // Owner round 32 (item 40): the archive opening is felt.\n                    haptics.confirm()",
        ) &&
        calls.includes(
          "LaunchedEffect(engine.hasRemote) {\n        if (engine.hasRemote) gateHaptics.confirm()\n    }",
        ) &&
        calls.includes(".clickable { gateHaptics.tap(); engine.minimizeCall() },") &&
        (calls.match(/haptics\.tap\(\)\n                        engine\.decline\(\)/g) || [])
          .length === 2 &&
        calls.includes("if (!before && dragUpPx >= threshold) haptics.tap()") &&
        calls.includes(
          "if (dragUpPx >= threshold) {\n                                haptics.confirm()\n                                onSwipe()",
        ) &&
        login.includes(
          "if (stage == LoginStage.VERIFY_OK || stage == LoginStage.DONE) haptics.confirm()",
        ) &&
        login.includes("LaunchedEffect(error) { if (error.isNotBlank()) haptics.reject() }") &&
        kt("CreateGroupScreen.kt").includes('val id = u.optString("id")\n        haptics.tap()') &&
        kt("ChatMediaScreen.kt").includes(".clickable { haptics.tap(); tab = i }") &&
        kt("MediaViewer.kt").includes(
          "val p = player ?: return@clickable\n                            haptics.tap()",
        ) &&
        // v167: the player's rotating button is gone; its tap-buzz rides the
        // ⋮ that took the seat.
        kt("MediaViewer.kt").includes("IconButton(onClick = { haptics.tap(); menuOpen = true })"),
    );
  }
  // r32-41: voice isolation on calls — RNNoise (BSD, bundled source) behind a
  // C wrapper + JNI, run on every 10 ms mic buffer BEFORE the encoder; on by
  // default with one Privacy switch; a missing / refusing library passes the
  // microphone through untouched.
  {
    const cpp = "native-android/app/src/main/cpp/";
    const voice = readFileSync(cpp + "kp_voice.c", "utf8");
    const jni = readFileSync(cpp + "kp_voice_jni.c", "utf8");
    const cmake = readFileSync(cpp + "CMakeLists.txt", "utf8");
    const iso = kt("VoiceIsolation.kt");
    const engine = kt("CallEngine.kt");
    const gradle = readFileSync("native-android/app/build.gradle.kts", "utf8");
    const pro = readFileSync("native-android/app/proguard-rules.pro", "utf8");
    check(
      "r32-41: native — bundled RNNoise (COPYING + the 6 model/DSP sources), kp_voice wraps it: 10 ms chunks only (else -1, buffer untouched), down-mix → 48 kHz → rnnoise_process_frame → back to the mic rate → every channel, rounded + clamped; CMake builds ONE C library (gnu99, -O3, hidden visibility, no -ffast-math), no libc++",
      existsSync(cpp + "rnnoise/COPYING") &&
        ["denoise.c", "kiss_fft.c", "pitch.c", "celt_lpc.c", "rnn.c", "rnn_data.c"].every((f) =>
          existsSync(cpp + "rnnoise/src/" + f),
        ) &&
        voice.includes("if (!v || !pcm || channels <= 0 || frames != v->frames10) return -1;") &&
        voice.includes("float p = rnnoise_process_frame(v->st, v->out48, v->in48);") &&
        voice.includes("kp_resample(v->mono, frames, v->in48, KP_RN_FRAME);") &&
        voice.includes("kp_resample(v->out48, KP_RN_FRAME, v->mono, frames);") &&
        voice.includes("for (c = 0; c < channels; c++) pcm[i * channels + c] = q;") &&
        voice.includes(
          "if (sample_rate < 8000 || sample_rate > 192000 || sample_rate % 100 != 0) return NULL;",
        ) &&
        jni.includes("Java_app_kuchupuchu_android_VoiceIsolation_nativeProcess(") &&
        jni.includes("(*env)->GetDirectBufferAddress(env, buffer)") &&
        jni.includes("if (cap < (jlong)frames * channels * 2) return -1.f;") &&
        cmake.includes("add_library(\n    kp_voice SHARED") &&
        cmake.includes("set(CMAKE_C_EXTENSIONS ON)") &&
        cmake.includes('set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG -fvisibility=hidden")') &&
        !/CMAKE_C_FLAGS[A-Z_]* "[^"]*-ffast-math/.test(cmake) &&
        cmake.includes("target_compile_definitions(kp_voice PRIVATE RNNOISE_BUILD=1 TRAINING=0)") &&
        cmake.includes("target_link_libraries(kp_voice m)") &&
        !cmake.includes("c++_shared") &&
        gradle.includes('path = file("src/main/cpp/CMakeLists.txt")') &&
        gradle.includes('version = "3.22.1"') &&
        pro.includes(
          "-keepclasseswithmembernames class app.kuchupuchu.android.VoiceIsolation {\n    native <methods>;\n}",
        ),
    );
    check(
      "r32-41: app — VoiceIsolation.process runs FIRST in the WebRTC record callback (before the screen-share mix), prepare() on every call start, release() at call end; r34-9: strength in 3 steps (Normal/Medium/Aggressive, pref default Medium, live mid-call) with per-call cleaned/skipped counters; lazy loadLibrary with a permanent pass-through on failure; only PCM16 direct 10 ms buffers are touched; the state is rebuilt when the rate changes; the audio thread never reads SharedPreferences",
      engine.includes(
        "VoiceIsolation.process(audioFormat, channelCount, sampleRate, audioBuffer)\n                    SystemAudioTap.mixInto(audioFormat, channelCount, sampleRate, audioBuffer)",
      ) &&
        (engine.match(/ensureFactory\(app\)\n        VoiceIsolation\.prepare\(app\)/g) || [])
          .length === 3 &&
        engine.includes("AudioRouter.end(app)\n        VoiceIsolation.release()") &&
        iso.includes("getInt(LEVEL_PREF, 1)") &&
        iso.includes('System.loadLibrary("kp_voice")') &&
        iso.includes("loadFailed.set(true)") &&
        iso.includes("if (!wanted.get()) return") &&
        iso.includes('if (!audioBuffer.isDirect) {\n            skip("buffer")') &&
        iso.includes('if (frames != sampleRate / 100) {\n            skip("length")') &&
        iso.includes("if (handle == 0L || handleRate != sampleRate) {") &&
        iso.includes(
          "@JvmStatic private external fun nativeProcess(handle: Long, buffer: ByteBuffer, frames: Int, channels: Int): Float",
        ) &&
        !iso.includes("Log.") &&
        iso.includes("chunksOk.incrementAndGet()") &&
        iso.includes("fun diag(): String? {") &&
        // Owner round 39 (item 7): no not-run-yet instruction text anywhere.
        !iso.includes("Not run yet") &&
        !kt("SettingsScreen.kt").includes("Not run yet") &&
        iso.includes("private external fun nativeSetLevel(handle: Long, level: Int)") &&
        voice.includes("void kp_voice_set_level(KpVoice *v, int level) {") &&
        voice.includes("static const float wet[3] = { 0.55f, 0.8f, 1.f };") &&
        voice.includes("v->gate += (target - v->gate) * rate;") &&
        jni.includes("Java_app_kuchupuchu_android_VoiceIsolation_nativeSetLevel(") &&
        kt("SettingsScreen.kt").includes('listOf("Normal", "Medium", "Aggressive")') &&
        kt("SettingsScreen.kt").includes("VoiceIsolation.setLevel(ctx, i)") &&
        kt("SettingsScreen.kt").includes("VoiceIsolation.diag()") &&
        !kt("SettingsScreen.kt").includes('Voice isolation on calls", voiceIso)'),
    );
  }
  // r33-26 / r33-23: the two crash reports after v132 — the update sheet's
  // Install tap (snapshot race on singleton Compose state in a fresh process)
  // and the document viewer's "Open with" (FileProvider root miss).
  {
    const main = kt("MainActivity.kt");
    const store = kt("Store.kt");
    const files = kt("Files.kt");
    const doc = kt("DocViewerScreen.kt");
    const paths = readFileSync("native-android/app/src/main/res/xml/file_paths.xml", "utf8");
    check(
      "r33-26: every singleton holding Compose state is class-initialised on the main thread before Store.init / the starter thread (SnapshotSingletons.warm — KpUpdate, ScreenStore, VoiceNote, LinkPreviews, PhoneBook, UploadProgress, CallEngine.Companion)",
      store.includes("object SnapshotSingletons {") &&
        [
          "KpUpdate.checking",
          "ScreenStore.poke",
          "VoiceNote.livePeaks",
          "LinkPreviews.size()",
          "PhoneBook.syncing.value",
          "UploadProgress.fracs.size",
          "CallEngine.instance",
        ].every((m) => store.includes(m)) &&
        main.indexOf("SnapshotSingletons.warm()") > 0 &&
        main.indexOf("SnapshotSingletons.warm()") < main.indexOf("Store.init(this)") &&
        main.indexOf("SnapshotSingletons.warm()") <
          main.indexOf("val engine = CallEngine(application)") &&
        main.indexOf("SnapshotSingletons.warm()") < main.indexOf("KpUpdate.check(application)"),
    );
    check(
      "r33-23: the FileProvider exports filesDir/kp-doc-cache (the viewer's cache), the cache name no longer doubles the extension, and a provider miss is a toast instead of an uncaught IllegalArgumentException",
      /<files-path name="docs" path="kp-doc-cache\/" \/>/.test(paths) &&
        doc.includes(
          'val named = if (ext.isBlank() || safe.endsWith(".$ext")) safe else "$safe.$ext"',
        ) &&
        files.includes(
          'androidx.core.content.FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)',
        ) &&
        /val uri =\s*runCatching \{\s*androidx\.core\.content\.FileProvider\.getUriForFile/.test(
          files,
        ) &&
        files.includes(
          'android.widget.Toast.makeText(ctx, "Could not open", android.widget.Toast.LENGTH_SHORT).show()',
        ),
    );
  }

  // r33 item 3 (part A — text): a message must never vanish for leaving the
  // chat before it went out, or for being offline. sendText used to POST on the
  // screen's rememberCoroutineScope (leaving cancelled it) and only queue on an
  // exception; queued rows were never painted on re-entry; the queue's retry
  // clock never re-armed itself after `bump`. Now: Outbox.send persists BEFORE
  // the request leaves and posts on the queue's own scope; pendingFor() feeds
  // the clock bubbles back to the chat on open; flushNow re-arms via
  // OutboxPolicy.nextWakeMs; the POST's own response row is painted (item 4).
  {
    const cache = kt("Cache.kt");
    const policy = kt("OutboxPolicy.kt");
    const policyTest = readFileSync(
      "native-android/app/src/test/java/app/kuchupuchu/android/OutboxPolicyTest.kt",
      "utf8",
    );
    const chat33 = kt("ChatScreen.kt");
    const sendText33 = chat33.slice(
      chat33.indexOf('fun sendText(body: String, kind: String = "TEXT") {'),
      chat33.indexOf("fun loadScheduled() {"),
    );
    const flush33 = cache.slice(
      cache.indexOf("suspend fun flushNow"),
      cache.indexOf("private fun purgeInvalid"),
    );
    const send33 = cache.slice(
      cache.indexOf(
        "fun send(\n        convId: String,\n        clientId: String,\n        body: JSONObject,",
      ),
      cache.indexOf("fun pendingFor(convId: String)"),
    );
    check(
      "r33-3a: Outbox.send is queue-first — the payload is enqueued (persisted) before the POST, the POST runs on the queue's scope, a blip bumps + re-kicks, a permanent 4xx refuses (text comes back via §20), the result is delivered on Main and an unpainted outcome pokes the chat",
      cache.includes(
        "fun send(\n        convId: String,\n        clientId: String,\n        body: JSONObject,\n        local: JSONObject? = null,\n        onResult: ((Result<JSONObject>) -> Boolean)? = null,\n    ) {",
      ) &&
        send33.indexOf("enqueue(convId, clientId, body, local)") <
          send33.indexOf('Api.post("/api/conversations/$convId/messages", ready)') &&
        send33.includes("inflight.add(clientId)") &&
        send33.includes("if (status in 400..499 && status != 408 && status != 429) {") &&
        send33.includes("refuse(clientId)") &&
        send33.includes('bump(clientId, e.message ?: "network")') &&
        send33.includes("kick(OutboxPolicy.waitMs(1))") &&
        send33.includes(
          "val painted = withContext(Dispatchers.Main) { onResult?.invoke(outcome) ?: false }",
        ) &&
        send33.includes("if (!painted) ScreenStore.pokeInbox()") &&
        cache.includes("fun pendingFor(convId: String): List<JSONObject> =") &&
        cache.includes('row.put("queued", true)') &&
        cache.includes("fun awaitLoaded(ms: Long = 3_000): Boolean =") &&
        cache.includes("loadLatch.countDown()") &&
        // a send in the first milliseconds must not be wiped by the load landing after it
        cache.includes('items.addAll(0, loaded.filter { it.optString("clientId") !in have })') &&
        cache.includes("if (kickPending && kickDueAt <= dueAt && (kickForce || !force)) return") &&
        cache.includes("if (kickPending) kickJob?.cancel()") &&
        cache.includes("if (flushing) return retryLater(force)"),
    );
    check(
      "r33-3a: flushNow waits for the loader (off Main), skips in-flight sends, counts refusals (poke), and re-arms itself from OutboxPolicy.nextWakeMs only when it was not cancelled by a newer kick; a success force-kicks the rest; save() snapshots under the lock and writes on one ordered thread",
      flush33.includes("withContext(Dispatchers.IO) { awaitLoaded() }") &&
        flush33.includes("if (clientId in inflight) continue") &&
        flush33.includes('pathDeadUntil = bump(clientId, e.message ?: "network")') &&
        flush33.includes(
          "if (kotlin.coroutines.coroutineContext.isActive) rearm(sent, pathDeadUntil) else kick(2_000, force)",
        ) &&
        flush33.includes(
          "if (sent > 0) ScreenStore.pokeInbox() else if (refused > 0) ScreenStore.pokeInbox()",
        ) &&
        cache.includes("private fun rearm(sent: Int, pathDeadUntil: Long) {") &&
        cache.includes(
          "val wake = OutboxPolicy.nextWakeMs(left.map { maxOf(it, dead) }, now) ?: return",
        ) &&
        cache.includes("kick(500, force = true)") &&
        cache.includes("kick(if (Api.inCooldown()) maxOf(wake, 15_000L) else wake)") &&
        cache.includes('Executors.newSingleThreadExecutor { r -> Thread(r, "kp-outbox-write")') &&
        cache.includes("writer.execute {") &&
        policy.includes("fun nextWakeMs(deadlines: List<Long>, nowMs: Long): Long? =") &&
        policy.includes(
          "deadlines.filter { it < PARKED }.minOrNull()?.let { maxOf(1_000L, it - nowMs) }",
        ) &&
        policyTest.includes("OutboxPolicy.nextWakeMs(emptyList(), now)") &&
        policyTest.includes("OutboxPolicy.nextWakeMs(listOf(now + OutboxPolicy.waitMs(1)), now)"),
    );
    check(
      "r33-3a: the chat sends text through Outbox.send (no Api.post on the screen scope, r32-48 scroll coroutine kept, draft released right after the queue owns it), paints the reply row via paintSent while alive, seeds queued rows from Outbox.pendingFor on open, and the leave effect flips `alive`",
      sendText33.includes("Outbox.send(convId, clientId, payload) { outcome ->") &&
        !sendText33.includes("Api.post(") &&
        !sendText33.includes("Outbox.add(") &&
        !sendText33.includes("refreshMessages(") &&
        sendText33.includes("reconcileRefused()") &&
        chat33.includes("fun reconcileRefused() {") &&
        // the refusal pass runs BEFORE the marker GET (an "unchanged" page used to skip it)
        chat33.indexOf("fun reconcileRefused() {") < chat33.indexOf("fun refreshMessages(") &&
        /scope\.launch \{\n\s+try \{\n\s+reconcileRefused\(\)/.test(chat33) &&
        sendText33.includes(
          "if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }",
        ) &&
        sendText33.includes("if (!alive.get()) return@send false") &&
        sendText33.includes("outcome.onSuccess { row -> paintSent(row) }") &&
        sendText33.includes("Drafts.clear(convId)") &&
        sendText33.indexOf("Outbox.send(") < sendText33.indexOf("Drafts.clear(convId)") &&
        chat33.includes("fun paintSent(row: JSONObject) {") &&
        chat33.includes("ScreenStore.setMsgs(convId, msgs.toList())") &&
        chat33.includes(
          "val alive = remember(convId) { java.util.concurrent.atomic.AtomicBoolean(true) }",
        ) &&
        chat33.includes("alive.set(false)") &&
        chat33.includes("withContext(Dispatchers.IO) { Outbox.awaitLoaded() }") &&
        chat33.includes("Outbox.pendingFor(convId).forEach { row ->") &&
        chat33.indexOf("Outbox.pendingFor(convId).forEach") <
          chat33.indexOf("refreshMessages(markRead = true)"),
    );
  }
  // r33 item 3 (part B — media): photo / voice / document sends take the same
  // queue-first road. The FILE payload is queued WITH the local copy's path
  // before the upload starts; Outbox.materialize uploads it from the queue's
  // scope (chat open or not, now or after the network is back) and writes the
  // key back so a repeated walk never uploads twice; the re-entry echo draws
  // the local copy (file:// through Bitmaps, voicePath / docPath for retry).
  {
    const cache = kt("Cache.kt");
    const chat33 = kt("ChatScreen.kt");
    const ui33 = kt("Ui.kt");
    const uploads = chat33.slice(
      chat33.indexOf("object Uploads {"),
      chat33.indexOf("private fun ImageBubble("),
    );
    const sendImage33 = chat33.slice(
      chat33.indexOf("fun sendImage("),
      chat33.indexOf("suspend fun sendFile("),
    );
    const sendVoice33 = chat33.slice(
      chat33.indexOf("fun sendVoice(file: File, seconds: Int"),
      chat33.indexOf("fun handleImagePicked("),
    );
    check(
      "r33-3b: Outbox.send takes the local copy (`local.path`, temp) into the queue entry; materialize uploads a keyless FILE payload from disk, writes the key back (setKey), refuses a vanished file with 410; both the immediate send and flushNow go through it and delete a temp copy only after the POST succeeded",
      cache.includes(
        "local: JSONObject? = null,\n        onResult: ((Result<JSONObject>) -> Boolean)? = null,",
      ) &&
        cache.includes("enqueue(convId, clientId, body, local)") &&
        cache.includes(
          '.also { if (local != null) it.put("local", JSONObject(local.toString())) },',
        ) &&
        cache.includes(
          "private fun materialize(clientId: String, body: JSONObject, local: JSONObject?): JSONObject {",
        ) &&
        cache.includes(
          'if (body.optString("kind") != "FILE" || body.optString("fileKey").isNotBlank()) return body',
        ) &&
        cache.includes(
          'if (!f.exists()) throw ApiException(410, "That file is no longer on this phone.")',
        ) &&
        cache.includes("setKey(clientId, key, f.length())") &&
        cache.includes("val ready = materialize(clientId, body, local)") &&
        cache.includes(
          'Api.post("/api/conversations/$convId/messages", materialize(clientId, body, local))',
        ) &&
        (
          cache.match(
            /local\?\.optString\("path"\)\?\.takeIf \{ it\.isNotBlank\(\) && local\.optBoolean\("temp"\) \}\?\.let \{ File\(it\)\.delete\(\) \}/g,
          ) || []
        ).length === 2 &&
        cache.includes('meta?.optBoolean("voice") == true -> row.put("voicePath", p)') &&
        cache.includes('row.put("mediaUrl", "file://$p")') &&
        cache.includes('else -> row.put("docPath", p)') &&
        // a refusal takes the temp copy with it; orphan JPEGs are swept on load.
        // v163: the two cancel sites (a queued id in the retry walk, and one
        // cancelled mid-upload) drop it too — a cancelled send leaves nothing.
        cache.includes("private fun dropLocal(item: JSONObject) {") &&
        cache.includes("if (status == 499 || isCancelled(clientId)) {") &&
        (cache.match(/dropLocal\(it(?:em)?\)/g) || []).length === 4 &&
        cache.includes("private fun sweepMedia() {") &&
        chat33.includes('url.startsWith("file://") -> scope.launch {') &&
        ui33.includes(
          'url.startsWith("file://") -> java.io.File(url.removePrefix("file://")).takeIf { it.exists() }?.readBytes()',
        ) &&
        chat33.includes(
          'val dataBmp = if (url?.startsWith("data:") == true || url?.startsWith("file://") == true) rememberBitmap(url) else null',
        ),
    );
    check(
      "r33-3b: Uploads is queue-first (no Deferred, no Outbox.add, no Api.post): sendFile hands the body + local path to Outbox.send; sendPhoto writes the JPEG under filesDir/kp-outbox-media/<clientId>.jpg first; sendImage / sendVoice / sendFile (v166: suspend) in the chat paint through paintSent while alive and never POST on the screen scope any more",
      uploads.includes(
        'Outbox.send(convId, clientId, body, JSONObject().put("path", file.absolutePath).put("temp", true), onResult)',
      ) &&
        uploads.includes('File(app.filesDir, "kp-outbox-media").apply { mkdirs() }') &&
        uploads.includes('File(dir, "$clientId.jpg").also { it.writeBytes(jpeg) }') &&
        uploads.includes(
          'sendFile(convId, clientId, "photo.jpg", "image/jpeg", f, null, payload, onResult)',
        ) &&
        !uploads.includes("Deferred") &&
        !uploads.includes("Outbox.add(") &&
        !uploads.includes("Api.post(") &&
        !chat33.includes("import kotlinx.coroutines.Deferred") &&
        !chat33.includes("import kotlinx.coroutines.async") &&
        sendImage33.includes(
          "Uploads.sendPhoto(ctx, convId, clientId, jpeg, payload) { outcome ->",
        ) &&
        sendImage33.includes("if (!alive.get()) return@sendPhoto false") &&
        !sendImage33.includes('put("imageData", small)') &&
        !sendImage33.includes("delay(1_500)") &&
        sendVoice33.includes(
          'Uploads.sendFile(convId, clientId, name, "audio/mp4", file, null, payload) { outcome ->',
        ) &&
        sendVoice33.includes("if (!alive.get()) return@sendFile false") &&
        !sendVoice33.includes("Api.upload(") &&
        !sendVoice33.includes("Api.post(") &&
        // sendAt (scheduled) paths still post directly — they are not optimistic bubbles
        (sendImage33.match(/Api\.post\(/g) || []).length === 1 &&
        // r34-16b: sendFile grew a captioned arm (the same callback on both arms).
        // v171: the background clip send paints through the same hook.
        (chat33.match(/outcome\.onSuccess \{ row -> paintSent\(row\) \}/g) || []).length === 6,
    );
  }
  // r33 item 2: auto-scroll to the new thing everywhere. Keyed LazyColumns
  // pin the first VISIBLE KEY across a data-set change, so a row that moved
  // to the head landed above the fold; KpKeepTop (one helper) lands the list
  // on index 0 during that remeasure when the viewport was already at the
  // top and nobody is dragging. The chat's socket fast-paint and paintSent
  // follow the thread when near the bottom. Calls re-sync on call end;
  // the status tab gets a live trigger + newest-first order.
  {
    const ui = kt("Ui.kt");
    const list = kt("ChatListScreen.kt");
    const tab = kt("CallsTabScreen.kt");
    const status = kt("StatusScreens.kt");
    const chat = kt("ChatScreen.kt");
    const store = kt("ScreenStore.kt");
    const eng = kt("CallEngine.kt");
    const push = kt("KpPush.kt");
    const keepTop = ui.slice(
      ui.indexOf("fun KpKeepTop(listState: LazyListState, headKey: Any?) {"),
    );
    check(
      "r33-2: KpKeepTop — a head-key change lands a keyed list on index 0 in the same remeasure (requestScrollToItem, no animation), only when the viewport is at / one row from the top and no drag is in progress; chat list, calls tab and status tab all use it",
      ui.includes("import androidx.compose.runtime.SideEffect") &&
        keepTop.includes("SideEffect {") &&
        keepTop.includes(
          "if (headKey == null || prev == null || prev == headKey) return@SideEffect",
        ) &&
        keepTop.includes("if (listState.isScrollInProgress) return@SideEffect") &&
        keepTop.includes("val nearTop = first == null || first.index <= 1") &&
        keepTop.includes("if (nearTop) listState.requestScrollToItem(0)") &&
        !keepTop.includes("animateScrollToItem") &&
        list.includes('KpKeepTop(listState, visible.firstOrNull()?.optString("id"))') &&
        list.indexOf("KpKeepTop(listState") < list.indexOf("state = listState,") &&
        tab.includes('KpKeepTop(callsList, shown.firstOrNull()?.optString("id"))') &&
        tab.includes("state = callsList,") &&
        status.includes(
          'KpKeepTop(statusList, others.firstOrNull()?.optJSONObject("user")?.optString("id"))',
        ) &&
        status.includes("state = statusList,"),
    );
    const fastPaint = chat.slice(
      chat.indexOf("// New inbound message: chronological = append at the"),
      chat.indexOf(
        "ScreenStore.setMsgs(convId, msgs.toList())\n                        }\n                        // Viewed live with the chat open",
      ),
    );
    const paintSent = chat.slice(
      chat.indexOf("fun paintSent(row: JSONObject) {"),
      chat.indexOf('fun sendText(body: String, kind: String = "TEXT") {'),
    );
    check(
      "r33-2: chat — the socket fast-paint and paintSent decide 'near the bottom' BEFORE the rows move (last visible index >= total - 2, no drag) and then follow the thread in their own coroutine; a reader scrolled up is left alone",
      fastPaint.includes("val info = listState.layoutInfo") &&
        fastPaint.indexOf("val follow =") < fastPaint.indexOf("msgs.add(liveMsg)") &&
        fastPaint.includes(
          "info.visibleItemsInfo.lastOrNull()?.index?.let { it >= info.totalItemsCount - 2 } == true",
        ) &&
        fastPaint.includes(
          "if (follow) {\n                                        scope.launch {\n                                            val total = msgs.size + pending.size\n                                            if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }",
        ) &&
        paintSent.indexOf("val follow =") < paintSent.indexOf("if (idx >= 0) {") > -1 &&
        paintSent.indexOf("FxArrivals.markSeen(id)") > -1 &&
        paintSent.includes("!listState.isScrollInProgress &&") &&
        paintSent.includes(
          "if (follow) {\n            scope.launch {\n                val total = msgs.size + pending.size\n                if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }",
        ),
    );
    check(
      "r33-2: calls — ScreenStore.callsVersion (warmed) is bumped 1.5s after an engine teardown and by the missed-call push; the tab's effect keys on it and forces the history GET past the 20s cache; status — inbox pokes and a 12s foreground tick re-read /api/statuses (forced), contacts are ordered newest-update-first",
      store.includes("var callsVersion by mutableStateOf(0)") &&
        store.includes("fun pokeCalls() {") &&
        kt("Store.kt").includes("ScreenStore.poke\n            ScreenStore.callsVersion"),
    );
    check(
      "r33-2: calls tab / engine / push wiring",
      eng.includes(
        "if (active != null) Handler(Looper.getMainLooper()).postDelayed({ ScreenStore.pokeCalls() }, 1_500)",
      ) &&
        eng.indexOf("postDelayed({ ScreenStore.pokeCalls() }, 1_500)") <
          eng.indexOf("        active = null\n") &&
        push.includes(
          "ScreenStore.pokeInbox()\n        // Owner round 33 (item 2): a missed call is a new history row.\n        ScreenStore.pokeCalls()",
        ) &&
        tab.includes("LaunchedEffect(ScreenStore.callsVersion) {") &&
        tab.includes(
          "val forced = ScreenStore.callsVersion > 0 && ScreenStore.callsVersion != lastCallsVersion",
        ) &&
        tab.includes('Api.get("/api/calls/history", force = forced)') &&
        tab.includes("private var lastCallsVersion = 0") &&
        !tab.includes("LaunchedEffect(Unit) {"),
    );
    check(
      "r33-2: status tab wiring",
      status.includes("fun refresh(force: Boolean = false) {") &&
        status.includes('Api.get("/api/statuses", force)') &&
        status.includes(
          "LaunchedEffect(ScreenStore.poke) {\n        if (ScreenStore.poke > 0 && Store.foreground) refresh(force = true)",
        ) &&
        status.includes(
          "delay(12_000)\n            if (Store.foreground && !Api.inCooldown()) refresh(force = true)",
        ) &&
        status.includes(
          '.sortedByDescending { g -> g.arr("statuses").objects().maxOfOrNull { it.optString("createdAt") } ?: "" }',
        ),
    );
  }
  // r33 item 5: Bangla / emoji bodies had the time + ticks on the glyphs and
  // sat lower than English. The bubble reserved the stamp's width with a run
  // of no-break spaces sized for Roboto and painted the stamp over the
  // bubble's bottom edge; a Noto Sans Bengali body (other space width, deeper
  // last-line descent, taller first-line ascent) and emoji broke both
  // assumptions. KpStamped measures instead: the body reports its
  // TextLayoutResult, the stamp goes after the LAST line when it fits, else
  // on its own row — for any script, RTL included.
  {
    const ui = kt("Ui.kt");
    const chat = kt("ChatScreen.kt");
    check(
      "v169: KpStamped is RETIRED - the stamp no longer shares the bubble's column, so the measured two-slot Layout and its holder are gone from Ui.kt",
      !ui.includes("fun KpStamped(") && !ui.includes("class KpTextLayoutHolder {"),
    );
    const textBranch = chat.slice(
      chat.indexOf('"STICKER" -> {'),
      chat.indexOf("// Owner round 16: reaction chips under the bubble."),
    );
    check(
      "r34-19 + N3r: bodies longer than ten lines fold (3 capped Texts — emoji is a glyph row now, never folds) behind a See more / See less toggle (v166: the count is measured WHILE COMPOSING at the bubble's own width, so the fold is right on the first frame; the onTextLayout high-water count stays as the second witness; typing replies exempt)",
      chat.includes("private const val BODY_COLLAPSE_LINES = 10") &&
        chat.includes("var bodyLines by remember(mid) { mutableStateOf(0) }") &&
        chat.includes("var msgExpanded by remember(mid) { mutableStateOf(false) }") &&
        chat.includes(
          "val longBody = bodyLines > BODY_COLLAPSE_LINES || probeLines > BODY_COLLAPSE_LINES",
        ) &&
        chat.includes("val capped = !msgExpanded && !typing && longBody") &&
        chat.includes("val probeLines =") &&
        chat.includes("val foldProbe = rememberTextMeasurer()") &&
        chat.includes(
          "val countLines = { r: TextLayoutResult, report: (TextLayoutResult) -> Unit ->",
        ) &&
        (chat.match(/maxLines = if \(capped\) BODY_COLLAPSE_LINES else Int\.MAX_VALUE,/g) || [])
          .length === 3 &&
        chat.includes("if (longBody && !typing && selectedIds.isEmpty()) {") &&
        chat.includes('"See less"') &&
        chat.includes('"See more"') &&
        chat.includes("msgExpanded = !msgExpanded"),
    );
    check(
      "E1: the See more / See less toggle has exactly ONE tap handler (the triple stack double-toggled exact-text taps into a no-op) and the fold keeps its spring animation",
      chat.includes(
        "animateContentSize(animationSpec = spring(dampingRatio = 0.85f, stiffness = 400f))",
      ) &&
        (chat.match(/msgExpanded = !msgExpanded/g) || []).length === 1 &&
        chat.includes('if (msgExpanded) "See less" else "See more"'),
    );
    check(
      "v169 + N3r: chat — bodies render PLAIN (no KpStamped); the fold's countLines still hears every foldable body Text (3 — the multi-emoji Text is a glyph row now, and ≤24-char emoji bodies never fold); ONE stamp Row under the bubble serves every kind in the single wallpaper ink",
      (textBranch.match(/KpStamped\(/g) || []).length === 0 &&
        (textBranch.match(/countLines\(it, \{ _ -> \}\)/g) || []).length === 3 &&
        !textBranch.includes("val reserve =") &&
        textBranch.includes('val full = m.optText("body")\n') &&
        chat.includes("private fun BubbleStamp(") &&
        (
          chat.match(
            /BubbleStamp\(m, mine, pendingEcho, otherReadAt, if \(kind == "STICKER"\) 1 else emojiOnly, stampInk\)/g,
          ) || []
        ).length === 1 &&
        !chat.includes("val mineStampInk =") &&
        chat.includes("color = stampInk,") &&
        // v166's mode-aware blue survives as the single stamp ink
        chat.includes("if (KpThemeMode.darkBlue) Color(0xFFA9C4F2) else Color(0xFF5B7FC7)") &&
        chat.includes(
          "TickIcon(m, pendingEcho, otherReadAt, onWallpaper = emojiOnly > 0, ink = stampInk)",
        ),
    );
  }
  // r33 item 7: the notification's Like action used to send the sentence
  // "Liked your message"; the owner wants a thumbs-up.
  {
    const notify = kt("KpNotify.kt");
    const like = notify.slice(
      notify.indexOf("ACTION_LIKE -> {"),
      notify.indexOf("ACTION_DECLINE_LOGIN -> {"),
    );
    check(
      "r33-7: notification Like action posts a TEXT message whose body is 👍 (U+1F44D), never 'Liked your message'",
      like.includes('.put("body", "\\uD83D\\uDC4D")') &&
        !like.includes("Liked your message") &&
        !notify.includes("Liked your message"),
    );
  }
  // r33 item 12: media from others read "photo.jpg / voice.m4a / video.mp4"
  // in the chat list and in notifications. The words come from the worker
  // (previewOf) for every new row and push; the app maps older rows and
  // every push body the same way, everywhere a preview is drawn.
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const previewOf = src.slice(
      src.indexOf("function previewOf(row: MsgRow): string {"),
      src.indexOf("async function fanOutProfileChange("),
    );
    const cl = kt("ChatListScreen.kt");
    const fp = cl.slice(
      cl.indexOf("internal fun friendlyPreview(raw: String): String {"),
      cl.indexOf("private fun ConvCard("),
    );
    check(
      "r33-12: worker — a document previews as 'Document' (never meta.name); media files as Photo / Video / Voice message; the AI photo row says 'Photo' without an emoji",
      previewOf.includes('return "Document";') &&
        !previewOf.includes("meta.name") &&
        previewOf.includes('if (meta.voice) return "Voice message";') &&
        !src.includes('"📷 Photo"'),
    );
    check(
      "r33-12: app — friendlyPreview is shared (internal), returns Photo / Voice message / Video / Document with no emoji, treats links and multi-line text as text, and is applied to the list row, both Search chat rows, the push card and the poll fallback card",
      fp.length > 0 &&
        fp.includes('lower == "video" || lower == "🎬 video" -> "Video"') &&
        fp.includes('lower == "document" || lower == "📄 document" -> "Document"') &&
        fp.includes('fileLike && videoExts.any { lower.endsWith(it) } -> "Video"') &&
        fp.includes('fileLike && docExts.any { lower.endsWith(it) } -> "Document"') &&
        fp.includes("val fileLike = !t.contains(\"://\") && !t.contains('\\n')") &&
        !fp.includes('"🎬 Video"') &&
        !fp.includes('"📄 Document"') &&
        cl.includes('val preview = friendlyPreview(conv.optText("lastMessage"))') &&
        cl.includes(
          'KpNotify.message(ctx, name, friendlyPreview(c.optString("lastMessage")), id)',
        ) &&
        kt("KpPush.kt").includes('friendlyPreview(data["body"] ?: "New message"),') &&
        (kt("SearchScreen.kt").match(/friendlyPreview\(/g) || []).length === 2,
    );
  }
  // r33 items 13 + 15: "Call update failed" toasts, calls stuck on
  // Connecting, dropped on Wi-Fi ↔ data / VPN; the callee's timer running
  // while the caller still rings and the caller's clock opening at 0:07.
  {
    const eng = kt("CallEngine.kt");
    const api = kt("Api.kt");
    check(
      "r33-15: the timer starts at the REAL connection on each side — PeerConnectionState.CONNECTED (ICE + DTLS) stamps this phone's own connect moment, a re-connect never rewinds it, and neither the poll nor the answer response seeds the clock from the server's answer timestamp",
      eng.includes(
        "override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {",
      ) &&
        eng.includes("private fun markConnected() {") &&
        eng.includes("if (!cur.connecting && cur.startedAt > 0L) return") &&
        eng.includes(
          "active = cur.copy(connecting = false, startedAt = System.currentTimeMillis())",
        ) &&
        eng.includes(
          'if (status == "ACTIVE" && current?.connecting == false && current.startedAt > 0L) current.startedAt',
        ) &&
        !eng.includes("serverMs") &&
        !eng.includes("active = active?.copy(startedAt = ms, connecting = true)") &&
        !eng.includes("if (ms > 0L) active = active?.copy(startedAt = ms)") &&
        eng.includes(
          "startedAt = if (!cur.connecting && cur.startedAt > 0L) cur.startedAt else System.currentTimeMillis(),",
        ),
    );
    check(
      "r33-15: faster connect — Accept answers from the offer the ring already carried (no extra /active round trip), pulls the caller's candidates while the answer posts, socket ICE frames are applied directly (own echo = no tick), and the safety-net poll stays at 1.5 s until media is up",
      eng.includes("private fun cachedOffer(callId: String): String") &&
        eng.includes("var offer = cachedOffer(rec.id)") &&
        eng.includes("val posting =\n                    async(Dispatchers.IO) {") &&
        eng.includes("pullIce(rec.id)\n                posting.await().getOrThrow()") &&
        eng.includes("private fun applyIceFrame(ev: JSONObject): Boolean {") &&
        eng.includes('if (ev.optString("from") == Store.myId()) return true') &&
        eng.includes(
          't == "ice" && cid.isNotBlank() && cid == mine && active?.group != true -> {',
        ) &&
        eng.includes("wsId != null && KpSocket.callLive(wsId) && mediaUp -> 5_000L") &&
        eng.includes("wsId != null && KpSocket.callLive(wsId) -> 1_500L"),
    );
    check(
      "r33-13: no 'Call update failed' toast (a slow /active is a counted miss, the loop retries silently); the default-network watch reconnects every socket, drops pooled HTTP connections and restarts ICE when media is not back; the watchdog repairs MID-CALL disconnects too (no `connecting` guard) and fast after a network change; ICE FAILED after the relay retry restarts (bounded) instead of giving up",
      !eng.includes("Call update failed") &&
        eng.includes("withTimeoutOrNull(4_500)") &&
        eng.includes("mgr.registerDefaultNetworkCallback(cb)") &&
        eng.includes("private fun onNetworkChanged() {") &&
        eng.includes("KpSocket.bounceAll()") &&
        eng.includes("Api.http.connectionPool.evictAll()") &&
        eng.includes("private fun restartIce(reason: String) {") &&
        eng.includes("if (iceRestartCount >= MAX_ICE_RESTARTS) {") &&
        eng.includes("private fun armIceWatchdog(delayMs: Long = 12_000L) {") &&
        !eng.includes("if (active?.connecting != true) return@Runnable") &&
        eng.includes("armIceWatchdog(if (recentNetworkChange()) 800L else 4_000L)") &&
        api.includes("fun bounceAll() {") &&
        api.includes("runCatching { old?.cancel() }"),
    );
  }
  // Items 21 + 22: audio call + screen share — the far side's card was black and
  // the system-audio tap died. Two causes: every per-tick "In a call with …"
  // re-post of the ongoing notification re-declared the foreground service
  // WITHOUT the mediaProjection type, so Android 13–16 stopped the projection
  // within seconds; and on a voice call both phones rendered "the first video
  // receiver", an m-line that never carried a frame.
  {
    const eng = kt("CallEngine.kt");
    const svc = kt("CallNotify.kt");
    const cap = kt("KpScreenCapturer.kt");
    check(
      "r33-21: the foreground service keeps the mediaProjection type for the whole share — every notification update goes through fgTitle(), the type stays declared while shareFgs is up, CallService.start() cannot drop it, stopShare / aborted starts release it, hangup resets it",
      eng.includes("@Volatile var shareFgs = false") &&
        eng.includes("private fun fgTitle(title: String) {") &&
        eng.includes(
          'CallService.start(app, if (shareFgs) "Sharing screen" else title, share = shareFgs)',
        ) &&
        eng.includes("private fun dropShareFgs() {") &&
        eng.includes("if (active != null) fgTitle(callTitle())") &&
        eng.includes('shareFgs = true\n        fgTitle("Sharing screen")') &&
        (eng.match(/CallService\.start\(/g) ?? []).length === 1 &&
        (eng.match(/dropShareFgs\(\)/g) ?? []).length >= 5 &&
        eng.includes("sharing = false\n        shareFgs = false") &&
        svc.includes("val keepShare = share || CallEngine.instance?.shareFgs == true") &&
        svc.includes('.putExtra("share", keepShare)') &&
        !svc.includes('.putExtra("share", share)'),
    );
    check(
      "r33-21: one video m-line per call, bound from onAddTrack — the answering side (1:1 callee, group answering leg) no longer pre-adds a second video transceiver, rebindRemoteVideo() never re-scans the receiver list, senders do not own the track wrappers they carry, a projection that will not open fails loudly instead of sharing black, and the camera is only stopped once the projection is up",
      eng.includes("private fun newPc(preaddVideo: Boolean = true): PeerConnection {") &&
        eng.includes("val peer = newPc(preaddVideo = false)") &&
        eng.includes("if (videoTrack == null && preaddVideo) {") &&
        eng.includes("} else if (Store.myId() < peerId) {") &&
        !eng.includes("firstNotNullOfOrNull { it.track() as? VideoTrack }") &&
        !eng.includes(".receivers") &&
        eng.includes(
          "val track = remoteVideo ?: return\n        remoteView?.let { runCatching { track.addSink(it) } }",
        ) &&
        !eng.includes("setTrack(track, true)") &&
        (eng.match(/setTrack\(track, false\)/g) ?? []).length === 4 &&
        eng.indexOf("screen.startCapture(720, 1280, 20)") <
          eng.indexOf("// Only now, with the projection up, does the camera make way.") &&
        cap.includes('?: throw IllegalStateException("No media projection")'),
    );
    check(
      "r33-22: system audio over screen share rides the same projection — the tap starts on the projection before the virtual display and is mixed in the mic callback (unchanged), so keeping the mediaProjection type declared (r33-21) is what keeps it alive",
      cap.includes("SystemAudioTap.start(app, mp)") &&
        cap.indexOf("SystemAudioTap.start(app, mp)") < cap.indexOf("mp.createVirtualDisplay(") &&
        eng.includes("SystemAudioTap.mixInto(audioFormat, channelCount, sampleRate, audioBuffer)"),
    );
  }
  // Item 16: video-call UI — no touch effect on the surface, icon-only compact
  // action buttons (no caption under the circles).
  {
    const ui = kt("CallScreens.kt");
    const strip = ui.slice(
      ui.indexOf("private fun StripAction("),
      ui.indexOf("private fun StripAction(") + 2200,
    );
    check(
      "r33-16: the video surface toggles its controls with indication = null (no ripple over the picture), the strip buttons are icon-only circles (label = content description, no Text under them, no ripple), and the pill is compact (spacedBy, wraps its content)",
      (ui.match(/\) \{ controlsVisible = !controlsVisible \},/g) ?? []).length === 2 &&
        (
          ui.match(
            /interactionSource = remember \{ MutableInteractionSource\(\) \},\n\s+indication = null,\n\s+\) \{ controlsVisible = !controlsVisible \},/g,
          ) ?? []
        ).length === 2 &&
        !ui.includes(".clickable { controlsVisible = !controlsVisible },") &&
        !strip.includes("Text(label") &&
        !strip.includes("Column(") &&
        strip.includes("contentDescription = label,") &&
        strip.includes("indication = null,") &&
        (ui.match(/horizontalArrangement = Arrangement\.spacedBy\(12\.dp\),/g) ?? []).length ===
          3 &&
        !ui.includes(
          "horizontalArrangement = Arrangement.SpaceEvenly,\n            verticalAlignment = Alignment.CenterVertically,\n        ) {\n            val routeAction",
        ),
    );
  }
  // Item 17: a media reply shows a small content card (photo / video frame /
  // mic / file) in the composer bar and in the bubble quote; tapping the
  // bubble quote jumps to the original (paging back when needed) and flashes it.
  {
    const chat = kt("ChatScreen.kt");
    const bar = chat.slice(
      chat.indexOf("private fun ReplyQuoteBar("),
      chat.indexOf("private fun ReplyQuoteBar(") + 3200,
    );
    const thumb = chat.slice(
      chat.indexOf("private fun QuoteThumb("),
      chat.indexOf("private fun QuoteThumb(") + 1900,
    );
    const lo = chat.slice(
      chat.indexOf("suspend fun loadOlder()"),
      chat.indexOf("suspend fun loadOlder()") + 1900,
    );
    check(
      "r33-17: media reply card — quoteKind / quoteText name a photo / video / voice / document (caption kept), QuoteThumb draws the photo (photoUrlOf), the video's cached frame or a mic / file glyph at 34 dp and nothing for a view-once; the composer bar and the bubble quote both carry it beside a 34 dp stripe",
      chat.includes("internal fun quoteKind(m: JSONObject): String {") &&
        chat.includes("internal fun quoteText(m: JSONObject): String {") &&
        chat.includes("internal fun photoUrlOf(m: JSONObject): String? =") &&
        thumb.includes("if (kind.isBlank() || isViewOnce(m)) return") &&
        thumb.includes('"Photo" -> KpNetImage(photoUrlOf(m), "Photo", Modifier.fillMaxSize())') &&
        thumb.includes("VideoThumbs.get(key) ?: VideoThumbs.readThumb(key)") &&
        thumb.includes("Icons.Filled.Mic") &&
        thumb.includes("Icons.Filled.InsertDriveFile") &&
        thumb.includes("Modifier.size(34.dp).clip(RoundedCornerShape(6.dp))") &&
        bar.includes(
          'val thumbed = !isViewOnce(replyTo) && quoteKind(replyTo).isNotBlank() && quoteKind(replyTo) != "Voice message"',
        ) &&
        bar.includes(
          'else if (quoteKind(replyTo) == "Voice message") "Voice message" else quoteText(replyTo).take(80),',
        ) &&
        bar.includes("if (thumbed) QuoteThumb(replyTo, Ink)") &&
        chat.includes(
          'val thumbed = q != null && !isViewOnce(q) && quoteKind(q).isNotBlank() && quoteKind(q) != "Voice message"',
        ) &&
        chat.includes(
          'else q?.let { qq -> if (quoteKind(qq) == "Voice message") "Voice message" else quoteText(qq).take(48) } ?: "Original message"',
        ) &&
        chat.includes(
          "if (thumbed && q != null) QuoteThumb(q, if (mine) Color(0xE6FFFFFF) else Ink)",
        ),
    );
    check(
      "r33-17: tap the bubble quote → the original: MessageRow.onJumpTo, a no-ripple combinedClickable on the quote (long-press still = the bubble's sheet), jumpTo pages back through history (suspend loadOlder, bounded) until the row is on the list, scrolls to it with head room and flashes the row once; deleted originals are left alone",
      chat.includes("onJumpTo: (String) -> Unit = {},") &&
        (chat.match(/onJumpTo = \{ jumpTo\(it\) \},/g) ?? []).length === 2 &&
        chat.includes("onJumpTo(rid)") &&
        lo.includes("if (!loadingOlder.compareAndSet(false, true)) return") &&
        !lo.includes("scope.launch") &&
        chat.includes("fun jumpTo(id: String) {") &&
        chat.includes('if (msgs.any { it.optString("id") == id }) break') &&
        chat.includes("listState.animateScrollToItem(i, -jumpPad)") &&
        chat.includes('var flashId by remember { mutableStateOf("") }') &&
        chat.includes(
          'val flashing = flashId.isNotBlank() && albumPhotos(m).any { it.optString("id") == flashId }',
        ) &&
        chat.includes("if (idx <= 2 && scrolling) loadOlder()"),
    );
  }
  // Item 19: a video send shows its upload progress (photo-style ring with
  // the percentage), and the video bubble carries the time + ticks; a sent
  // clip's local copy is kept as its cache entry.
  {
    const chat = kt("ChatScreen.kt");
    const cache = kt("Cache.kt");
    const vid = chat.slice(
      chat.indexOf("private fun VideoMessageRow("),
      chat.indexOf("private fun ViewOnceRow("),
    );
    check(
      "r33-19: video bubble — VideoMessageRow takes pendingEcho + otherReadAt, reads UploadProgress for its clientId, decodes the pending frame from the local copy (docPath), swaps the play circle for a determinate ring + percentage while sending (indeterminate during the POST), ignores taps on the echo, and draws a scrim with the time and TickIcon (sending / sent / delivered / seen) like a photo; the duration moves to the top-start corner",
      // v163: the row also hands the ✕ (cancel send) down.
      chat.includes(
        "VideoMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onReply, onLongPress, onOpenVideo, theme, onCancelSend)",
      ) &&
        vid.includes(
          "    pendingEcho: Boolean,\n    otherReadAt: String?,\n    selectedIds: List<String>,",
        ) &&
        vid.includes('val upFrac = UploadProgress.fracs[m.optString("clientId")]') &&
        vid.includes(
          'm.optString("docPath").takeIf { it.isNotBlank() }?.let { File(it) }?.takeIf { it.exists() } ?: dest',
        ) &&
        vid.includes("if (!source.exists()) return@produceState") &&
        vid.includes("r.setDataSource(source.absolutePath)") &&
        vid.includes("if (pendingEcho) return@combinedClickable") &&
        vid.includes("progress = { upFrac },") &&
        // v163 (owner): the percentage text is gone — the ring's middle is
        // the ✕, and tapping it cancels the send.
        vid.includes(
          '.clickable { onCancelSend(m.optString("clientId").ifBlank { m.optString("id") }) },',
        ) &&
        vid.includes(
          'Icon(Icons.Filled.Close, "Cancel send", tint = Color.White, modifier = Modifier.size(16.dp))',
        ) &&
        !vid.includes('Text("${(upFrac * 100).toInt()}%", color = Color.White, fontSize = 10.sp') &&
        vid.includes("TickIcon(m, pendingEcho, otherReadAt)") &&
        vid.includes('msgStamp(m.optString("createdAt")),') &&
        vid.includes("listOf(Color.Transparent, Color.Transparent, Color(0x73000000)),") &&
        vid.includes(".align(Alignment.TopStart)") &&
        vid.includes(
          'Icon(Icons.Filled.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(26.dp))',
        ),
    );
    check(
      "r33-19: a sent clip's local copy becomes its cache entry — Outbox.keepVideoCopy (video/, not a document) copies the temp file to videoCacheFileFor(fileKey) BEFORE the temp delete on both send paths; the queue keeps the application context from init",
      chat.includes(
        "internal fun videoCacheFileFor(ctx: android.content.Context, fileKey: String): java.io.File =",
      ) &&
        cache.includes("private fun keepVideoCopy(body: JSONObject, local: JSONObject?) {") &&
        cache.includes('if (!body.optString("fileType").startsWith("video/")) return') &&
        cache.includes('if (body.optJSONObject("meta")?.optBoolean("document") == true) return') &&
        cache.includes("val dst = videoCacheFileFor(ctx, key)") &&
        cache.includes(
          'keepVideoCopy(ready, local)\n                    local?.optString("path")?.takeIf { it.isNotBlank() && local.optBoolean("temp") }?.let { File(it).delete() }',
        ) &&
        cache.includes(
          'keepVideoCopy(body, local)\n                    local?.optString("path")?.takeIf { it.isNotBlank() && local.optBoolean("temp") }?.let { File(it).delete() }',
        ) &&
        cache.includes("appCtx = ctx.applicationContext"),
    );
  }
  // Item 20: shared media includes videos — the worker's gallery lists them
  // (their own array, never as docs), the Media tab grid mixes them with the
  // photos, and the profile strip shows them; each video tile = play glyph.
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const tab = kt("ChatMediaScreen.kt");
    const prof = kt("ProfileScreen.kt");
    check(
      "r33-20: worker — GET /api/conversations/:id/media returns { images, videos, docs, links }; a video FILE that is not a document goes to videos (not docs); view-once rows stay out",
      src.includes("const videos: ReturnType<typeof msgFrom>[] = [];") &&
        src.includes(
          'String(m.fileType || "").startsWith("video/") &&\n        m.meta?.document !== true\n      )\n        videos.push(m);',
        ) &&
        src.includes("return json({ images, videos, docs, links });") &&
        !src.includes("return json({ images, docs, links });"),
    );
    check(
      "r33-20: app — the Media tab grid is photos + videos newest-first (video tile = VideoTile with the cached frame + play circle, tap → the app's player), and the friend profile's shared-media grid (r34-11: vertical, all of it) includes videos (VideoTile, view-once / documents excluded)",
      tab.includes('videos = data.arr("videos").objects()') &&
        tab.includes('(images + videos).sortedByDescending { it.optString("createdAt") }') &&
        tab.includes('items(grid, key = { it.optString("id") }) { m ->') &&
        tab.includes("internal fun VideoTile(m: JSONObject, playSize: Int = 30) {") &&
        tab.includes("VideoThumbs.get(key) ?: VideoThumbs.readThumb(key)") &&
        tab.includes(
          'Icon(Icons.Filled.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(playSize.dp))',
        ) &&
        tab.includes(
          'if (isVideo) nav.navigate("videoplayer/${mediaArg(JSONObject(m.toString()).put("kpTitle", "Video").put("kpPrivate", privateChat))}")\n                                        else viewer = m',
        ) &&
        prof.includes('(k == "FILE" && fileLooksVideo(m))') &&
        prof.includes("!isViewOnce(m) && !sentAsDocument(m) && (") &&
        prof.includes("if (isVideo) VideoTile(m, playSize = 22)") &&
        prof.includes('else KpNetImage(url, "Shared photo", Modifier.fillMaxSize())'),
    );
  }
  {
    const prof11 = kt("ProfileScreen.kt");
    check(
      "r34-11: friend profile media is a vertical 3-column grid of everything (no sideways strip, no 9-cap)",
      prof11.includes("LazyVerticalGrid(") &&
        prof11.includes("columns = GridCells.Fixed(3),") &&
        prof11.includes(".aspectRatio(1f)") &&
        !prof11.includes("LazyRow(") &&
        !prof11.includes("takeLast(9)"),
    );
  }
  {
    const chat12 = kt("ChatScreen.kt");
    check(
      "r34-12: a chat-search hit rides the quote-tap jump — jumpTo is defined above the search sheet, onPick calls it, the raw-msgs-index scroll is gone",
      chat12.indexOf("fun jumpTo(id: String) {") < chat12.indexOf("ChatSearchSheet(") &&
        chat12.includes("showChatSearch = false\n                        jumpTo(id)") &&
        !chat12.includes('val i = msgs.indexOfFirst { it.optString("id") == id }'),
    );
  }
  {
    const chat14 = kt("ChatScreen.kt");
    check(
      "r34-14: press-hold on a document reaches the action sheet — the doc row is a combinedClickable forwarding long-press (sheet / selection), select-mode taps toggle",
      chat14.includes("if (selecting) onToggleSelect(m) else onLongPress(m)") &&
        chat14.includes("onClick = {\n                        if (selecting && !pendingEcho) {") &&
        chat14.includes("selecting: Boolean = false,") &&
        chat14.includes(
          "theme, onOpenDoc, onToggleSelect, onLongPress, selecting = selectedIds.isNotEmpty(), onCancelSend = onCancelSend, fxGrow = fxFresh)",
        ),
    );
  }
  {
    const chat15 = kt("ChatScreen.kt");
    check(
      "r34-15: a block swaps the whole composer for one thin wall row (blocked side, unspent only: Request Unblock + red Delete side by side; spent: only the unavailable line), no call buttons on the wall",
      chat15.includes("if (blockWall) {") &&
        chat15.includes('"This User Is Unavailable"') &&
        chat15.includes("if (blockedMe && !unblockAsked && !askedSent) {") &&
        chat15.includes('Api.post("/api/blocks/request"') &&
        chat15.includes("!botChat && !requestOpen && !blockWall"),
    );
  }
  {
    const chat15b = kt("ChatScreen.kt");
    check(
      "r34-15: the UNBLOCK_ASK card renders in-thread — blocker gets Unblock / Ignore (DELETE /api/blocks + POST ignore), requester a muted line, answered cards vanish instead of tombstoning",
      chat15b.includes('if (kind == "UNBLOCK_ASK") {') &&
        chat15b.includes("UnblockAskCard(m, mine, askName, onUnblockAsk, onIgnoreAsk)") &&
        chat15b.includes('Api.delete("/api/blocks/${msg.optString("senderId")}")') &&
        chat15b.includes('Api.post("/api/blocks/request/ignore"') &&
        chat15b.includes('msgs[idxExisting].optString("kind") == "UNBLOCK_ASK"') &&
        chat15b.includes('"Unblock requested"'),
    );
  }
  // r36-1: the attach panel's ① toggle is gone (it sat next to Edit) —
  // once rides per item, armed in the editor; the editor opens unarmed.
  {
    const attach1 = kt("AttachSheet.kt");
    const chat1 = kt("ChatScreen.kt");
    const edit1 = kt("MediaEditScreen.kt");
    check(
      "r36-1: no ① toggle in the attach panel (no viewOnce params, no attachOnce state); staged items carry once from the editor; lone edits open unarmed",
      !attach1.includes("onViewOnce") &&
        !attach1.includes("viewOnce: Boolean") &&
        !chat1.includes("attachOnce") &&
        (edit1.match(/, once = onceShot\)/g) || []).length === 4 &&
        chat1.includes('nav.navigate("mediaedit/$convId/0/${statusPickArg(item)}")'),
    );
  }
  // r36-2 (retired by r39-6): press-hold multi-select left with the
  // preview stage — MediaCell is a plain tap cell again, every tap ticks.
  {
    const attach2 = kt("AttachSheet.kt");
    check(
      "r36-2 (retired): no onLongPress anywhere in the attach sheet — MediaCell is a plain clickable tap cell, taps tick/untick in place",
      !attach2.includes("onLongPress") &&
        attach2.includes("val press = Modifier.clickable(onClick = onToggle)") &&
        attach2.includes("if (pos >= 0) sel.removeAll { it.uri == item.uri }"),
    );
  }
  // r36-3: emoji / text overlays get an undo of their own — one snapshot
  // per gesture / add / remove; the pen's stroke-undo keeps priority and its
  // verbatim shape. (Resize + drag already ride the round-35 gesture loop.)
  {
    const edit3 = kt("MediaEditScreen.kt");
    check(
      "r36-3: overlay undo — snapshot history (push on add / gesture-start / delete, cap 50), undo pops strokes first then overlays; v169 retired the trash seat (undo covers it); the selection is a sharp rectangle, not a ring",
      edit3.includes(
        "val overlayPast = remember { mutableStateListOf<Pair<List<EditText>, List<EditSticker>>>() }",
      ) &&
        edit3.includes("fun pushOverlayPast()") &&
        edit3.includes("fun undoOverlay()") &&
        edit3.includes("removeLastOrNull()") &&
        (edit3.match(/pushOverlayPast\(\)/g) || []).length === 7 &&
        edit3.includes(
          "native.drawRect(cx - sel.rx * w, cy - sel.ry * h, cx + sel.rx * w, cy + sel.ry * h, ring)",
        ) &&
        !edit3.includes("val reach = ") &&
        // v165 (owner: undo/redo in all editors): the top bar asks undoEdit(),
        // which pops the last stroke and otherwise walks the overlay history —
        // and REDO replays whatever undo took.
        edit3.includes("val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()") &&
        edit3.includes("val canRedo = redoStack.isNotEmpty()") &&
        // v166 (owner: "undo redo option pelam e na"): the trio is part of the
        // chrome — drawn whenever there is media on the stage, each control
        // dimmed while it has nothing to act on.
        edit3.includes("if (shot != null || clip != null) {") &&
        edit3.includes("haptics.tap(); undoEdit()") &&
        edit3.includes("haptics.tap(); redoEdit()") &&
        edit3.includes(
          "val st = strokes.removeAt(strokes.size - 1)\n            live = null\n            redoStack.add { strokes.add(st) }",
        ),
    );
  }
  // r37-4: the installer-confirm failure. A commit whose status lands in
  // a backgrounded/reclaimed process used to vanish — no toast, no error,
  // update just never happened. Now the commit + every terminal status
  // persist to prefs, failures toast LOUDLY, and the next launch explains
  // itself; Install/Update are single-flight.
  check(
    "r37-4: the update commit records an inflight flag, the receiver persists every terminal status + toasts failures, and cold start surfaces an unreported install as downloadError; Install is disabled mid-flight",
    upd.includes("fun noteCommitted(ctx: Context)") &&
      upd.includes('putBoolean("inflight", true)') &&
      upd.includes("fun noteStatus(ctx: Context, code: Int, msg: String?)") &&
      upd.includes("fun consumeInstallResult(ctx: Context): String?") &&
      upd.includes("noteCommitted(ctx)") &&
      rx.includes("update_rx_failed:$code") &&
      rx.includes("Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_LONG).show()") &&
      rx.includes('?: "Install failed ($code)"') &&
      upd.includes("if (installing) return") &&
      upd.includes("if (downloading) return") &&
      upd.includes("installing = true") &&
      kt("KpApp.kt").includes("Confirm the install in the system window.") &&
      kt("MainActivity.kt").includes("KpUpdate.consumeInstallResult(application)") &&
      // Owner round 42 (item 1): the install no longer kills the app; the
      // sheet offers a restart into the new build instead.
      upd.includes("if (android.os.Build.VERSION.SDK_INT >= 34) params.setDontKillApp(true)") &&
      upd.includes("var justUpdated by mutableStateOf(false)") &&
      upd.includes("fun restart(ctx: Context)") &&
      kt("KpApp.kt").includes('GoldBtn("Restart", Modifier.fillMaxWidth())'),
  );
  // r37-5: the reference block wall — the blocker sees ONLY a compact
  // Unblock pill (thin strip, no unavailable line); the blocked side keeps
  // the unavailable line + the one slim Request pill, spent once per block.
  {
    const chatW = kt("ChatScreen.kt");
    const wall = chatW.slice(
      chatW.indexOf("if (blockWall) {"),
      chatW.indexOf("} else if (requestPending) {"),
    );
    check(
      "r37-5: the block wall shows the blocker only a compact Unblock pill (DELETE /api/blocks + meta refresh lifts the wall) and the blocked side the unavailable line + the one slim Request pill",
      wall.includes("if (blockedByMe) {") &&
        wall.includes('else "Unblock"') &&
        wall.includes('Api.delete("/api/blocks/$otherUserId")') &&
        wall.includes("refreshMeta()") &&
        wall.includes("if (blockedMe && !unblockAsked && !askedSent) {") &&
        wall.indexOf('"Unblock"') < wall.indexOf('"This User Is Unavailable"'),
    );
  }
  // r37-fix (CI compile): local gates cannot compile Kotlin, so the
  // declaration order the compiler demands is pinned — exitCrop before its
  // callers, sendStatus before send(), no stray annotations in the kit.
  {
    const editF = kt("MediaEditScreen.kt");
    const kitF = kt("CropTrimKit.kt");
    check(
      "r37-fix: exitCrop is declared before rotateTap + the crop BackHandler, sendStatus before send(), and the trim kit keeps its PlayArrow import with no doubled @Composable",
      editF.indexOf("fun exitCrop() {") < editF.indexOf("fun rotateTap() {") &&
        editF.indexOf("fun exitCrop() {") < editF.indexOf("BackHandler(enabled = cropping)") &&
        editF.indexOf("fun sendStatus() {") < editF.indexOf("fun send() {") &&
        kitF.includes("import androidx.compose.material.icons.filled.PlayArrow") &&
        !kitF.includes("@Composable\n/** The clip loops"),
    );
  }
  // r38-1: the wall is ONE thin row — the unavailable line and the
  // buttons never stack. Blocked side (request unspent): Request Unblock
  // + red Delete chat side by side; blocker: Unblock + red Delete; once
  // the request is spent only the thin unavailable line remains.
  {
    const chatW38 = kt("ChatScreen.kt");
    const wall38 = chatW38.slice(
      chatW38.indexOf("if (blockWall) {"),
      chatW38.indexOf("} else if (requestPending) {"),
    );
    check(
      "r38-1: the block wall is one thin row — way-back + red Delete chat pills side by side (Request Unblock while unspent, Unblock for the blocker), spent walls show only the unavailable line; Delete drops the chat and backs out",
      wall38.includes("Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)") &&
        wall38.includes("fun wallPill(") &&
        wall38.includes("else if (red) Red else ActionBlue") &&
        wall38.includes('"Delete chat"') &&
        wall38.includes("fun deleteWallChat()") &&
        wall38.includes('Api.delete("/api/conversations/$convId")') &&
        wall38.includes("ScreenStore.dropConv(convId)") &&
        wall38.includes("nav.popBackStack()") &&
        wall38.indexOf('"Delete chat"') < wall38.indexOf('"This User Is Unavailable"'),
    );
  }
  // r38-2: editor chrome trims — the ① toggle loses its ring and grows
  // to fill the seat, the HD pill loses its border, the caption bar loses
  // its add-photo button (multi-select moved to the panel checkbox).
  {
    const edit38 = kt("MediaEditScreen.kt");
    check(
      "r38-2: the editor ① is borderless at 28.dp (r40-4: centered + 0.85 layout scale, geometry verbatim), the HD pill has no border, and the caption bar carries no add-photo button",
      edit38.includes("CenteredOnceIcon(28.dp") &&
        kt("ViewOnceIcon.kt").includes(
          "internal fun CenteredOnceIcon(iconSize: Dp, tint: Color = Color.White) {",
        ) &&
        kt("ViewOnceIcon.kt").includes("scaleX = 0.85f") &&
        kt("ViewOnceIcon.kt").includes("translationX = px * 0.0799f") &&
        !edit38.includes("if (once) ActionBlue else Color(0x66FFFFFF), CircleShape") &&
        !edit38.includes(".border(1.5.dp, Color.White, RoundedCornerShape(7.dp))") &&
        !edit38.includes("Icons.Filled.AddPhotoAlternate"),
    );
  }
  // Owner round 39 (item 6): the r38-3 preview stage is deleted — no
  // pager, no preview cache/decodes, no checkbox. The pencil on a MULTI
  // batch keeps the batch: Done stages the edited photo back into the
  // original's seat (replaceUri rides the AddMore); a lone pick sends.
  {
    const attach38 = kt("AttachSheet.kt");
    const edit39 = kt("MediaEditScreen.kt");
    const chat39b = kt("ChatScreen.kt");
    const store39 = kt("ScreenStore.kt");
    check(
      "r39-6: preview stage fully deleted (no PreviewPane/Page/Cache, no pager imports, no preview decodes, no checkbox icons); the pencil stages back into multi batches via replaceUri",
      !attach38.includes("PreviewPane") &&
        !attach38.includes("PreviewPage") &&
        !attach38.includes("PreviewCache") &&
        !attach38.includes("HorizontalPager") &&
        !attach38.includes("rememberPagerState") &&
        !attach38.includes("decodePreview") &&
        !attach38.includes("previewBitmap") &&
        !attach38.includes("previewFrame") &&
        !attach38.includes("CheckCircle") &&
        !attach38.includes("RadioButtonUnchecked") &&
        store39.includes("var editStageUri: String? = null") &&
        edit39.includes('fun addMore(replaceUri: String = "") {') &&
        edit39.includes(
          "ScreenStore.pendingAddMore.value = AddMore(convId, item, onceShot, replaceUri)",
        ) &&
        edit39.includes("addMore(stageUri)") &&
        chat39b.includes(
          "if (attachSel.size > 1) ScreenStore.editStageUri = item.uri.toString()",
        ) &&
        chat39b.includes(
          "val at = attachSel.indexOfFirst { it.uri.toString() == more.replaceUri }",
        ) &&
        chat39b.includes("if (at >= 0) attachSel[at] = more.item else attachSel.add(0, more.item)"),
    );
  }
  // r38-4: own unsends aborted the dust ~200ms in — the live DELETED
  // frame filtered the row out of visibleMsgs, disposing the shell mid-show.
  // A vanishing row now stays rendered until its own onGone lands.
  check(
    "r38-4: the tombstone filter keeps rows mid-vanish — a DELETED row whose id is in vanishingIds stays in visibleMsgs until onGone drops the mark",
    kt("ChatScreen.kt").includes(
      '(m.optString("kind") != "DELETED" || albumPhotos(m).any { it.optString("id") in vanishingIds }) && run {',
    ),
  );
  // Owner round 39 (item 3): r38-4 kept the row rendered, but the socket /
  // poll tombstone swap still flipped contentType (TEXT→DELETED), so
  // LazyColumn disposed the shell and the dust aborted ~200ms in. A
  // tombstone never replaces a live row now — the original dusts out.
  {
    const chat39 = kt("ChatScreen.kt");
    check(
      "r39-3: DELETED frames never swap a live row — the socket branch starts peer vanish on the original, paintFromStore drops vanishing tombstones + starts fresh ones, onGone removes the dusted originals",
      chat39.includes('idxExisting >= 0 && liveMsg.optString("kind") == "DELETED" -> {') &&
        chat39.includes("val freshTombs =") &&
        chat39.includes(
          'next = next.filter { it.optString("kind") != "DELETED" || it.optString("id") !in vanishingIds }',
        ) &&
        chat39.includes('msgs.removeAll { it.optString("id") in gone }'),
    );
    // Owner round 39 (item 4): the live-append follow-scroll used to fight
    // the AI typewriter's per-tick pinning — the thread flickered on every
    // AI reply. Bot TEXT arrivals in the AI chat skip it now.
    check(
      "r39-4: AI text replies skip the live-append follow-scroll (the word-by-word reveal owns the viewport pinning)",
      chat39.includes('!(convId.endsWith("_kp_ai_bot") &&') &&
        chat39.includes('liveMsg.optString("senderId") == "kp_ai_bot" &&') &&
        chat39.includes('liveMsg.optString("kind") == "TEXT")'),
    );
    // Owner round 39 (item 8): opening the AI chat re-fires the welcome
    // (idempotent server-side) so old/reset accounts greet instead of an
    // empty thread.
    check(
      "r39-8: the AI chat re-fires /api/ai/welcome on open (server-guarded once-per-account)",
      chat39.includes('if (convId.endsWith("_kp_ai_bot")) {') &&
        chat39.includes('Api.post("/api/ai/welcome", JSONObject())'),
    );
  }
  // r37-3: reference-style overlay handles — per-overlay rotation,
  // × top-left deletes, top-right drags the turn, bottom-right drags
  // the size; the box + its handles turn with the overlay, taps un-turn
  // into its frame, the picture turn carries overlay turns too.
  {
    const editH = kt("MediaEditScreen.kt");
    check(
      "r37-3: overlays turn — rotation on text + sticker, ×/rotate/resize corner handles with true pixel-space maths, handle drags for turn + size, taps un-turn into the overlay frame, rotate carries overlay turns, preview + bake share the turned draws",
      (editH.match(/val rotation: Float = 0f/g) || []).length === 2 &&
        editH.includes("fun rotateOverlay(id: String, delta: Float)") &&
        editH.includes("t.copy(rotation = (t.rotation + delta) % 360f)") &&
        editH.includes(
          "private fun handlePos(sel: EditSel, sx: Float, sy: Float, w: Float, h: Float): Offset {",
        ) &&
        editH.includes("handlePos(sel, -1f, -1f, w, h)") &&
        editH.includes("handlePos(sel, 1f, -1f, w, h)") &&
        editH.includes("handlePos(sel, 1f, 1f, w, h)") &&
        editH.includes("fun hitOverlay(x: Float, y: Float, w: Float, h: Float): String? {") &&
        editH.includes("inOverlay(x, y, s.center, r, r, s.rotation, w, h)") &&
        editH.includes("rotation = (t.rotation + 90f) % 360f") &&
        editH.includes("rotation = (s.rotation + 90f) % 360f") &&
        editH.includes("native.rotate(t.rotation, t.center.x * w, t.center.y * h)") &&
        editH.includes("native.rotate(s.rotation, s.center.x * w, s.center.y * h)") &&
        editH.includes("native.rotate(sel.rot, cx, cy)") &&
        editH.includes(
          "native.drawArc(rx - 13f, ty - 13f, rx + 13f, ty + 13f, 300f, 300f, false, glyph)",
        ) &&
        editH.includes("native.drawLine(rx - 10f, by - 10f, rx + 10f, by + 10f, glyph)") &&
        editH.includes("var grabHandle = 0") &&
        editH.includes("if (mode == 3 || mode == 4) {") &&
        editH.includes("rotateOverlay(sel.id, Math.toDegrees(dd.toDouble()).toFloat())") &&
        editH.includes("if (grabDist > 1f && d > 1f) scaleOverlay(sel.id, d / grabDist)"),
    );
  }
  // r36-4: the ① mark redrawn — one clean ring + a centered "1" that
  // reads at every size (the clipped SVG arc + dotted gap + 6sp digit
  // rendered as mush at 20.dp). Shared by the bubble and the editor.
  {
    const icon4 = kt("ViewOnceIcon.kt");
    check(
      "r37-1: ViewOnceOneIcon is the owner's SVG exactly — 260.2° arc centered (40, 50), the 5 dotted-gap triples, the bold 1 drawn at x 38 / baseline 62; the round-36 plain ring is gone",
      icon4.includes("startAngle = 49.9f,") &&
        icon4.includes("sweepAngle = 260.2f,") &&
        icon4.includes("topLeft = Offset(8f * u, 18f * u),") &&
        icon4.includes("69f, 36.5f, 3.6f,") &&
        icon4.includes("69f, 63.5f, 3.6f,") &&
        icon4.includes("textSize = 32f * u") &&
        !icon4.includes("d * 0.09f") &&
        !icon4.includes("0.52f).sp"),
    );
  }
  // r36-5: an unsent row settles INTO its tombstone when the dust ends
  // (same id, kind flipped mid-show) instead of sticking dead — the
  // tombstone stands and rises once. Gone-rows still go dead.
  {
    const del5 = kt("DeleteAnim.kt");
    check(
      "r36-5: DeleteRowShell settles into DELETED tombstones after the show (clears shot, latches a rise, releases the ids) and only goes dead for rows that truly leave",
      del5.includes('if (m.optString("kind") == "DELETED") {') &&
        del5.includes("shot = null") &&
        del5.includes("settled = true") &&
        del5.includes(".riseIn(born || settled)") &&
        del5.includes("dead = true") &&
        del5.includes("onGone()"),
    );
  }
  // r36-8: the "This device" badge shrinks again (7.sp whisper).
  {
    const ss8 = kt("SettingsScreen.kt");
    check(
      "r36-8: This-device badge at 7.sp with a tighter seat; no 8.sp badge remains",
      ss8.includes('"This device",') &&
        ss8.includes("fontSize = 7.sp,") &&
        ss8.includes(".padding(horizontal = 3.dp),") &&
        !ss8.includes("fontSize = 8.sp,"),
    );
  }
  // r36-6: video gets the photo toolset — pen / text / sticker bake
  // into one overlay at the export's output size, the filter rides the
  // video shader, user turns join the rotation mapping; the stage shares
  // one pen+overlay canvas, and turns / filters freeze the clip into a
  // WYSIWYG still (a TextureView takes no ColorFilter).
  {
    const edit6 = kt("MediaEditScreen.kt");
    const vx6 = kt("VideoExport.kt");
    check(
      "r36-6: video edits — export takes overlay + colorMat + userTurns, the shader tints + blends the overlay, the editor shares one StageCanvas, still-mode previews turns/filters, all four video exits (chat send / add-more / save + status post) carry the layers",
      vx6.includes("overlay: Bitmap? = null,") &&
        vx6.includes("colorMat: FloatArray? = null,") &&
        vx6.includes("userTurns: Int = 0,") &&
        vx6.includes("uniform mat4 uColorMat;") &&
        vx6.includes("uniform vec4 uColorOff;") &&
        vx6.includes("OVERLAY_FRAGMENT_SHADER") &&
        vx6.includes("GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, overlay, 0)") &&
        vx6.includes(
          "private fun colorUniforms(mat: FloatArray?): Pair<FloatArray, FloatArray> {",
        ) &&
        // v169: the video stage hands clean taps to onStageTap.
        edit6.includes("fun StageCanvas(onStageTap: () -> Unit = {}) {") &&
        edit6.includes("StageCanvas(onStageTap = {") &&
        (edit6.match(/StageCanvas\(\)/g) || []).length === 1 &&
        // v170: the WYSIWYG still is gone - turns / filter / crop ride the LIVE player.
        edit6.includes("turn = rotation,") &&
        edit6.includes("colorMat = filterMatrix?.array,") &&
        edit6.includes("crop = if (cropping) null else cropBox,") &&
        edit6.includes("internal fun bakeVideoOverlay(") &&
        edit6.includes("internal fun grabVideoFrame(") &&
        edit6.includes("internal fun paintPenStrokes(") &&
        edit6.includes("paintPenStrokes(canvas, strokes, w, h)") &&
        (
          edit6.match(
            // v164: all three out-bakes (send / add-more / save) read the
            // working media, so an APPLIED clip is what leaves the editor.
            /VideoExport\.export\(ctx, mediaUri, s, e, box, out, overlay = overlay, colorMat = filt\?\.array, userTurns = turn\)/g,
          ) || []
        ).length === 3 &&
        (edit6.match(/if \(hasEdits\) throw err/g) || []).length === 4,
    );
  }
  // r36-7: the status share screen gets the full editor — an Edit
  // button opens it in status mode (no caption / once / add-more / HD,
  // Done check instead of Send); results return through their own flow
  // and swap the working media, crop reset, edited clips kept whole.
  // r37-2: one screen for status — the picker lands straight in the editor
  // (no share screen, no Edit tap, no round-trip flow); Done posts from here
  // (bake + upload + refresh); the crop tool (photo + video) opens the box
  // over the full frame and commits on exit — photo overlays hop boxes,
  // video overlays remap at bake time; every send path carries the box.
  {
    const edit7 = kt("MediaEditScreen.kt");
    const store7 = kt("ScreenStore.kt");
    const app7 = kt("KpApp.kt");
    const pick7 = kt("StatusPickScreen.kt");
    const kit7 = kt("CropTrimKit.kt");
    check(
      "r37-2: status is one screen — the picker opens the editor in status mode, Done posts (bake + upload + refresh), the crop tool commits the box on exit with photo overlays hopping boxes and video overlays remapping at bake, every send path carries the box, the share screen + round-trip are gone",
      pick7.includes('ScreenStore.editTitle = "Status"') &&
        pick7.includes('nav.navigate("mediaedit/status/0/" + statusPickArg(item)) {') &&
        edit7.includes("if (statusMode) {") &&
        edit7.includes("sendStatus()") &&
        edit7.includes("fun sendStatus() {") &&
        edit7.includes('"Sharing status…"') &&
        edit7.includes('.put("kind", "VIDEO")') &&
        edit7.includes('.put("kind", "IMAGE").put("imageData", data)') &&
        edit7.includes('ScreenStore.setStatuses(data.arr("items").objects())') &&
        edit7.includes("val (s, e) = VideoPlan.defaultWindow(src.durationMs)") &&
        edit7.includes("if (cropping) exitCrop() else enterCrop()") &&
        edit7.includes("fun remapOverlaysForCrop(from: CropBox?, to: CropBox?)") &&
        edit7.includes("if (shotFull != null) remapOverlaysForCrop(cropBox, null)") &&
        edit7.includes("if (shotFull != null) remapOverlaysForCrop(null, draft)") &&
        edit7.includes("box = cropDraft,") &&
        edit7.includes("val stageShot = if (cropping) shotFull else shot") &&
        edit7.includes("h: Int, box: CropBox? = null") &&
        edit7.includes("canvas.scale(1f / b.w, 1f / b.h)") &&
        // v164: +1 in applyEdits (Done bakes the box) and +1 in useAsAvatar.
        // v171: the background clip bake carries the box too.
        (edit7.match(/\|\| box != null/g) || []).length === 9 &&
        (edit7.match(/, box, (out|cut),/g) || []).length === 5 &&
        !store7.includes("pendingStatusEdited") &&
        !edit7.includes("pendingStatusEdited") &&
        !app7.includes("statusphoto/") &&
        !kit7.includes("fun StatusPhotoScreen("),
    );
  }
  // r35-8: the editor grows up — overlays carry a pinch size (preview AND
  // bake share the scaled draw fns), one gesture loop owns select / move /
  // pinch / ×-delete, the photo owns the whole screen with floating tiny
  // chrome on scrims, the send is a small blue dot, the once toggle sits in
  // a borderless seat that fills blue while armed.
  {
    const edit = kt("MediaEditScreen.kt");
    check(
      "r35-8: overlays carry scale (pinch 0.4–4, geometry + preview + bake all ride it), one select/move/pinch/× loop, full-bleed stage, floating tiny chrome on scrims, small blue send, borderless once toggle",
      (edit.match(/val scale: Float = 1f/g) || []).length === 2 &&
        edit.includes("fun scaleOverlay(id: String, factor: Float)") &&
        edit.includes("coerceIn(0.4f, 4f)") &&
        edit.includes("scaleOverlay(target, dist / prevDist)") &&
        edit.includes("w * 0.06f * t.scale") &&
        edit.includes("w * 0.11f * s.scale") &&
        edit.includes("0.075f * s.scale") &&
        edit.includes("DEL_MARK_HIT") &&
        edit.includes(".graphicsLayer {\n                        scaleX = stageZoom") &&
        edit.includes("Brush.verticalGradient") &&
        edit.includes(".align(Alignment.TopCenter)") &&
        edit.includes(".align(Alignment.BottomCenter)") &&
        // v169: the rail seats stay 40 dp StageHistory; undo / redo are plain
        // 32 dp IconButtons in the top bar centre (mic keeps its 32 dp) and
        // the paused-only play glyph is a 32 dp icon in a 56 dp seat; the 26
        // dp pair (attach checkbox + pen chips) and the one 36 dp close
        // survive.
        (edit.match(/\.size\(32\.dp\)/g) || []).length === 4 &&
        (edit.match(/\.size\(36\.dp\)/g) || []).length === 1 &&
        (edit.match(/\.size\(26\.dp\)/g) || []).length === 2 &&
        // v167: undo / redo float on the stage as two 40 dp seats (the pair the
        // owner marked), so the 40 dp count is the select circle + those two.
        (edit.match(/\.size\(40\.dp\)/g) || []).length === 2 &&
        edit.includes(
          "fun StageHistory(can: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit)",
        ) &&
        edit.includes(".background(ActionBlue)") &&
        !edit.includes(".border(1.dp, if (once) ActionBlue") &&
        edit.includes('Text("Aa", color = Color.White, fontSize = 15.sp') &&
        !edit.includes("size(52.dp)") &&
        !edit.includes("Box(Modifier.fillMaxWidth().weight(1f)"),
    );
  }
  {
    const chat7 = kt("ChatScreen.kt");
    check(
      "r35-7: block / unblock / request buttons are compact pills — one shared wall-pill seat 13.sp on (14, 6) padding, Accept / Block 13.sp halves on 7.dp vertical, Ignore / card-Unblock 12.5.sp on (14, 6); no fat paddings remain",
      chat7.includes('if (asking) "Sending…" else "Request Unblock",') &&
        chat7.includes(
          "fontSize = 13.sp,\n                        fontWeight = FontWeight.SemiBold,\n                        maxLines = 1,",
        ) &&
        (chat7.match(/\.padding\(horizontal = 14\.dp, vertical = 6\.dp\)/g) || []).length === 6 &&
        (chat7.match(/\.padding\(vertical = 7\.dp\)/g) || []).length === 2 &&
        chat7.includes(
          '{ Text("Ignore", color = Muted, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }',
        ) &&
        chat7.includes(
          '{ Text("Unblock", color = ActionBlueInk, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }',
        ) &&
        !chat7.includes(".padding(horizontal = 22.dp, vertical = 11.dp)") &&
        !chat7.includes(".padding(horizontal = 20.dp, vertical = 9.dp)") &&
        !chat7.includes(".padding(vertical = 12.dp)"),
    );
  }
  {
    const chat15c = kt("ChatScreen.kt");
    check(
      "r34-15: a send refused by the block wall stays silent (no toast over the unavailable line)",
      chat15c.includes('val walled = e.message?.contains("can\'t reach") == true') &&
        chat15c.includes("if (!walled) error = e.message"),
    );
  }
  {
    const cs13 = kt("CallScreens.kt");
    check(
      "r34-13: video calls have no speaker button (voice keeps its route step) — video opens on the speaker, personal outputs win, upgrades flip off the earpiece",
      (cs13.match(/val routeAction = rememberRouteAction\(engine\)/g) || []).length === 1 &&
        !cs13.includes("StripAction(routeAction.icon") &&
        cs13.includes("CallAction(\n                    routeAction.icon,") &&
        kt("AudioRouter.kt").includes(
          'return if (kind == "VIDEO") AudioRoute.SPEAKER else AudioRoute.EARPIECE',
        ) &&
        kt("CallEngine.kt").includes("private fun markVideoRoute() {"),
    );
  }
  // Item 25: status viewers always showed 0 and the viewed-by sheet reloaded on
  // every open. Root causes: ScreenStore.setStatuses keyed its change signature
  // on ids + lengths only (a poll carrying the real counts was discarded, and
  // the persisted 0 survived restarts); the sheet cache was a remember{} map
  // that died with the viewer screen.
  {
    const store = kt("ScreenStore.kt");
    const status = kt("StatusScreens.kt");
    const setStatuses = store.slice(
      store.indexOf("fun setStatuses(list: List<JSONObject>) {"),
      store.indexOf("fun setCalls(list: List<JSONObject>) {"),
    );
    check(
      "r33-25: ScreenStore — the statuses change signature includes the seen flag, the per-status view counts and the author's avatar token / name; a process-wide statusViewers map (mutableStateMapOf, cleared with the account) and statusViewCount() = max(feed count, fetched list size)",
      setStatuses.includes('if (g.optBoolean("allViewed")) 1 else 0,') &&
        setStatuses.includes('g.arr("statuses").objects().sumOf { it.optInt("viewers", 0) },') &&
        setStatuses.includes('u?.optString("avatarRef").orEmpty(),') &&
        store.includes("val statusViewers = mutableStateMapOf<String, List<JSONObject>>()") &&
        store.includes(
          'maxOf(s.optInt("viewers", 0), statusViewers[s.optString("id")]?.size ?: 0)',
        ) &&
        store.includes('statusesRaw = ""\n        statusViewers.clear()'),
    );
    check(
      "r33-25: viewer screen — openViewers paints the cached list at once (loading only on a first-ever load), always refreshes behind it into ScreenStore.statusViewers, an error shows only without a cache; the eye row and the 'My status' row read statusViewCount",
      !status.includes("val viewersCache = remember") &&
        status.includes("val cached = ScreenStore.statusViewers[id]") &&
        status.includes(
          "viewers = cached ?: emptyList()\n        viewersLoading = cached == null",
        ) &&
        status.includes("ScreenStore.statusViewers[id] = list") &&
        status.includes("}.onFailure { if (cached == null) viewersError = true }") &&
        status.includes("val views = ScreenStore.statusViewCount(s)") &&
        status.includes('"$views view${if (views == 1) "" else "s"}",') &&
        status.includes("val views = myStatuses.sumOf { ScreenStore.statusViewCount(it) }") &&
        !status.includes('s.optInt("viewers", 0)'),
    );
  }
  // Item 1: voice bubble — the wave is centred on the play button, and a
  // horizontal drag on the WAVE scrubs the note (the bubble body around it
  // keeps swipe-to-reply).
  {
    const chat = kt("ChatScreen.kt");
    const wave = chat.slice(
      chat.indexOf("internal fun VoiceWave("),
      chat.indexOf("private fun LiveVoiceWave("),
    );
    check(
      "r33-1: VoiceWave claims the horizontal slop on the bars (awaitHorizontalTouchSlopOrCancellation → horizontalDrag), reports the finger's fraction through onScrub while dragging and seeks there on release; a plain tap still seeks; callbacks read through rememberUpdatedState so the progress ticks never restart the gesture",
      chat.includes(
        "import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation",
      ) &&
        chat.includes("import androidx.compose.foundation.gestures.horizontalDrag") &&
        wave.includes("onScrub: ((Float?) -> Unit)? = null,") &&
        wave.includes("val seek by rememberUpdatedState(onSeek)") &&
        wave.includes("val scrub by rememberUpdatedState(onScrub)") &&
        wave.includes("awaitHorizontalTouchSlopOrCancellation(down.id) { change, _ ->") &&
        wave.includes("horizontalDrag(slop.id) { change ->") &&
        wave.includes("scrub?.invoke(null)\n                    seek(last)") &&
        wave.includes("seek((up.position.x / size.width).coerceIn(0f, 1f))") &&
        wave.includes("if (!dragged && up != null && up.changedToUp()) {") &&
        wave.includes(
          "withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {\n                        awaitHorizontalTouchSlopOrCancellation(down.id)",
        ) &&
        wave.includes("modifier.pointerInput(bars) {"),
    );
    check(
      "r33-1: the voice bubble keeps a scrub fraction (painted + time line follow the finger), passes onScrub, and centres the 18dp wave on the 32dp button (top-aligned row, column offset 7dp)",
      chat.includes("var scrubAt by remember(id) { mutableStateOf<Float?>(null) }") &&
        chat.includes("val progress = scrubAt ?: if (active) player.progress else 0f") &&
        chat.includes(
          "onScrub = { frac ->\n                        scrubAt = if (!pendingEcho && fileKey.isNotBlank()) frac else null\n                    },",
        ) &&
        chat.includes("(active || scrubAt != null) && secs > 0 -> {") &&
        chat.includes(
          "Row(verticalAlignment = Alignment.Top) {\n            val interaction = remember { MutableInteractionSource() }",
        ) &&
        chat.includes("Column(Modifier.padding(top = 3.dp)) {\n                VoiceWave(") &&
        chat.includes("modifier = Modifier.width(150.dp).height(22.dp),"),
    );
  }
  // Item 8: the status / chat-video trim strip shows a playhead — the
  // preview reports its position every tick and the strip draws it.
  {
    const edit = kt("MediaEditScreen.kt");
    const kit33 = kt("CropTrimKit.kt");
    const playerCls = kit33.slice(
      kit33.indexOf("private class TrimClipPlayer("),
      kit33.indexOf("internal fun TrimStrip("),
    );
    const stripFn = kit33.slice(
      kit33.indexOf("internal fun TrimStrip("),
      kit33.indexOf("internal fun CropOverlay("),
    );
    check(
      "r33-8: trim playhead — TrimClipPlayer.positionMs() (seek target while in flight, start handle before ready), StatusTrimPreview reports it through onPosition every tick, TrimStrip draws a white outlined playhead inside the window (hidden while a handle is held), and the editor wires playAt through (r34-18: the playhead glides between the 120 ms ticks instead of jumping)",
      playerCls.includes("fun positionMs(): Long {") &&
        playerCls.includes("if (pendingSeek >= 0L) return pendingSeek") &&
        kit33.includes("    onPosition: (Long) -> Unit = {},\n) {") &&
        kit33.includes("positionCb.value(p.positionMs())") &&
        stripFn.includes("positionMs: Long? = null,") &&
        stripFn.includes("if (head != null && mode == 0) {") &&
        stripFn.includes(
          "val px = (headSmooth.toLong().coerceIn(s, e) / total * size.width).coerceIn(sx + hw / 2f, ex - hw / 2f)",
        ) &&
        stripFn.includes("val headSmooth by animateFloatAsState(") &&
        stripFn.includes("targetValue = (positionMs ?: s).toFloat(),") &&
        stripFn.includes("animationSpec = tween(durationMillis = 130, easing = LinearEasing),") &&
        stripFn.includes(
          "drawLine(Color.White, Offset(px, 0f), Offset(px, size.height), strokeWidth = edge)",
        ) &&
        (edit.match(/positionMs = playAt,/g) || []).length === 1 &&
        edit.includes("onPosition = { playAt = it },"),
    );
  }
  // Item 9: the chat-list PICTURE is its own tap target — a live status opens
  // directly, otherwise a small profile sheet (message · voice · video ·
  // profile); the row itself still opens the chat.
  {
    const cl = kt("ChatListScreen.kt");
    const card = cl.slice(
      cl.indexOf("private fun ConvCard("),
      cl.indexOf("private fun ChatRowSheet("),
    );
    const peek = cl.slice(cl.indexOf("private fun ProfilePeekSheet("));
    check(
      "r33-9: ConvCard — the avatar Box has its own combinedClickable (no ripple): swipe arm open → collapse, select mode → tick, a live status → statusview/<user>, otherwise the peek sheet; long-press on the picture still opens the row's select sheet; the row tap still opens the chat",
      card.includes("if (peek) ProfilePeekSheet(conv, nav) { peek = false }") &&
        card.includes("onLongClick = { if (revealed) onCollapse() else longPress() },") &&
        card.includes(
          'statusGroup != null -> {\n                            haptics.tap()\n                            nav.navigate("statusview/${other?.optString("id")}")',
        ) &&
        card.includes(
          "else -> {\n                            haptics.tap()\n                            peek = true",
        ) &&
        card.includes(
          "selecting -> {\n                            haptics.tap()\n                            ListSelect.toggle(id)",
        ) &&
        card.includes('else -> nav.navigate("chat/$id")') &&
        card.includes("val longPress = {") &&
        card.includes("ListSelect.sheetFor = conv"),
    );
    check(
      "r33-9: ProfilePeekSheet — KpSheet (no dialog) with an 84 dp avatar, name + badges, @handle or member count, about (2 lines), and icon-only raised actions Message / Voice call / Video call / Profile-or-Group info; calls hidden for bots and open message requests; a group gets group calls + group/<id>",
      peek.includes("KpSheet(onDismiss = onDismiss) {") &&
        peek.includes("KpAvatar(name, avatarUrl, 84.dp, avatarRef = avatarRef)") &&
        peek.includes("if (!isGroup) UserBadges(other)") &&
        peek.includes(
          'other?.optText("username").orEmpty().let { if (it.isNotBlank()) "@$it" else "" }',
        ) &&
        peek.includes(
          "val callable = isGroup || (otherId.isNotBlank() && !isKpBot(otherId) && !requestOpen)",
        ) &&
        (peek.match(/PeekAction\(/g) || []).length === 5 &&
        peek.includes('nav.navigate("chat/$id")') &&
        peek.includes(
          'else CallEngine.instance?.startCall(otherId, "AUDIO", name, avatarUrl ?: "")',
        ) &&
        peek.includes(
          'if (isGroup) CallEngine.instance?.startGroupCall(id, "VIDEO", name, avatarRef ?: "")',
        ) &&
        peek.includes('nav.navigate(if (isGroup) "group/$id" else "profile/$otherId")') &&
        !peek.includes("KpSheetRow(") &&
        !peek.includes("AlertDialog") &&
        peek.includes(
          "private fun PeekAction(icon: ImageVector, label: String, onClick: () -> Unit) {",
        ),
    );
  }
  // Item 10: status viewer — readable header on every theme / frame, the
  // picture at full strength, and a hold that resumes on release.
  {
    const ss = kt("StatusScreens.kt");
    const viewer = ss.slice(
      ss.indexOf("fun StatusViewerScreen(nav: NavController, whose: String) {"),
      ss.indexOf("private fun StatusVideoPlayer("),
    );
    check(
      "r33-10: no 40% dim over the photo / video; top (150 dp) and bottom (170 dp) gradient scrims behind the header and the reply row; the progress fill is WHITE (Card was navy in dark-blue)",
      !viewer.includes("Box(Modifier.fillMaxSize().background(Color(0x66000000)))") &&
        viewer.includes(
          ".height(150.dp)\n                    .align(Alignment.TopStart)\n                    .background(Brush.verticalGradient(listOf(Color(0xA6000000), Color.Transparent))),",
        ) &&
        viewer.includes(
          ".height(170.dp)\n                    .align(Alignment.BottomStart)\n                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000)))),",
        ) &&
        viewer.includes(
          ".fillMaxWidth(progressTo(i, idx, progress))\n                                    .height(3.dp)\n                                    .background(Color.White),",
        ) &&
        !viewer.includes(".background(Card),\n"),
    );
    check(
      "r33-10: a hold's release only resumes — the tap handler bails when the press lasted the long-press timeout or more (pressedAt stamped in onPress), so it never steps or closes the viewer; short taps still step and a swipe still cancels the press",
      viewer.includes("var pressedAt = 0L") &&
        viewer.includes(
          "pressedAt = android.os.SystemClock.uptimeMillis()\n                                    holding = true",
        ) &&
        viewer.includes(
          "if (android.os.SystemClock.uptimeMillis() - pressedAt >= viewConfiguration.longPressTimeoutMillis) return@detectTapGestures",
        ) &&
        viewer.includes("if (idx + 1 < statuses.size) idx++ else nav.popBackStack()") &&
        !viewer.includes("onLongPress = {"),
    );
  }
  // Item 11c: sticker panel — emoji + GIF tabs only; the search keyboard lifts
  // the panel (compact strip), never the message bar.
  {
    const sticker = kt("StickerSheet.kt");
    const chat = kt("ChatScreen.kt");
    check(
      "r33-11c: tabs are 🙂 and GIF only — the ⬜ sticker-art and KP custom-emoji tabs (and the KP grid, EmojiRepo reads, Image/asImageBitmap) are gone from the panel; existing KP emoji messages still render through ChatScreen's CustomEmojiOrFallback",
      sticker.includes('listOf("🙂", "GIF").forEachIndexed { i, label ->') &&
        !sticker.includes('"KP"') &&
        !sticker.includes('"⬜"') &&
        !sticker.includes("tab == 3") &&
        !sticker.includes("tab == 2") &&
        !sticker.includes("EmojiRepo") &&
        !sticker.includes("import androidx.compose.foundation.Image\n") &&
        chat.includes("if (EmojiRepo.isCustomId(st)) CustomEmojiOrFallback(st)"),
    );
    check(
      "r33-11c: the panel carries the imePadding and goes compact (search row + one 44 dp LazyRow of results, no bottom row) while the keyboard is up (isImeVisible read in composition via a tiny @OptIn helper); the composer skips its own imePadding while a panel is open (padForIme = !showAttach && !showStickers); pack-name search (heart → Hearts)",
      sticker.includes("private fun imeShowing(): Boolean = WindowInsets.isImeVisible") &&
        sticker.includes("val searching = imeShowing()") &&
        sticker.includes(".background(Card)\n            .imePadding()\n") &&
        sticker.includes("if (searching) {") &&
        sticker.includes("modifier = Modifier.fillMaxWidth().height(44.dp),") &&
        sticker.includes("if (!searching) {") &&
        sticker.includes("private fun stickerMatches(query: String, pack: Int): List<String> {") &&
        sticker.includes(
          "Stickers.packs.filter { it.first.contains(q, ignoreCase = true) }.flatMap { it.second }",
        ) &&
        chat.includes("padForIme: Dp = 0.dp,") &&
        // Owner round 45 (item 3): the pad is the shared glide value.
        chat.includes(".padding(bottom = padForIme)") &&
        chat.includes("padForIme = if (!showAttach && !showStickers) imeGlideDp else 0.dp,"),
    );
  }
  // Item 14: a person in the phone book must never show "Add contact".
  {
    const pb = kt("PhoneBook.kt");
    const act = kt("MainActivity.kt");
    const resume = act.slice(
      act.indexOf("override fun onResume()"),
      act.indexOf("override fun onPause()"),
    );
    const contacts = kt("ContactsScreens.kt");
    const save = contacts.slice(
      contacts.indexOf("fun saveToPhone() {"),
      contacts.indexOf("fun saveToPhone() {") + 1400,
    );
    const chat = kt("ChatScreen.kt");
    const profile = kt("ProfileScreen.kt");
    check(
      "r33-14: PhoneBook re-matches when the book CHANGED — a dirty flag (markDirty, a contacts ContentObserver registered in init, a failed match) bypasses the 10-minute throttle; a failed match chunk keeps the previous users and leaves the sync dirty (syncedAt / the persisted stamp do not advance); Bengali digits normalise; hasNumber() knows a person by their number",
      pb.includes("private var dirty = false") &&
        pb.includes("fun markDirty() {") &&
        pb.includes(
          "ContactsContract.Contacts.CONTENT_URI,\n                true,\n                object : android.database.ContentObserver(null) {",
        ) &&
        pb.includes("if (!force && !dirty && fresh && entries.isNotEmpty()) return") &&
        pb.includes("val previous = entries.associateBy({ it.phone }, { it.user })") &&
        pb.includes(
          "}.onFailure {\n                    failed = true\n                    chunk.forEach { p -> previous[p]?.let { users[p] = it } }",
        ) &&
        pb.includes("val stamp = if (failed) syncedAt.value else System.currentTimeMillis()") &&
        pb.includes("if (failed) dirty = true\n            persist(sorted, stamp)") &&
        pb.includes('f.writeText(JSONObject().put("at", at).put("items", arr).toString())') &&
        pb.includes("c.isDigit() -> Character.digit(c, 10).takeIf { it >= 0 }?.let { '0' + it }") &&
        pb.includes("fun hasNumber(phone: String?): Boolean {"),
    );
    check(
      "r33-14: onResume re-syncs the book (throttled, off the main thread); Add contact → the Contacts app hand-off only flags dirty (no premature sync); the chat ⋮ and the profile ⋮ also count the peer's number being in the book (View contact / no Add contact)",
      resume.includes(
        "Thread { runCatching { if (!Api.token.isNullOrBlank()) PhoneBook.sync(application) } }.start()",
      ) &&
        save.includes("PhoneBook.markDirty()") &&
        !save.includes("PhoneBook.sync(ctx, force = true)") &&
        chat.includes(
          'val inBook = PhoneBook.entries.any { it.user?.optString("id") == otherUserId } ||\n                                PhoneBook.hasNumber(c?.optJSONObject("other")?.optText("phone"))',
        ) &&
        profile.includes(
          'val inBook = PhoneBook.entries.any { it.user?.optString("id") == userId } || PhoneBook.hasNumber(uMenu.optText("phone"))',
        ),
    );
  }
  // Item 18: photo / video cards even smaller — 120 dp wide, never taller than
  // 160 dp. The height cap now sits BEFORE aspectRatio (after it, aspectRatio's
  // fixed child constraints made the cap a no-op, so portrait shots still ran
  // 267 dp tall). Videos share the same box, albums narrow to 208 dp.
  {
    const chat = kt("ChatScreen.kt");
    const img = chat.slice(
      chat.indexOf("private fun ImageBubble("),
      chat.indexOf("private fun FileBubble("),
    );
    const vid = chat.slice(
      chat.indexOf("private fun VideoMessageRow("),
      chat.indexOf("private fun ViewOnceRow("),
    );
    check(
      "r33-18: photo bubble ≤120×160 with heightIn BEFORE aspectRatio, unknown-ratio placeholder 96×120, smaller upload ring; video frame shares the 120×160 caps (no 235 dp box, no 0.62 fraction) with a 38 dp play circle; album 208 dp",
      img.includes(
        "            .widthIn(max = 120.dp)\n            .then(\n                if (ratio > 0f) {\n                    Modifier\n                        .heightIn(max = 160.dp)\n                        .aspectRatio(ratio)\n                } else {\n                    Modifier\n                        .widthIn(min = 96.dp)\n                        .height(120.dp)\n                },\n            )",
      ) &&
        !img.includes(".aspectRatio(ratio)\n                        .heightIn(") &&
        img.includes("modifier = Modifier.size(34.dp),") &&
        vid.includes(
          "                    .widthIn(max = 120.dp)\n                    .heightIn(max = 160.dp)\n                    .aspectRatio(ratio)\n                    .background(Color(0xFF101A2E)),",
        ) &&
        !vid.includes("235.dp") &&
        !vid.includes("fillMaxWidth(0.62f)") &&
        (vid.match(/\.size\(38\.dp\)/g) || []).length === 2 &&
        (vid.match(/modifier = Modifier\.size\(32\.dp\),/g) || []).length === 2 &&
        !chat.includes(".size(46.dp)") &&
        chat.includes("val albumWidth = 208.dp") &&
        !chat.includes("264.dp"),
    );
  }

  // Item 11a: the AI reads photos and creates / edits pictures. Behavioural
  // probe with a fake HF router: a photo + "ki dekhte paccho" must reach the
  // vision model as an image_url part; "ekta chobi banao" must reach the image
  // model and come back as an IMAGE from the bot (with the model's caption);
  // a photo followed by "background remove koro" must be read by the vision
  // model first, then drawn as a variation. Static locks on the intent
  // regexes and the persona.
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const ai = src.slice(
      src.indexOf("async function sendAiReply("),
      src.indexOf("async function all<T>("),
    );
    check(
      "r33-11a: sendAiReply — the transcript names photos / voice notes, a bare photo or a question about one goes to the vision model (READ), a change request reads the nearby photo then draws the variation (a NEW-picture request still creates), a Banglish creation request draws, an owner-photo request never draws; a failed image tool makes the text reply apologise; the bot's picture goes out with a kp_media push",
      ai.includes(
        "WHERE conv_id = ? AND kind IN ('TEXT', 'IMAGE', 'FILE') ORDER BY rowid DESC LIMIT 12",
      ) &&
        ai.includes('return `[sent a photo]${r.body ? ` ${r.body}` : ""}`;') &&
        ai.includes(
          'newest && newest.kind === "TEXT" && newest.sender_id === userId ? (newest.body ?? "") : "";',
        ) &&
        ai.includes("const photoParts: unknown[] = [];") &&
        ai.includes(
          "if (!parts) {\n          readSource = newestPhoto; // bare photo / a question about it\n          readPhoto = newestPhoto;\n        }",
        ) &&
        ai.includes("readSource = recentPhoto; // a follow-up question about the photo") &&
        ai.includes("if (recentPhoto && wantsEdit(newestText)) {") &&
        // Owner round 42 (item 3): the predicates live at module level now
        // (the send path classifies with the same definitions).
        src.includes("const wantsPicture = (t: string) =>") &&
        src.includes(
          "IMAGE_MAKE_VERB.test(t) && IMAGE_NOUN.test(t) && !OWNER_PHOTO_ASK.test(t);",
        ) &&
        src.includes("const wantsEdit = (t: string) =>") &&
        src.includes("IMAGE_EDIT_HINT.test(t) && (IMAGE_REF.test(t) || !FRESH_NOUN.test(t));") &&
        // Owner round 43 (item 6): his spellings route to the brush too,
        // and the model never promises a picture in chat text.
        src.includes("kore\\s*daw|kore\\s*de\\b") &&
        src.includes("daw\\b|de\\b|give\\b|pathao|pathiye|pathan") &&
        src.includes("Never PROMISE a picture in chat text") &&
        src.includes("async function classifyAiKind(") &&
        src.includes(
          "ON CONFLICT (conv_id, user_id) DO UPDATE SET at = excluded.at, kind = excluded.kind",
        ) &&
        src.includes("ALTER TABLE typing ADD COLUMN kind TEXT") &&
        src.includes("typingKind,") &&
        ai.includes("but the image tool failed this time") &&
        ai.includes("but picture creation is switched off on this server") &&
        src.includes("let pictureTurn = false;") &&
        src.includes("if (!pictureTurn && OWNER_INTENT.test(asked)) {") &&
        ai.includes("Never say you cannot see images.") &&
        ai.includes("if (caption && (IMAGE_EDIT_HINT.test(caption) || wantsPicture(caption))) {") &&
        ai.includes("VALUES (?, ?, ?, 'IMAGE', NULL, ?, ?)`") &&
        ai.includes("kp_media: `/api/messages/${imgMid}/media`,") &&
        // v166: the photo leg calls the HF vision model, and the text-only
        // apology behind it, through the hedged helper.
        ai.includes("const hf = await hfChat(") &&
        ai.includes(
          "answer ?? (!env.GEMINI_API_KEY && !env.HF_TOKEN ? AI_REPLY_FALLBACK : AI_REPLY_DOWN);",
        ) &&
        // v165 (owner: "messaging voice messaging shob kichur jonno gemini
        // use hobe but image create/edit request a hugging face ai use hobe"):
        // Gemini leads chat text, a photo the user sends to be READ, and a
        // voice note; the HF chain + Whisper stay behind it as fallbacks; the
        // picture CREATE / EDIT path is still HF's alone.
        src.includes("async function geminiParts(") &&
        src.includes(
          'inline_data: { mime_type: m.mime || "application/octet-stream", data: m.b64 }',
        ) &&
        // v166 (owner: "ai reply dite onek late korche"): Gemini still LEADS,
        // but it is raced against the HF chain — the fallback starts mid-hedge
        // instead of after Gemini's whole timeout.
        // v168: the hedge is 800 ms - the reply starts streaming twice as early.
        src.includes("const AI_HEDGE_MS = 800;") &&
        src.includes(
          "return await Promise.any([answered(primary()), answered(gate.then(secondary))]);",
        ) &&
        src.includes(
          "() => geminiChat(env, messages, maxTokens),\n    () => hfThenCf(env, messages, maxTokens),",
        ) &&
        src.includes("const heard = await aiTranscribe(") &&
        src.includes("async function aiTranscribe(") &&
        src.includes("async function aiWelcomeText(") &&
        ai.includes("const seen = readPhoto;") &&
        src.includes("const drawn = await hfImage(env, parts, scene, clean);"),
      // Owner round 39 (item 5): an HF-side failure says so honestly
      // (module-level const, outside the sendAiReply slice).
      src.includes("const AI_REPLY_DOWN =") &&
        src.includes("can't reach its brain right now") &&
        ai.includes("it cannot be seen right now: say so briefly") &&
        src.includes(
          "Abilities: you CAN see photos the user sends and you CAN create or edit pictures on request",
        ) &&
        src.includes('const HF_VISION_MODEL = "Qwen/Qwen3.8-27B";') &&
        src.includes('const HF_IMAGE_MODEL = "stabilityai/stable-diffusion-3-medium-diffusers";') &&
        src.includes('const HF_STT_MODEL = "openai/whisper-large-v3-turbo";') &&
        src.includes("async function hfChat(") &&
        src.includes("async function hfImage(") &&
        src.includes("async function hfTranscribe(") &&
        src.includes("async function aiPhotoBytes(") &&
        src.includes("type AiPhotoSrc = { bytes: Uint8Array<ArrayBuffer>; mime: string };") &&
        src.includes("Rewrite this picture request as ONE text-to-image prompt") &&
        src.includes("recreates this exact photo WITH that ") &&
        src.includes("no text, no letters, no words in the image") &&
        src.includes("AbortSignal.timeout(") &&
        src.includes("router.huggingface.co") &&
        src.includes("v1/chat/completions") &&
        src.includes("hf-inference/models") &&
        src.includes('type: "image_url"') &&
        src.includes("const drawn = await hfImage(env, parts, scene, clean);") &&
        !src.includes("geminiComplete(") &&
        !src.includes("cfImage(") &&
        // Owner round 48 (item 2): rescue brains — Gemini + Workers AI stay
        // TEXT-ONLY fallbacks behind the live HF chain; picture/voice keep
        // their own HF-only honest failure paths.
        src.includes("gemini-flash-latest:generateContent") &&
        src.includes("GEMINI_API_KEY?: string") &&
        src.includes("CF_AI_TOKEN?: string") &&
        src.includes("async function aiPhotoVisionPart(") &&
        src.includes("const AI_PHOTO_MAX_BYTES = 7_000_000;"),
    );
    // the intent regexes, evaluated the way the worker does
    const rx = (name) => {
      const m = src.match(new RegExp(`const ${name} =\\n  (/.*?/i);`, "s"));
      return m ? eval(m[1]) : null;
    };
    const verb = rx("IMAGE_MAKE_VERB");
    const noun = rx("IMAGE_NOUN");
    const edit = rx("IMAGE_EDIT_HINT");
    const ref = rx("IMAGE_REF");
    const fresh = rx("FRESH_NOUN");
    const ownerAsk = rx("OWNER_PHOTO_ASK");
    const wants = (s) =>
      !!verb && !!noun && !!ownerAsk && verb.test(s) && noun.test(s) && !ownerAsk.test(s);
    const wantsEdit = (s) =>
      !!edit && !!ref && !!fresh && edit.test(s) && (ref.test(s) || !fresh.test(s));
    check(
      "r33-11a: creation intent — Banglish / Bengali / English requests match, plain chat about photos does not",
      wants("ekta chobi banao — a cat in space") &&
        wants("amar jonno ekta sundor wallpaper toiri koro") &&
        wants("একটা বিড়ালের ছবি এঁকে দাও") &&
        wants("ekta logo design koro KuchuPuchu er") &&
        wants("draw me a picture of a lighthouse") &&
        wants("ekta cartoon chobi chai") &&
        wants("amake ekta bagher chobi baniye dao") &&
        wants("make me a poster for eid") &&
        !wants("tomar owner er photo dao") &&
        !wants("tomar chobi dao") &&
        !wants("তোমার ছবি দাও") &&
        !wants("rabbi hossain er picture dekhao") &&
        !wants("photo pathalam dekho") &&
        !wants("ki dekhte paccho") &&
        !wants("tomar owner ke?") &&
        !wants("kemon acho") &&
        wantsEdit("background remove koro") &&
        wantsEdit("eta ke cartoon banao") &&
        wantsEdit("cartoon banao") &&
        wantsEdit("ছবিটা আরও সুন্দর করে দাও") &&
        wantsEdit("amar chobi ta sundor koro") &&
        wantsEdit("make it brighter") &&
        !wantsEdit("ekta chobi banao — a cat in space") &&
        !wantsEdit("amar jonno ekta logo banao") &&
        !wantsEdit("eta ki?") &&
        !wantsEdit("ki dekhte paccho"),
    );
  }
  {
    // behavioural probe: a fake HF router answers the TEXT + VISION chat
    // models and the image / STT task routes, and records what each model
    // was asked
    const seen = [];
    const realFetch = globalThis.fetch;
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    // r34-4: flipped by the failure checks — hfImagesDown = every image
    // attempt throws; loadingOnce = the first image call answers a
    // loading-503 (the retry must still draw)
    let hfImagesDown = false;
    let loadingOnce = false;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://router.huggingface.co/hf-inference/models/")) {
        const model = url.split("/models/")[1];
        if (model.includes("whisper")) {
          seen.push({ model, image: false, audio: true, text: "" });
          return new Response(JSON.stringify({ text: "kemon acho" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const req = JSON.parse(init.body);
        seen.push({ model, image: true, hasInline: false, text: String(req.inputs ?? "") });
        if (hfImagesDown) throw new Error("HF images are down");
        if (loadingOnce) {
          loadingOnce = false;
          return new Response(JSON.stringify({ error: "Model loading", estimated_time: 0.01 }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.startsWith("https://router.huggingface.co/v1/chat/completions")) {
        const req = JSON.parse(init.body);
        const content = req.messages?.[0]?.content;
        const parts = Array.isArray(content)
          ? content
          : [{ type: "text", text: String(content ?? "") }];
        seen.push({
          model: req.model,
          image: false,
          hasInline: parts.some((p) => p.type === "image_url"),
          text: parts
            .filter((p) => p.type === "text" || typeof p.text === "string")
            .map((p) => p.text)
            .join("\n"),
        });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Ami ekta lal phool dekhte pacchi." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    };
    try {
      const worker = await freshWorker();
      const db = makeD1();
      const r2 = makeR2();
      const env = {
        DB: db,
        MEDIA: r2,
        GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
        HF_TOKEN: "test-hf-token",
      };
      const ctx = makeCtx();
      let ipSeq = 0;
      const call = async (method, path, body, token, raw) => {
        const headers = { "content-type": "application/json" };
        if (path.startsWith("/api/auth/"))
          headers["cf-connecting-ip"] = `203.33.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
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
      const a = await reg("ai-eyes@x.com", "aieyes");
      await call("POST", "/api/ai/welcome", {}, a.token);
      seen.length = 0; // the welcome text call is not under test
      const conv = convBetween(db, "kp_ai_bot", a.user.id);
      const botRows = () =>
        db._db
          .prepare(
            "SELECT kind, body, media FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot' ORDER BY rowid",
          )
          .all(conv.id);
      const upload = async (name, type) =>
        (
          await call("POST", `/api/files?name=${name}&type=${type}`, undefined, a.token, {
            headers: { "content-type": "application/octet-stream" },
            body: Buffer.from(`jpeg-bytes-of-${name}`),
          })
        ).json.fileKey;

      // 1. READ: a bare photo, then "ki dekhte paccho"
      const k1 = await upload("flower.jpg", "image/jpeg");
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        {
          kind: "FILE",
          fileKey: k1,
          fileName: "flower.jpg",
          fileType: "image/jpeg",
          clientId: "ai-p1",
        },
        a.token,
      );
      const afterPhoto = seen.splice(0);
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "ki dekhte paccho", clientId: "ai-q1" },
        a.token,
      );
      const afterAsk = seen.splice(0);
      check(
        "r33-11a: a bare photo goes to the VISION model with the picture attached (the bot describes it), and the follow-up question still carries that photo",
        afterPhoto.length >= 1 &&
          afterPhoto.every((c) => !c.image) &&
          afterPhoto[0].hasInline &&
          afterPhoto[0].text.includes("[sent a photo]") &&
          afterPhoto[0].text.includes("The attached PHOTO is the one the user sent") &&
          afterAsk.length >= 1 &&
          afterAsk.every((c) => !c.image) &&
          afterAsk[0].hasInline &&
          afterAsk[0].text.includes("just before their latest message") &&
          botRows().filter((r) => r.kind === "TEXT").length >= 2,
        JSON.stringify({ afterPhoto, afterAsk, rows: botRows() }).slice(0, 600),
      );

      // 2. CREATE while the photo is still 4 rows back: a NEW-picture request
      //    must draw fresh (text-only prompt), not edit the photo
      const before = botRows().length;
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "ekta chobi banao — a cat in space", clientId: "ai-c1" },
        a.token,
      );
      const afterCreate = seen.splice(0);
      const rowsNow = botRows();
      const created = rowsNow[rowsNow.length - 1];
      const convRow = db._db
        .prepare("SELECT last_message FROM conversations WHERE id = ?")
        .get(conv.id);
      check(
        "r33-11a: 'ekta chobi banao' (a photo 4 rows up) → the request is rewritten to a clean image prompt, the image model draws it, the bot's IMAGE lands, the chat list reads Photo — and no OWNER_CARD rides along ('banao' also matches the owner intent)",
        afterCreate.length >= 2 &&
          afterCreate.some(
            (c) =>
              !c.image &&
              c.text.includes("Rewrite this picture request") &&
              c.text.includes("ekta chobi banao"),
          ) &&
          afterCreate.some(
            (c) => c.image && !c.hasInline && c.text === "Ami ekta lal phool dekhte pacchi.",
          ) &&
          rowsNow.length === before + 1 &&
          created.kind === "IMAGE" &&
          created.body === null &&
          !!created.media &&
          !!(await r2.get(created.media)) &&
          convRow.last_message === "Photo" &&
          rowsNow.every((r) => r.kind !== "OWNER_CARD"),
        JSON.stringify({ afterCreate, created, convRow }).slice(0, 500),
      );

      // 3. EDIT: a change request with the user's photo 6 rows back → image
      //    model WITH the photo bytes
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "background remove kore dao", clientId: "ai-e1" },
        a.token,
      );
      const afterEdit = seen.splice(0);
      const edited = botRows().filter((r) => r.kind === "IMAGE");
      check(
        "r33-11a: 'background remove kore dao' after a photo → the vision model rewrites photo + change into a clean image prompt, the image model draws it verbatim, the bot answers with a new IMAGE",
        afterEdit.length >= 2 &&
          afterEdit.some(
            (c) =>
              !c.image &&
              c.hasInline &&
              c.text.includes("recreates this exact photo WITH that change applied"),
          ) &&
          afterEdit.some(
            (c) => c.image && !c.hasInline && c.text === "Ami ekta lal phool dekhte pacchi.",
          ) &&
          edited.length === 2 &&
          !!edited[1].media &&
          edited[1].media !== edited[0].media &&
          !!(await r2.get(edited[1].media)),
        JSON.stringify({ afterEdit, edited }).slice(0, 500),
      );

      // 3b. an owner-photo request is the card's job — never a generation
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "tomar owner er photo dao", clientId: "ai-o1" },
        a.token,
      );
      const afterOwner = seen.splice(0);
      check(
        "r33-11a: 'tomar owner er photo dao' → chat/vision only (no image generation)",
        afterOwner.length >= 1 && afterOwner.every((c) => !c.image),
        JSON.stringify(afterOwner).slice(0, 300),
      );

      // 4. the bot's picture is readable by the user through the normal media route
      const list = await call("GET", `/api/conversations/${conv.id}/messages`, undefined, a.token);
      const botImg = (list.json.items ?? []).find(
        (m) => m.senderId === "kp_ai_bot" && m.kind === "IMAGE",
      );
      const media = botImg
        ? await worker.fetch(
            new Request(`https://kp.test${botImg.mediaUrl}`, {
              headers: { authorization: `Bearer ${a.token}` },
            }),
            env,
            ctx,
          )
        : null;
      check(
        "r33-11a: the bot's IMAGE row is served to the user via /api/messages/:id/media with hasImage",
        !!botImg &&
          botImg.hasImage === true &&
          typeof botImg.mediaUrl === "string" &&
          media?.status === 200 &&
          (media.headers.get("content-type") || "").startsWith("image/"),
        JSON.stringify({ botImg, status: media?.status }).slice(0, 300),
      );

      // 5. r34-4: HF images down (both attempts throw) → the text model is
      // told the image tool failed (honest line); nothing is blocked — the
      // retry right after draws fine.
      hfImagesDown = true;
      const botCountBefore = botRows().length;
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "ekta logo design kore dao", clientId: "ai-c2" },
        a.token,
      );
      const afterDown = seen.splice(0);
      hfImagesDown = false;
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "draw a picture of a blue cat please", clientId: "ai-c3" },
        a.token,
      );
      const afterRetry = seen.splice(0);
      const downRows = botRows().slice(botCountBefore);
      check(
        "r34-4: HF images down → both attempts tried, the text reply says the image tool failed (TEXT row, no IMAGE); the retry draws (no block window)",
        afterDown.filter((c) => c.image).length === 2 &&
          afterDown.some(
            (c) => !c.image && c.text.includes("but the image tool failed this time"),
          ) &&
          downRows.length === 2 &&
          downRows[0].kind === "TEXT" &&
          downRows[1].kind === "IMAGE" &&
          afterRetry.some((c) => c.image) &&
          !!(await r2.get(downRows[1].media)),
        JSON.stringify({ afterDown, afterRetry, downRows }).slice(0, 600),
      );

      // 5b. r34-4: the first draw answers a loading-503 → the retry lands
      // (the IMAGE is served from the second attempt's bytes).
      loadingOnce = true;
      const botCountBeforeFb = botRows().length;
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        { kind: "TEXT", body: "ekta sunset er chobi banao please", clientId: "ai-c4" },
        a.token,
      );
      const afterFb = seen.splice(0);
      const fbRows = botRows().slice(botCountBeforeFb);
      check(
        "r34-4: loading-503 → the retry draws (two image attempts, IMAGE lands)",
        afterFb.filter((c) => c.image).length === 2 &&
          fbRows.length === 1 &&
          fbRows[0].kind === "IMAGE" &&
          !!(await r2.get(fbRows[0].media)),
        JSON.stringify({ afterFb, fbRows }).slice(0, 500),
      );

      // 6. VOICE: an audio note is transcribed by Whisper and the transcript
      // is answered as chat text.
      const kv = await upload("note.m4a", "audio/mp4");
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages`,
        {
          kind: "FILE",
          fileKey: kv,
          fileName: "note.m4a",
          fileType: "audio/mp4",
          clientId: "ai-v1",
        },
        a.token,
      );
      const afterVoice = seen.splice(0);
      check(
        "HF migration: a voice note goes to Whisper, the transcript is answered as chat text",
        afterVoice.some((c) => c.audio === true) &&
          afterVoice.some(
            (c) =>
              !c.image &&
              !c.audio &&
              c.text.includes("[sent a voice note]") &&
              c.text.includes("kemon acho"),
          ),
        JSON.stringify(afterVoice).slice(0, 400),
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // Owner round 33 (item 11b): the short motion set — new rows rise into
  // the thread (my sends + live arrivals; store paints stay still), deleted
  // messages / chats shrink away before they leave, the attach / sticker
  // panels pop up from the bar, a cancelled voice note drops into a dustbin
  // whose lid opens and shuts, and the status viewer slides down on exit.
  {
    const ui = kt("Ui.kt");
    const chat = kt("ChatScreen.kt");
    const emo = kt("EmojiAnim.kt");
    const cl = kt("ChatListScreen.kt");
    const app = kt("KpApp.kt");
    check(
      "r33-11b: Ui.kt — riseIn (220 ms, graphicsLayer alpha/scale/translate, no-op when off), vanishOut (180 ms shrink, then onDone) and popUp (180 ms) are shared modifiers",
      ui.includes("fun Modifier.riseIn(on: Boolean, fromBelow: Boolean = true): Modifier {") &&
        ui.includes(
          "    if (!on) return this\n    val t = remember { Animatable(0f) }\n    LaunchedEffect(Unit) { t.animateTo(1f, tween(220)) }",
        ) &&
        ui.includes("fun Modifier.vanishOut(gone: Boolean, onDone: () -> Unit): Modifier {") &&
        ui.includes("            t.animateTo(0f, tween(180))\n            done.value()") &&
        ui.includes("fun Modifier.popUp(): Modifier {") &&
        ui.includes("    LaunchedEffect(Unit) { t.animateTo(1f, tween(180)) }") &&
        ui.includes("import androidx.compose.animation.core.Animatable") &&
        ui.includes("import androidx.compose.ui.graphics.graphicsLayer"),
    );
    check(
      "r33-11b: chat — bornKeys marks my text / photo / file / voice sends and live socket arrivals; each list row (thread + pending) consumes its key once (remember(rowKey) { bornKeys.remove(rowKey) }) and rises in; deletes go through vanishingIds → the pixel-destroy (DeleteRowShell) before the rows leave (r34-3: explicit grace windows)",
      chat.includes("val bornKeys = remember { HashSet<String>() }") &&
        chat.includes("val vanishingIds = remember { mutableStateListOf<String>() }") &&
        (chat.match(/bornKeys\.add\(clientId\)/g) || []).length === 4 &&
        chat.includes(
          'bornKeys.add(liveMsg.optString("clientId").ifBlank { liveMsg.optString("id") })',
        ) &&
        // Owner round 44: sends don't rise (only the other side's rows
        // do); the keys are still consumed once (thread + pending).
        (chat.match(/bornKeys\.remove\(rowKey\)/g) || []).length === 2 &&
        // Owner round 45 (item 1): NO pop-in at all — born is a constant
        // false now. Owner round 49 (his order): the per-word AI reveal is
        // BACK — the fade-in rows stay dead, the bot types its replies.
        !chat.includes("val born = bornKey && ") &&
        chat.includes("born = false, // Owner round 45") &&
        chat.includes("var aiRevealId") &&
        chat.includes("var aiRevealChars") &&
        chat.includes('convId.endsWith("_kp_ai_bot")') &&
        chat.includes("LaunchedEffect(aiRevealId)") &&
        chat.includes(
          'revealChars = if (m.optString("id") == aiRevealId) aiRevealChars else null,',
        ) &&
        chat.includes('full.take(revealChars) + " ▍"') &&
        chat.includes('m.optString("kind") == "TEXT"') &&
        !chat.includes("Box(Modifier.fillMaxWidth().riseIn(born)) {") &&
        chat.includes("DeleteRowShell(") &&
        chat.includes(
          "                            m = m,\n                            rowKey = rowKey,",
        ) &&
        chat.includes("vanishingIds.removeAll(gone.toSet())") &&
        (chat.match(/vanishingIds\.addAll\(ids\)/g) || []).length === 2 &&
        chat.includes(
          "        vanishingIds.addAll(ids)\n        scope.launch {\n            delay(DeleteAnim.GRACE_MS)\n            ids.forEach { ScreenStore.hideMessage(it) }\n            paintFromStore()\n        }",
        ) &&
        chat.includes('val vanishing = albumPhotos(m).any { it.optString("id") in vanishingIds }'),
    );
    check(
      "r34-3: every delete plays the pixel-destroy — sweep + dust + collapse under one grace window, paintFromStore holds mid-destroy + peer-deleted rows (vanishedOnce, no ghosts), rows without a capture fall back to vanishOut",
      // r34-16a: the 4th grace window is the VANISHED frame (a spent view-once
      // plays the same show, then leaves without a tombstone).
      (chat.match(/delay\(DeleteAnim\.GRACE_MS\)/g) || []).length === 4 &&
        chat.includes('if (liveMsg.optString("kind") == "VANISHED" && liveId.isNotBlank()) {') &&
        chat.includes("val vanishedOnce = remember { HashSet<String>() }") &&
        chat.includes('vanishedOnce.removeAll(next.map { it.optString("id") }.toSet())') &&
        chat.includes(
          "val hold = oldIds.filter { it.isNotBlank() && it !in newIds && it !in ScreenStore.hiddenMsgIds && (it in vanishingIds || it !in vanishedOnce) }",
        ) &&
        chat.includes("vanishingIds.addAll(fresh)") &&
        chat.includes("vanishedOnce.addAll(fresh)") &&
        chat.includes(
          'val merged = (next + keep).sortedBy { pos[it.optString("id")] ?: Int.MAX_VALUE }',
        ) &&
        chat.includes("vanishingIds.removeAll(hold.toSet())") &&
        ui.includes("} else {\n            // Owner round 34 (item 3)") &&
        ui.includes("t.snapTo(1f)") &&
        // Owner round 44 (item 6): frames carry their own capture again
        // (5: text + video + photo + album + view-once).
        (chat.match(/DeleteGeoms\.put\(m, it\.boundsInWindow\(\)\)/g) || []).length === 5 &&
        kt("DeleteAnim.kt").includes("const val SWEEP_MS = 1200") &&
        kt("DeleteAnim.kt").includes("const val GRACE_MS = 3200L") &&
        kt("DeleteAnim.kt").includes("const val COLLAPSE_MS = 220") &&
        kt("DeleteAnim.kt").includes("fun DeleteRowShell(") &&
        kt("DeleteAnim.kt").includes("fun DestroyCanvas(shot: DeleteShot, onDone: () -> Unit)") &&
        kt("DeleteAnim.kt").includes("drawToBitmap()") &&
        kt("DeleteAnim.kt").includes("DeleteParticle(") &&
        kt("DeleteAnim.kt").includes("exp(-dist / DeleteAnim.CURVE_W)") &&
        kt("DeleteAnim.kt").includes("if (tick == -1) return@Canvas"),
    );
    check(
      "r35-1: deletes play to the end on every content — PixelCopy capture on API 26+ (drawToBitmap throws on coil hardware photos, which silently shrank every solo photo delete), grace sized past the worst-case show (PRE + capture + SAFETY + COLLAPSE) — and surviving rows glide into the gap (animateItem on thread rows)",
      kt("DeleteAnim.kt").includes("const val GRACE_MS = 3200L") &&
        kt("DeleteAnim.kt").includes("suspend fun capture(bubble: Rect)") &&
        kt("DeleteAnim.kt").includes("PixelCopy.request(") &&
        kt("DeleteAnim.kt").includes("drawToBitmap()") &&
        chat.includes(".animateItem(fadeInSpec = null, fadeOutSpec = null)"),
    );
    check(
      "r35-2: no touch ripples anywhere — KpTheme provides a no-op NoTouchIndication at the root (LocalIndication is non-null here, so silence is an instance; the default indication was the only ripple source; explicit indication = null sites stay)",
      kt("Theme.kt").includes("private object NoTouchIndication : Indication") &&
        kt("Theme.kt").includes("LocalIndication provides NoTouchIndication"),
    );
    check(
      "r35-3: voice-isolation strength picks like a privacy level — a SettingRow opening the bottom sheet (KpSheetRow per level, selected checkmark), not an inline segment control",
      kt("SettingsScreen.kt").includes(
        'SettingRow(Icons.Filled.NoiseAware, "Voice isolation on calls", ISO_LEVELS[isoLevel])',
      ) &&
        kt("SettingsScreen.kt").includes(
          'private val ISO_LEVELS = listOf("Normal", "Medium", "Aggressive")',
        ) &&
        kt("SettingsScreen.kt").includes('picker = "isoLevel"') &&
        kt("SettingsScreen.kt").includes('title = "Voice Isolation On Calls?"') &&
        kt("SettingsScreen.kt").includes("VoiceIsolation.setLevel(ctx, i)") &&
        kt("SettingsScreen.kt").includes("VoiceIsolation.diag()") &&
        !kt("SettingsScreen.kt").includes('"Normal", "Medium", "Aggressive").forEachIndexed'),
    );
    check(
      "r35-4: compact status-viewer header — the name shrinks to 13.sp and the stamp tucks right under it (11.sp, tight line heights)",
      kt("StatusScreens.kt").includes(
        "fontSize = 13.sp,\n                                lineHeight = 15.sp,",
      ) &&
        kt("StatusScreens.kt").includes(
          "fontSize = 11.sp,\n                            lineHeight = 12.sp,",
        ) &&
        kt("StatusScreens.kt").includes("UserBadges(user ?: Store.me, 14.dp)"),
    );
    {
      const st = kt("StatusScreens.kt");
      const vw = st.slice(
        st.indexOf("fun StatusViewerScreen("),
        st.indexOf("private fun StatusMenuSheet("),
      );
      check(
        "r34-5: status viewer — no X button; the screen follows a downward drag (graphicsLayer translationY + fade, phase reads) and flings off + pops past 260px, else snaps back; an upward flick still opens the viewers sheet",
        !vw.includes("Icons.Filled.Close") &&
          !vw.includes('"vswipe"') &&
          vw.includes('.pointerInput("vdismiss", isMine)') &&
          vw.includes(
            "val settleAnim = remember { androidx.compose.animation.core.Animatable(0f) }",
          ) &&
          vw.includes("translationY = off") &&
          vw.includes("if (off > 260f) {") &&
          vw.includes("off + 1400f,") &&
          vw.includes("if (total < -130f && isMine) openViewers()"),
      );
    }
    {
      const mv = kt("MediaViewer.kt");
      check(
        "r34-6: album viewer pages — KpPhotoViewer takes urls + startIndex, swipes between photos (zoom resets per page, no swipe while zoomed), per-photo subtitle + position pill, forward/save/once act on the current photo",
        mv.includes("urls: List<String> = emptyList(),") &&
          mv.includes("startIndex: Int = 0,") &&
          mv.includes("onPageChanged: ((Int) -> Unit)? = null,") &&
          mv.includes("rememberPagerState(initialPage = startIndex.coerceIn(pages.indices))") &&
          mv.includes("userScrollEnabled = scale <= 1.01f,") &&
          mv.includes("${pager.currentPage + 1} / ${pages.size}") &&
          mv.includes("val pageUrl = pages[pager.currentPage]") &&
          chat.includes("viewerPhotos = all") &&
          chat.includes("viewerStart = all.indexOfFirst") &&
          chat.includes("onPageChanged = { viewerAt = it },") &&
          chat.includes("val m = viewerPhotos[viewerAt.coerceIn(viewerPhotos.indices)]"),
      );
    }
    check(
      "r35-5: a tapped photo opens with its send-mates — onOpenImage feeds the row's albumPhotos (not a one-item list) and starts the pager on the tapped tile, so swiping walks the whole group",
      chat.includes("val all = albumPhotos(m)") &&
        chat.includes(
          'all.indexOfFirst { it.optString("id") == msg.optString("id") }.coerceAtLeast(0)',
        ) &&
        !chat.includes("viewerPhotos = listOf(msg)"),
    );
    {
      const vf = kt("VideoFacts.kt");
      check(
        "E3: sending and sent are identical — the sending tick is 13dp like the rest, fallback wave bars seed from the shared clientId, and audio-as-media carries probed seconds in echo and row",
        chat.includes(
          'Icon(Icons.Filled.Schedule, "Sending", tint = grey, modifier = Modifier.size(13.dp))',
        ) &&
          chat.includes("VoiceWaveform.pseudo(barSeed)") &&
          vf.includes("fun probeAudioMs(f: File): Long") &&
          chat.includes("VideoFacts.probeAudioMs(file)") &&
          chat.includes('clipMeta.put("seconds"'),
      );
    }
    {
      const e2ee = kt("E2eeCall.kt");
      const eng = kt("CallEngine.kt");
      const cs = kt("CallScreens.kt");
      check(
        "E4: calls-only E2EE verify with zero added latency — stable DTLS identity on both pc configs, order-independent safety codes from both fingerprints, TOFU store with change warning, lock row on voice+video, and no network in the verify path",
        (eng.match(/certificate = E2eeCall\.identity\(app\)/g) || []).length === 2 &&
          e2ee.includes("fun fingerprint(sdp: String?): String?") &&
          e2ee.includes("if (fpA <= fpB) fpA to fpB else fpB to fpA") &&
          e2ee.includes('chunked(4).joinToString(" ")') &&
          e2ee.includes("fun checkPeer(ctx: Context, peerId: String, fp: String): Boolean") &&
          e2ee.includes("fun trustPeer(ctx: Context, peerId: String, fp: String)") &&
          !e2ee.includes("Api.") &&
          eng.includes("val e2eeCode: String = ") &&
          eng.includes("fun trustE2eePeer()") &&
          (cs.match(/E2eeCodeRow\(call/g) || []).length === 2,
      );
      check(
        "E4f: the safety code stays hidden until tapped — the lock line reads plain 'End-to-end encrypted', a tap swaps the code in for 3 s, a second tap opens the verify sheet (the code-changed warning still opens it at once)",
        e2ee.includes('if (codeVisible) call.e2eeCode else "End-to-end encrypted"') &&
          e2ee.includes("delay(3_000)") &&
          e2ee.includes("if (warn || codeVisible) showSheet = true else codeVisible = true") &&
          !e2ee.includes("End-to-end encrypted · ${call.e2eeCode}"),
      );
      check(
        "N1: inactive call buttons keep a clean thin ring only — no translucent disc, no extra offset circle underneath",
        cs.includes("Color.White.copy(alpha = 0.24f), CircleShape") &&
          cs.includes("Color.White.copy(alpha = 0.22f), CircleShape") &&
          !cs.includes("Color(0x42FFFFFF)") &&
          !cs.includes("Color(0x3DFFFFFF)"),
      );
    }
    {
      const cs = kt("CallScreens.kt");
      check(
        "N1r: inactive call buttons are truly bare — no translucent disc behind CallAction / StripAction (danger + active keep their fills)",
        !cs.includes("0x42FFFFFF") &&
          !cs.includes("0x3DFFFFFF") &&
          cs.includes("if (danger || active) Modifier.shadow(6.dp, CircleShape) else Modifier") &&
          cs.includes("if (danger || active) Modifier.shadow(5.dp, CircleShape) else Modifier"),
      );
    }
    {
      const cs = kt("CallScreens.kt");
      check(
        "E6: the keyboard closes when the call screen arrives — CallGate hides the IME and force-clears focus once per call id",
        cs.includes("LaunchedEffect(call.id) {") &&
          cs.includes("gateKeyboard?.hide()") &&
          cs.includes("gateFocus.clearFocus(force = true)"),
      );
    }
    {
      const fx = kt("ChatFx.kt");
      check(
        "E7: old-history rows get a unique one-shot unfurl (fade + rise, not the live slide/fly/pop) — keyed per loadOlder page, consumed on first compose, reduced-motion gated",
        fx.includes("fun Modifier.fxHistoryUnfurl(") &&
          fx.includes("translationY = 14f * density * (1f - v)") &&
          chat.includes('historyFxKeys.addAll(freshOld.map { it.optString("id") })') &&
          (chat.match(/historyFxKeys\.remove\(rowKey\)/g) || []).length === 2 &&
          (chat.match(/\.fxHistoryUnfurl\(rowKey in historyFxKeys\)/g) || []).length === 2,
      );
    }
    check(
      "E8: every message item fits in 70% of the screen — text bubbles, the owner card and albums all cap at 0.70 of the width",
      (chat.match(/screenWidthDp \* 0\.70f/g) || []).length === 3 &&
        !chat.includes("0.82f") &&
        !chat.includes("0.92f") &&
        chat.includes("val albumW = minOf(albumWidth,"),
    );
    check(
      "N2: rows breathe — the message list spaces items 3 dp apart while staying bottom-anchored, so no bubble sits flush on the stamp line above",
      chat.includes("verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.Bottom),"),
    );
    check(
      "N5: the view-once galaxy scurries — each star drifts on a slow random path while it twinkles (the center mark stays static)",
      chat.includes("val orbits = 1") &&
        chat.includes("kotlin.math.cos(ang) * amp") &&
        chat.includes("tween(5200"),
    );
    {
      const at = kt("AttachSheet.kt");
      check(
        "N6: compact attach tiles — a 32 dp seat with a 22 dp glyph and no label row (talkback still announces the action)",
        at.includes("contentDescription = label, tint = tint, modifier = Modifier.size(22.dp)") &&
          at.includes(".size(32.dp)") &&
          !at.includes("Text(label, fontSize = 10.sp"),
      );
      check(
        "N6: swiping the collapsed panel handle down puts the sheet away — a Deselect / Not now stop when media is selected, straight away when empty",
        at.includes("if (fullscreen) setFullscreen(false)") &&
          at.includes("else requestDismiss()") &&
          at.includes('confirmLabel = "Deselect"') &&
          at.includes('cancelLabel = "Not now"'),
      );
    }
    check(
      "N3a: sticker-emoji messages float on the wallpaper like text emoji-only — no min width, no lift, no fill, wallpaper-ink ticks, both sides",
      chat.includes('val noBubble = emojiOnly > 0 || kind == "STICKER"') &&
        chat.includes("if (noBubble) Modifier else Modifier.shadow(2.dp, bubbleShape)") &&
        chat.includes(
          "noBubble -> Brush.linearGradient(listOf(Color.Transparent, Color.Transparent))",
        ) &&
        chat.includes('if (kind == "STICKER") 1 else emojiOnly, stampInk'),
    );
    check(
      "N3r: EVERY emoji dances as its real glyph — a hash-assigned 3D motion palette on the whole glyph (no redrawn faces), 3 s then rest, tap replays here AND on the other side via the emoji_fx frame, frozen under reduced motion",
      emo.includes("private val FX_PATTERNS") &&
        (emo.match(/FxPattern\(/g) || []).length >= 14 &&
        emo.includes("cameraDistance = 8f * density") &&
        emo.includes("delay(FX_PLAY_MS)") &&
        emo.includes('Api.post("/api/messages/$mid/fx")') &&
        emo.includes("emojiFxReplays.remove(mid)") &&
        !emo.includes("FaceKind") &&
        chat.includes('"emoji_fx"') &&
        chat.includes("emojiFxReplays.add(it)") &&
        (chat.match(/EmojiGlyphRow\(/g) || []).length === 3,
    );
    check(
      "r34-7: typing dots follow the chat theme — TypingBubble takes the dot color, the row passes chatAccent(chatTheme), no fixed amber in the indicator",
      chat.includes("private fun TypingBubble(dot: Color) {") &&
        chat.includes(".background(dot.copy(alpha = 0.35f + 0.65f * lift))") &&
        !chat.includes("GoldDeep.copy(alpha = 0.35f"),
    );
    check(
      "E2: typing + voice indicators sit 4dp lower — both indicator rows carry top 7dp / bottom 3dp instead of symmetric vertical 3dp",
      (chat.match(/\.padding\(top = 7\.dp, bottom = 3\.dp\)/g) || []).length === 2,
    );
    {
      const ss = kt("SettingsScreen.kt");
      check(
        "r34-8: device list separates rows, the phone icon sits in a tint disc, the This-device badge is tiny",
        ss.includes("list.forEachIndexed { i, d ->") &&
          ss.includes(".size(38.dp)") &&
          ss.includes('"This device",'),
      );
      check(
        "r35-6: one card per device with breathing room (no shared wrapper, no hairlines), the badge shrinks to 7.sp (round 36 went smaller still), and both detail lines wrap so nothing truncates",
        !ss.includes("SectionCard { DevicesSection() }") &&
          ss.includes(".padding(top = if (i == 0) 2.dp else 8.dp)") &&
          ss.includes("fontSize = 7.sp,") &&
          (ss.match(/maxLines = 2,/g) || []).length >= 2 &&
          !ss
            .slice(ss.indexOf("private fun DevicesSection()"), ss.indexOf("private fun deviceSeen"))
            .includes("HorizontalDivider"),
      );
    }
    check(
      "r33-11b: chat — the attach and sticker panels pop up (Box(Modifier.popUp())); a cancelled recording bumps voiceBinNonce, the composer swaps the strip for VoiceBinDrop (lid open → note drops → lid shut, 520 ms) before the pill returns",
      (chat.match(/Box\(Modifier\.popUp\(\)\) \{/g) || []).length === 2 &&
        chat.includes("var voiceBinNonce by remember { mutableStateOf(0) }") &&
        chat.includes(
          "            VoiceNote.cancel()\n            // Owner round 33 (item 11b): the strip plays the bin drop.\n            voiceBinNonce++",
        ) &&
        chat.includes("voiceBinNonce = voiceBinNonce,") &&
        chat.includes("    voiceBinNonce: Int = 0,") &&
        chat.includes(
          "            binPlaying = true\n            delay(520)\n            binPlaying = false",
        ) &&
        chat.includes("        if (binPlaying && !recording) {") &&
        chat.includes("                VoiceBinDrop(accent)") &&
        chat.includes("internal fun VoiceBinDrop(accent: Color) {") &&
        chat.includes(
          "LaunchedEffect(Unit) { t.animateTo(1f, tween(520, easing = LinearEasing)) }",
        ) &&
        chat.includes("withTransform({ rotate(-55f * lid, hinge) }) {") &&
        chat.includes("import androidx.compose.ui.graphics.drawscope.withTransform") &&
        chat.includes("import androidx.compose.animation.core.Animatable"),
    );
    check(
      "r33-11b: chat list — a swiped-away chat shrinks (vanishOut on the 76 dp row, 190 ms) before dropConv in both delete slots; status viewer route slides up on enter and down on pop",
      cl.includes("var vanishing by remember { mutableStateOf(false) }") &&
        (
          cl.match(
            /vanishing = true\n\s+delay\(190\)\n\s+ScreenStore\.dropConv\(conv\.optString\("id"\)\)/g,
          ) || []
        ).length === 2 &&
        cl.includes(
          "Box(Modifier.fillMaxWidth().height(76.dp).vanishOut(vanishing) {}.then(swipeFocusTouch(convId))) {",
        ) &&
        app.includes(
          '                    "statusview/{whose}",\n                    enterTransition = { slideInVertically(tween(240)) { it } },',
        ) &&
        app.includes(
          "                    popExitTransition = { slideOutVertically(tween(240)) { it } },",
        ) &&
        app.includes("import androidx.compose.animation.slideInVertically") &&
        app.includes("import androidx.compose.animation.slideOutVertically"),
    );
  }

  // Owner round 33 (item 24): html / md documents open as the rendered
  // preview (offline WebView, live parts stripped; Markdown via the app's own
  // MarkdownLite), and the ⋮ sheet switches Code / Preview.
  {
    const doc = kt("DocViewerScreen.kt");
    const md = kt("MarkdownLite.kt");
    const mdTest = readFileSync(
      "native-android/app/src/test/java/app/kuchupuchu/android/MarkdownLiteTest.kt",
      "utf8",
    );
    check(
      "r33-24: DocViewerScreen — docPreviewKind (html/htm/xhtml, md/markdown) → PreviewDoc first (showCode false on open); the ⋮ sheet offers Code (Icons.Filled.Code) while previewing and Preview (Icons.Filled.Visibility) while on the source, before Save / Forward / Open with; PreviewDoc keeps the SVG sandbox (JS off, network + file access blocked, every request intercepted, links never navigate) and previewPage strips script/iframe/object/embed/base/meta-refresh tags and on* handlers from HTML, converts Markdown through MarkdownLite, and follows the app theme",
      doc.includes("private enum class PreviewKind { HTML, MARKDOWN }") &&
        doc.includes("private fun docPreviewKind(name: String, mime: String): PreviewKind? {") &&
        doc.includes("var showCode by remember(b64) { mutableStateOf(false) }") &&
        doc.includes(
          'KpSheetRow(Icons.Filled.Visibility, "Preview") { menuOpen = false; showCode = false }',
        ) &&
        doc.includes(
          'KpSheetRow(Icons.Filled.Code, "Code") { menuOpen = false; showCode = true }',
        ) &&
        doc.indexOf('KpSheetRow(Icons.Filled.Code, "Code")') <
          doc.indexOf('KpSheetRow(Icons.Filled.Download, "Save")') &&
        doc.includes("else -> DocBody(dest, name, mime, size, code = showCode)") &&
        doc.includes(
          "    if (preview != null && !code) {\n        PreviewDoc(file, preview)\n        return\n    }",
        ) &&
        doc.includes("private fun PreviewDoc(file: File, kind: PreviewKind) {") &&
        doc.includes(
          "private fun previewPage(raw: String, kind: PreviewKind, dark: Boolean): String {",
        ) &&
        doc.includes(
          'val cleaned = onAttrRe.replace(activeTagRe.replace(activeBlockRe.replace(raw, ""), ""), "")',
        ) &&
        doc.includes("private val activeBlockRe = Regex(") &&
        !doc.includes("update = { it.loadDataWithBaseURL(") &&
        doc.includes('css + "</head><body>" + MarkdownLite.toHtml(raw) + "</body></html>"') &&
        (doc.match(/settings\.javaScriptEnabled = false/g) || []).length === 2 &&
        (doc.match(/settings\.blockNetworkLoads = true/g) || []).length === 2 &&
        (
          doc.match(
            /override fun shouldOverrideUrlLoading\(view: android\.webkit\.WebView\?, request: android\.webkit\.WebResourceRequest\?\): Boolean = true/g,
          ) || []
        ).length === 2 &&
        doc.includes("import androidx.compose.material.icons.filled.Code") &&
        doc.includes("import androidx.compose.material.icons.filled.Visibility"),
    );
    check(
      "r33-24: MarkdownLite — dependency-free Markdown → HTML (headings, setext, paragraphs, emphasis, inline + fenced + indented code, links, images → alt, lists incl. tasks, quotes, tables, rules), every character HTML-escaped before any tag is added; the unit test pins rendering and the no-raw-HTML guarantee",
      md.includes("internal object MarkdownLite {") &&
        md.includes("fun toHtml(md: String): String {") &&
        md.includes("internal fun inline(src: String): String {") &&
        md.includes("internal fun escape(s: String): String {") &&
        md.includes("'&' -> sb.append(\"&amp;\")") &&
        md.includes("'<' -> sb.append(\"&lt;\")") &&
        md.includes("sb.append(styled(escape(p)))") &&
        md.includes('sb.append("<code>").append(escape(p)).append("</code>")') &&
        md.includes("private val tableSepRe") &&
        md.includes("private val taskRe") &&
        mdTest.includes("class MarkdownLiteTest {") &&
        mdTest.includes("fun `raw html in the file is escaped never emitted`()") &&
        mdTest.includes('assertFalse(html.contains("<script"))'),
    );
  }

  // Owner round 33 (item 4): sending felt slow. From Bangladesh every D1
  // statement is a hop to the Singapore primary, and a text send awaited
  // eight of them one after another. The route now reads in two parallel
  // waves (membership + member list + block join, then reply / dedupe /
  // upload lookups) and writes in ONE batch (row + upload binding + preview
  // + unread), so a send is four trip-times instead of eight to twelve. The
  // shim counts trips and waves; the checks below pin the numbers and prove
  // nothing about the semantics moved (dedupe race, reply, upload, block).
  {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const post = src.slice(
      src.indexOf('if (msgMatch && method === "POST") {'),
      src.indexOf("const scheduledListMatch = path.match("),
    );
    check(
      "r33-4: worker — POST /messages reads membership, the member list and a blocks JOIN in one Promise.all, then the reply target / dedupe probe / upload refs in a second; the INSERT guards itself against a racing twin (NOT EXISTS on the dedupe index) and travels in one db.batch with the files binding, the preview UPDATE and the unread bump (both conditional on the row); a lost race answers the winner's row as duplicate",
      post.includes(
        "const [{ conv }, members, hit] = await Promise.all([\n      requireMember(db, convId, uid),\n      membersOf(db, convId),",
      ) &&
        post.includes(
          "JOIN blocks b ON (b.owner_id = ? AND b.target_id = m.user_id)\n                         OR (b.target_id = ? AND b.owner_id = m.user_id)\n          WHERE m.conv_id = ? AND m.user_id != ?\n          LIMIT 1`,",
        ) &&
        post.includes('if (hit) fail(403, "You can\'t reach this player.", "BLOCKED");') &&
        post.includes("const [replyTarget, dup, refs] = await Promise.all([") &&
        post.includes(
          "SELECT id FROM messages WHERE id = ? AND conv_id = ? AND kind != 'DELETED' LIMIT 1",
        ) &&
        post.includes(
          "SELECT * FROM messages WHERE conv_id = ? AND sender_id = ? AND client_id = ? LIMIT 1",
        ) &&
        post.includes('"SELECT sender_id, meta_json FROM messages WHERE media = ? LIMIT 8",') &&
        post.includes("if (dup) return json({ message: msgFrom(dup), duplicate: true }, 200);") &&
        post.includes("const replyTo: string | null = replyTarget ? rawReplyTo : null;") &&
        post.includes("const written = (await db.batch([") &&
        post.includes(
          "INSERT INTO messages (id, conv_id, sender_id, kind, body, media, meta_json, created_at, client_id, reply_to)\n           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?\n            WHERE NOT EXISTS (SELECT 1 FROM messages WHERE conv_id = ? AND sender_id = ? AND client_id = ?)`,",
        ) &&
        post.includes(
          '"UPDATE files SET conv_id = ? WHERE key = ? AND owner_id = ? AND conv_id IS NULL",',
        ) &&
        post.includes("WHERE id = ? AND EXISTS (SELECT 1 FROM messages WHERE id = ?)`,") &&
        post.includes(
          '"UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id != ? AND EXISTS (SELECT 1 FROM messages WHERE id = ?)",',
        ) &&
        post.includes("if ((written[0]?.meta?.changes ?? 1) === 0) {") &&
        post.includes("return json({ message: msgFrom(winner), duplicate: true }, 200);") &&
        !post.includes("for (const group of chunked(others)) {") &&
        !post.includes('await run(\n        db,\n        "INSERT INTO messages') &&
        // Owner round 42 (item 3): the fourth run stamps the AI typing kind.
        (post.match(/await run\(/g) || []).length === 4,
      `awaited runs=${(post.match(/await run\(/g) || []).length}`,
    );
    const k = await mk();
    const a = await k.reg("fast-a@x.com", "fasta");
    const b = await k.reg("fast-b@x.com", "fastb");
    const c = await k.reg("fast-c@x.com", "fastc");
    const cid = (await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token)).json
      .conversation.id;
    const send = async (body, tok = a.token) => {
      k.db._stats.reset();
      const r = await k.call("POST", `/api/conversations/${cid}/messages`, body, tok);
      return { r, ...k.db._stats };
    };
    // The isolate's one-time push diagnostics row (no FCM secret here) is not
    // part of a send's cost: pay it once, off the measurement.
    await send({ kind: "TEXT", body: "warm", clientId: "fast_0" });
    const t1 = await send({ kind: "TEXT", body: "fast one", clientId: "fast_1" });
    const rowB = () =>
      k.db._db
        .prepare("SELECT unread FROM members WHERE conv_id = ? AND user_id = ?")
        .get(cid, b.user.id);
    const convRow = () =>
      k.db._db
        .prepare("SELECT last_message, last_message_at FROM conversations WHERE id = ?")
        .get(cid);
    check(
      "r33-4: a text send is 201 with the row, lands the preview + the recipient's unread, and costs FOUR D1 trip-times (auth, then two parallel read waves, then ONE write batch) — the reads overlap up to three at a time, never past the runtime's six",
      t1.r.status === 201 &&
        t1.r.json.message?.body === "fast one" &&
        t1.r.json.message?.clientId === "fast_1" &&
        convRow()?.last_message === "fast one" &&
        convRow()?.last_message_at === t1.r.json.message?.createdAt &&
        Number(rowB()?.unread) === 2 &&
        t1.waves === 4 &&
        t1.trips === 6 &&
        t1.concurrent === 3,
      JSON.stringify({ s: t1.r.status, w: t1.waves, t: t1.trips, c: t1.concurrent }),
    );
    const again = await send({ kind: "TEXT", body: "fast one", clientId: "fast_1" });
    check(
      "r33-4: the retried POST (same clientId) still answers the ORIGINAL row as duplicate, writes nothing, and no second row exists",
      again.r.status === 200 &&
        again.r.json.duplicate === true &&
        again.r.json.message?.id === t1.r.json.message?.id &&
        again.writes === 0 &&
        Number(rowB()?.unread) === 2 &&
        Number(
          k.db._db
            .prepare("SELECT count(*) AS c FROM messages WHERE conv_id = ? AND client_id = ?")
            .get(cid, "fast_1")?.c,
        ) === 1,
      JSON.stringify({ s: again.r.status, dup: again.r.json.duplicate, w: again.writes }),
    );
    // The race the probe cannot see: a twin that lands between the dedupe
    // read and the write batch. Plant the twin row after the probe by
    // slipping it in through the batch's own entry point.
    {
      const realBatch = k.db.batch.bind(k.db);
      let planted = false;
      k.db.batch = async (stmts) => {
        if (!planted && stmts.some((st) => /INSERT INTO messages/.test(st.sql))) {
          planted = true;
          k.db._db
            .prepare(
              "INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at, client_id) VALUES (?, ?, ?, 'TEXT', ?, ?, ?)",
            )
            .run("m_twin", cid, a.user.id, "fast twin", new Date().toISOString(), "fast_2");
        }
        return realBatch(stmts);
      };
      const unreadBefore = Number(rowB()?.unread);
      const lost = await send({ kind: "TEXT", body: "fast twin", clientId: "fast_2" });
      k.db.batch = realBatch;
      const rows = k.db._db
        .prepare("SELECT id FROM messages WHERE conv_id = ? AND client_id = ?")
        .all(cid, "fast_2");
      check(
        "r33-4: a twin that lands AFTER the dedupe probe loses the race inside the batch — exactly one row, the answer is the winner marked duplicate (200), the preview and the unread do not move for the loser",
        planted &&
          lost.r.status === 200 &&
          lost.r.json.duplicate === true &&
          lost.r.json.message?.id === "m_twin" &&
          rows.length === 1 &&
          rows[0].id === "m_twin" &&
          Number(rowB()?.unread) === unreadBefore &&
          convRow()?.last_message === "fast one",
        JSON.stringify({
          planted,
          s: lost.r.status,
          dup: lost.r.json.duplicate,
          rows: rows.length,
        }),
      );
    }
    const reply = await send({
      kind: "TEXT",
      body: "fast reply",
      clientId: "fast_3",
      replyTo: t1.r.json.message.id,
    });
    const ghost = await send({
      kind: "TEXT",
      body: "ghost reply",
      clientId: "fast_4",
      replyTo: "m_none",
    });
    check(
      "r33-4: a reply still threads (replyTo verified in the same read wave — no extra trip-time) and an unknown / foreign quote is dropped, not trusted",
      reply.r.status === 201 &&
        reply.r.json.message?.replyTo === t1.r.json.message.id &&
        reply.waves === 4 &&
        ghost.r.status === 201 &&
        ghost.r.json.message?.replyTo === undefined,
      JSON.stringify({
        rep: reply.r.json.message?.replyTo,
        w: reply.waves,
        ghost: ghost.r.json.message?.replyTo,
      }),
    );
    const noId = await send({ kind: "TEXT", body: "no client id" });
    const noIdAgain = await send({ kind: "TEXT", body: "no client id" });
    check(
      "r33-4: a send without a clientId (old client / bot path) skips the probe (three trip-times) and never dedupes against another id-less row",
      noId.r.status === 201 &&
        noIdAgain.r.status === 201 &&
        noId.r.json.message?.id !== noIdAgain.r.json.message?.id &&
        noId.waves === 3 &&
        Number(
          k.db._db
            .prepare(
              "SELECT count(*) AS c FROM messages WHERE conv_id = ? AND body = 'no client id'",
            )
            .get(cid)?.c,
        ) === 2,
      JSON.stringify({ s: [noId.r.status, noIdAgain.r.status], w: noId.waves }),
    );
    // Upload path: the files row is bound in the same batch; a sticker is a
    // plain kind; the block join refuses in either direction.
    const up = await k.call(
      "POST",
      "/api/files?name=doc.pdf&type=application/pdf",
      "pdf-bytes",
      a.token,
    );
    const fileKey = up.json.fileKey;
    const filed = await send({
      kind: "FILE",
      fileKey,
      fileName: "doc.pdf",
      fileType: "application/pdf",
      fileSize: 3,
      clientId: "fast_5",
    });
    const bound = k.db._db.prepare("SELECT conv_id FROM files WHERE key = ?").get(fileKey);
    check(
      "r33-4: an upload send binds files.conv_id inside the write batch (still four trip-times) and the recipient can fetch the object",
      up.status === 201 &&
        filed.r.status === 201 &&
        filed.r.json.message?.fileKey === fileKey &&
        filed.waves === 4 &&
        bound?.conv_id === cid &&
        (await k.call("GET", `/api/files/${fileKey}`, undefined, b.token)).status === 200,
      JSON.stringify({ up: up.status, s: filed.r.status, w: filed.waves, bound: bound?.conv_id }),
    );
    await k.call("POST", "/api/blocks", { userId: a.user.id }, b.token);
    const blockedByB = await send({ kind: "TEXT", body: "blocked?", clientId: "fast_6" });
    await k.call("DELETE", `/api/blocks/${a.user.id}`, undefined, b.token);
    await k.call("POST", "/api/blocks", { userId: b.user.id }, a.token);
    const blockedByA = await send({ kind: "TEXT", body: "blocked?", clientId: "fast_7" });
    await k.call("DELETE", `/api/blocks/${b.user.id}`, undefined, a.token);
    const outsider = await send({ kind: "TEXT", body: "intruder", clientId: "fast_8" }, c.token);
    const afterAll = await send({ kind: "TEXT", body: "clear again", clientId: "fast_9" });
    check(
      "r33-4: the block JOIN refuses in BOTH directions (403 BLOCKED, nothing written), a non-member is still 403 from requireMember, and an unblocked pair sends again",
      blockedByB.r.status === 403 &&
        blockedByB.r.json.error?.code === "BLOCKED" &&
        blockedByB.writes === 0 &&
        blockedByA.r.status === 403 &&
        blockedByA.r.json.error?.code === "BLOCKED" &&
        outsider.r.status === 403 &&
        outsider.writes === 0 &&
        afterAll.r.status === 201,
      JSON.stringify({
        b: [blockedByB.r.status, blockedByB.r.json.error?.code],
        a: [blockedByA.r.status, blockedByA.r.json.error?.code],
        c: outsider.r.status,
        ok: afterAll.r.status,
      }),
    );
  }

  // Item 11: one open swipe row at a time — another row's touch, a scroll, or
  // a touch on blank list space closes it (main and archive lists; r33-6
  // retired the hidden list).
  {
    const cl = kt("ChatListScreen.kt");
    check(
      "r32-11: chat-list swipe reveal auto-closes — SwipeOpen focus holder, row watcher (LaunchedEffect on SwipeOpen.id), touch-on-other-row / blank-space / scroll observers on both lists",
      cl.includes("private object SwipeOpen {") &&
        cl.includes("var id by mutableStateOf<String?>(null)") &&
        cl.includes("if (SwipeOpen.id != convId && dragged != 0f) dragged = 0f") &&
        cl.includes("if (SwipeOpen.id != null && SwipeOpen.id != id) SwipeOpen.id = null") &&
        cl.includes("if (!onRow) SwipeOpen.id = null") &&
        cl.includes(
          "snapshotFlow { listState.isScrollInProgress }.collect { if (it) SwipeOpen.id = null }",
        ) &&
        cl.includes("if (dragged != 0f) SwipeOpen.id = convId") &&
        (cl.match(/CloseSwipeOnScroll\(/g) || []).length === 3 &&
        (cl.match(/swipeFocusList[ ]?[({]/g) || []).length === 4 &&
        cl.includes(".then(swipeFocusTouch(convId))"),
    );
  }
}

// v167 (owner: "ai reply ekhono slow … ai reply live Hobe joto ta output
// pabe realtime update hobe massage word by word"): the answer is painted
// WHILE the model writes it. A fake Gemini answers the streaming endpoint
// with four SSE chunks 200 ms apart (the worker's own throttle is 140 ms, so
// every one of them is a frame of its own) and a fake room records what the
// chat would receive.
{
  const seenFrames = [];
  const realFetch = globalThis.fetch;
  const geminiAsked = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      geminiAsked.push(url);
      const pieces = ["Bhalo ", "acho? ", "Ami ", "KuchuPuchu AI."];
      const enc = new TextEncoder();
      const body = new ReadableStream({
        async start(ctrl) {
          for (const piece of pieces) {
            ctrl.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`,
              ),
            );
            await new Promise((r) => setTimeout(r, 200));
          }
          ctrl.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return realFetch(input, init);
  };
  const room = {
    idFromName: (roomKey) => roomKey,
    get: () => ({
      fetch: async (_url, init) => {
        seenFrames.push(JSON.parse(init.body));
        return Response.json({ ok: true, sent: 1 });
      },
    }),
  };
  try {
    const worker = await freshWorker();
    const db = makeD1();
    const env = {
      DB: db,
      MEDIA: makeR2(),
      GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
      GEMINI_API_KEY: "test-gemini-key",
      CHAT_ROOM: room,
    };
    const ctx = makeCtx();
    let ipSeq = 0;
    const call = async (method, path, body, token) => {
      const headers = { "content-type": "application/json" };
      if (path.startsWith("/api/auth/"))
        headers["cf-connecting-ip"] = `203.44.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
      if (token) headers.authorization = `Bearer ${token}`;
      const init = { method, headers };
      if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
      const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
      const text = await res.text();
      await ctx.drain();
      return { status: res.status, json: text ? JSON.parse(text) : {} };
    };
    const reg = makeReg(call);
    const a = await reg("live@x.com", "livestream");
    await call("POST", "/api/ai/welcome", {}, a.token);
    const conv = convBetween(db, "kp_ai_bot", a.user.id);
    seenFrames.length = 0;
    geminiAsked.length = 0;
    await call(
      "POST",
      `/api/conversations/${conv.id}/messages`,
      { kind: "TEXT", body: "kemon acho?", clientId: "live-1" },
      a.token,
    );
    // the broadcasts ride their own waitUntil slots — let them land too
    await new Promise((r) => setTimeout(r, 60));
    await ctx.drain();
    const deltas = seenFrames.filter((f) => f.type === "ai_delta" && f.conversationId === conv.id);
    const finals = seenFrames.filter((f) => f.type === "message");
    const body = finals.length ? finals[finals.length - 1].message.body : "";
    const growing = deltas.every(
      (f, i) => f.text.length > 0 && (i === 0 || f.text.length > deltas[i - 1].text.length),
    );
    check(
      "v167 live AI reply: the answer streams — the chat room receives the text SO FAR as it grows (Gemini's streaming endpoint, throttled to one frame per 140 ms), every frame is a prefix of the finished message, and the finished message row still lands last",
      geminiAsked.some((u) => u.includes("streamGenerateContent?alt=sse")) &&
        deltas.length >= 3 &&
        growing &&
        deltas.every((f) => body.startsWith(f.text.trimEnd())) &&
        body.includes("KuchuPuchu AI.") &&
        finals.some((f) => f.message.senderId === "kp_ai_bot" && f.message.kind === "TEXT"),
      JSON.stringify({ asked: geminiAsked.length, deltas: deltas.map((f) => f.text), body }).slice(
        0,
        600,
      ),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`bots-verified: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
