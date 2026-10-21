// 107 — profile QR on web: the phone's per-profile QR button and its "My code"
// card, on the web (owner 2026-10-19: "web a profile a qr option nai tumi dekho
// app a ki ki option ekhono web a nai segula add kore daw"; the same round
// removed the "People who scan this add you instantly." caption — link Copy /
// Share icons stand in its place).
//
// These checks pin the pieces a browser cannot prove for itself: the peer
// payload carries the share code (parsePeer), the menu + the settings button
// reach the dialog, and the phone's own cutover is pinned too (the caption is
// gone, the link icons are present). Runtime behaviour lives in
// web/e2e-messaging/info.spec.ts (the drawn code, Copy-link-to-clipboard).

import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const proto = read("../../web/src/messaging/protocol.ts");
const dialogPath = new URL("../../web/src/messaging/ProfileQrDialog.tsx", import.meta.url);
const dialog = existsSync(dialogPath) ? readFileSync(dialogPath, "utf8") : "";
const info = read("../../web/src/messaging/InfoPane.tsx");
const settings = read("../../web/src/auth/AccountSettingsPage.tsx");
const qrScreen = read("../../native-android/app/src/main/java/app/kuchupuchu/android/QrScreen.kt");
const icons = read("../../web/src/icons.tsx");
const styles = read("../../web/src/styles.css");

/* ------------------------- the share code reaches the web ----------------- */

check(
  "every peer the browser can profile carries the Worker's QR share code",
  proto.includes("qrCode?: string | null;") &&
    proto.includes("qrCode: text(value.qrCode, 64) || null,"),
);

/* --------------------------- the card, menu and entry points -------------- */

check(
  "the QR card exists (avatar, name, @username, the code, copy/share/reset actions)",
  !dialog.includes('className=".profile-qr__code"') && // the dotted form is a CSS selector, never a JSX class
    dialog.includes('className="profile-qr__code"') &&
    dialog.includes('errorCorrectionLevel: "H"') &&
    dialog.includes("kuchupuchu.web.app/@") &&
    dialog.includes("kuchupuchu://user/${code}") && // the QR payload keeps its reset table token
    dialog.includes("Copy link") &&
    dialog.includes("Share") &&
    dialog.includes("Reset code"),
);
check(
  "a friend's card never mints or resets; own account mints the missing code once (the phone's pane exactly — QrScreen.kt's mint-on-open)",
  dialog.includes("if (code || !self) return;") &&
    dialog.includes("/api/users/me/qr-code/reset") &&
    dialog.includes("This person has no QR code yet.") &&
    dialog.includes("resetCode = useCallback"),
);
check(
  "own account reads the live code first, so opening the card never rotates a working code",
  dialog.includes("authApi.getMe(api)") && dialog.includes(".qrCode ??"),
);
check(
  "the profile menu gains the phone's QR item next to Nicknames (InfoPane)",
  info.includes(">QR code<") &&
    info.includes("setQrOpen(true)") &&
    info.includes("<ProfileQrDialog api={api} user={person} self={false}"),
);
check(
  "own account settings gains the QR button, and opens the card as SELF (mint + reset allowed)",
  settings.includes("QR code") &&
    settings.includes("<ProfileQrDialog") &&
    settings.includes("self={true}"),
);

/* --------------------------- the icons + the look ------------------------- */

check(
  "copy/share/refresh icon glyphs exist for the card's action row",
  icons.includes('| "copy"') && icons.includes('| "share"') && icons.includes('| "refresh"'),
);
check(
  "the card styles land with it (the blue-framed white QR, round action buttons, backdrop modal)",
  styles.includes(".profile-qr__code") &&
    styles.includes(".profile-qr__action-icon") &&
    styles.includes(".profile-qr {"),
);

/* --------------------------- the phone side of the round ------------------- */

check(
  "the outdated 'People who scan this add you instantly.' caption is gone from the drawn UI (owner 2026-10-19)",
  !qrScreen.includes('"People who scan this add you instantly.",') &&
    !/Text\(\s*\n\s*"People who scan this add you instantly/.test(qrScreen),
);
check(
  "the phone's My code pane now offers link icons (Copy + Share) instead of the caption",
  qrScreen.includes("Icons.Filled.ContentCopy") &&
    qrScreen.includes("Icons.Filled.Share") &&
    qrScreen.includes("kuchupuchu://user/$qrCode") &&
    qrScreen.includes('Toast.makeText(ctx, "QR link copied."'),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
