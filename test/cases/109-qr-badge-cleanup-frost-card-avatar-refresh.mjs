// 109 — the owner's 2026-10-21 feedback round (v293 / 3.9.216):
//
//   1. QR badge, both platforms: the mark now sits on a white ROUNDED-SQUARE
//      chip dead-centre like WhatsApp (the old circle plate let the square
//      logo's corners poke out — "kichui alignment nai"), and the art is the
//      glyph with its background removed: dark bubble + blue tail on
//      transparency, so it reads on the white chip. Same PNG serves web
//      (public/qr-badge.png) and Android (drawable/qr_badge.png).
//   2. Web QR card was rendering the profile photo as a giant oval: the
//      absolutely-positioned .avatar-img inset against the CARD because the
//      72px avatar tile never established a containing block. position:
//      relative on the tile fixes the "egg".
//   3. Nav pill: frosted glass, not an opaque slab — the pill base moved
//      into the Haze style as thin tints (blur 28dp over the scaffold's own
//      content); nothing repaints it 82%-opaque on top of the blur. Pinned
//      here top level; full chain pinned in cases 62/65.
//   4. The /@handle landing card shows THE USER's photo and name instead of
//      the app logo (logo stays as fallback), backed by the new PUBLIC
//      worker route /api/users/card/<handle>: session-free, rate-limited,
//      private profiles answer null, the avatar only ships when the owner's
//      avatar privacy is "everyone".
//   5. "logo ekhono shob jaigay old ta keno?": every /logo.png reference
//      carries ?v=3.9.216 so a stale service-worker precache can no longer
//      hand out the previous branding.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const bytes = (p) => readFileSync(new URL(p, import.meta.url));

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const qrDialog = read("../../web/src/messaging/ProfileQrDialog.tsx");
const styles = read("../../web/src/styles.css");
const userLink = read("../../web/src/site/UserLinkPage.tsx");
const worker = read("../../src/worker/index.ts");
const qrScreen = read("../../native-android/app/src/main/java/app/kuchupuchu/android/QrScreen.kt");
const chatList = read(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
);
const kpApp = read("../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt");
const indexHtml = read("../../web/index.html");
const manifest = read("../../web/public/manifest.webmanifest");
const appTsx = read("../../web/src/App.tsx");
const authScreen = read("../../web/src/auth/AuthScreen.tsx");
const convList = read("../../web/src/messaging/ConversationList.tsx");

/* 1 — the badge: WhatsApp chip, centred, background removed ------------- */
check(
  "web QR badge is a white rounded-square chip, 26% of code width, glyph drawn inside at an inset (no corner poke-out)",
  qrDialog.includes("const PLATE = Math.round(QR_WIDTH * 0.26)") &&
    qrDialog.includes('glyph.src = "/qr-badge.png"') &&
    qrDialog.includes("ctx.roundRect(x, y, PLATE, PLATE, PLATE_CORNER)") &&
    qrDialog.includes("const GLYPH_INSET = PLATE * 0.08") &&
    qrDialog.includes("const x = (QR_WIDTH - PLATE) / 2") &&
    !qrDialog.includes('logo.src = "/logo.png"'),
);
check(
  "Android QR badge draws the same chip: white roundRect plate + qr_badge glyph inside, dead-centre",
  qrScreen.includes("c.drawRoundRect(plateRect, corner, corner, paint)") &&
    qrScreen.includes("R.drawable.qr_badge") &&
    qrScreen.includes("val plate = 720f * 0.26f") &&
    qrScreen.includes("val inset = plate * 0.08f") &&
    !qrScreen.includes("R.drawable.icon_gold") &&
    !qrScreen.includes("drawCircle(360f, 360f"),
);
check(
  "the badge glyph is ONE asset shared by web and Android (256px RGBA PNG, sha256-identical)",
  (() => {
    const webPng = bytes("../../web/public/qr-badge.png");
    const resPng = bytes("../../native-android/app/src/main/res/drawable/qr_badge.png");
    const ha = createHash("sha256").update(webPng).digest("hex");
    const hb = createHash("sha256").update(resPng).digest("hex");
    const isPng = (b) => b[0] === 0x89 && b[1] === 0x50;
    const w = webPng.readUInt32BE(16);
    const h = webPng.readUInt32BE(20);
    return isPng(webPng) && ha === hb && w === 256 && h === 256;
  })(),
);

