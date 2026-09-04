// Bots & badges (owner round): the KuchuPuchu AI welcome message (Gemini
// fallback when no key), both bot accounts verified with the bundled logo
// avatar, the login-approval card carrying the attempt's origin (IP, place,
// time), and the official notification account being strictly one-way.

import { readFileSync } from "node:fs";
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
    chat.includes("Column(Modifier.weight(1f).offset(y = 6.dp))") &&
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
    "timestamp no longer overlays the text (in-flow under the body)",
    !chat.includes(
      "Modifier.align(Alignment.BottomEnd),\n                    verticalAlignment = Alignment.CenterVertically,\n                ) {\n                    Text(\n                        msgStamp",
    ) && chat.includes("Modifier.align(Alignment.End).padding(top = 1.dp)"),
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
  check("the retired Banglish-spelling rule is gone", !src.includes("kemon achen"));
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`bots-verified: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