/* 2 — the giant-oval photo on the web QR card --------------------------- */
check(
  "the QR card avatar is a dedicated img class AND its tile establishes a containing block — a stale stylesheet can never blow it up again",
  styles.includes(".profile-qr__avatar {\n  position: relative;") &&
    styles.includes(".profile-qr__avatar-img {") &&
    qrDialog.includes('className="profile-qr__avatar-img"') &&
    !qrDialog.includes('className="avatar-img"'),
);
check(
  "the share landing carries NO extra instruction paragraph (owner 2026-10-21)",
  !userLink.includes("user-link-body") && !styles.includes(".user-link-body {"),
);

/* 3 — the pill must stay glass (top-level echo of the 62/65 chain) ------ */
check(
  "nav pill: pill base lives inside the Haze style as thin tints over a 28dp blur — nothing repaints an opaque fill on top of the blur",
  chatList.includes("backgroundColor = pillBase.copy(alpha = 0.10f)") &&
    chatList.includes("tints = listOf(HazeTint(pillBase.copy(alpha = 0.16f)))") &&
    chatList.includes("blurRadius = 28.dp") &&
    chatList.includes("fallbackTint = HazeTint(pillBase.copy(alpha = 0.40f))") && // round 120: opacity komao, blur keep
    !chatList.includes(".background(pillFill)") &&
    chatList.includes("import dev.chrisbanes.haze.HazeTint"),
);

/* 4 — the share-card landing: user's photo, public-safe route ----------- */
check(
  "worker answers GET /api/users/card/<handle> for LOGGED-OUT visitors, before the authenticated gate",
  (() => {
    const route = worker.indexOf("users\\/card\\/");
    const gate = worker.indexOf("/* ---------- authenticated ---------- */");
    return route > 0 && gate > 0 && route < gate;
  })(),
);
check(
  'the card route is IP-rate-limited, returns null for private profiles, and ships the photo only for an "everyone" avatar',
  worker.includes("rateLimitGlobal(db, `usercard:${clientIp(request)}`, 120)") &&
    worker.includes(
      "if (!row || Number(row.private_profile ?? 0) !== 0) return json({ user: null });",
    ) &&
    worker.includes(
      "privAllows(row.priv_avatar, PRIVACY_DEFAULTS.avatar, {}) ? row.avatar_url : null",
    ),
);
check(
  "the card payload is identity-only: no user id, no presence, no private fields cross the session wall",
  (() => {
    const segment = worker.slice(
      worker.indexOf("usercard:"),
      worker.indexOf("/* ---------- authenticated ---------- */"),
    );
    return (
      segment.includes("displayName:") &&
      segment.includes("username:") &&
      !segment.includes("id:") &&
      !segment.includes("onlineNow") &&
      !segment.includes("last_active_at")
    );
  })(),
);
check(
  "the live host is a federated edge: the card route is excluded from the core proxy so it answers locally",
  worker.includes(
    "const edgeOwnsShareCard = /^\\/api\\/users\\/card\\/[a-z0-9_]{3,30}$/.test(edgePath);",
  ) && worker.includes("edgeRelayRoute || edgeOwnsApk || edgeOwnsCalls || edgeOwnsShareCard"),
);
check(
  "the landing card shows the user's photo (logo only as fallback), the name, and keeps the @handle",
  userLink.includes("/api/users/card/") &&
    userLink.includes('className="user-link-avatar"') &&
    userLink.includes("displayName || `@${handle}`") &&
    userLink.includes('className="user-link-logo"') &&
    userLink.includes("externalApiOrigin"),
);
check(
  "a verified App Link still resolves to the 1:1 chat directly (chat/<convId>) — the owner's 'direct oi chat open hobe'",
  kpApp.includes('Api.get("/api/users/username/"') &&
    kpApp.includes('nav.navigate("chat/$convId")'),
);

/* 5 — brand cache-bust everywhere --------------------------------------- */
check(
  "favicon, in-app header logos, auth screen and PWA manifest all carry the ?v=3.9.216 bust so stale SW caches die",
  indexHtml.includes('href="/logo.png?v=3.9.216"') &&
    manifest.includes('"src": "/logo.png?v=3.9.216"') &&
    appTsx.includes('"/logo.png?v=3.9.216"') &&
    authScreen.includes('"/logo.png?v=3.9.216"') &&
    convList.includes('"/logo.png?v=3.9.216"') &&
    userLink.includes('"/logo.png?v=3.9.216"'),
);

let broken = 0;
for (const line of lines) {
  if (line.includes("BROKEN")) broken++;
}
console.log(lines.join("\n"));
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
if (broken) process.exit(1);
