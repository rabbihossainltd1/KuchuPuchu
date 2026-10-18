// Owner round 34 — the four things the owner named on 2026-10-18 (second
// batch of the day, after the round-33 UI set):
//
//   1. The Android "My code / Scan" switch was still a wide pill hugging the
//      LEFT edge. It is now a small, CENTRED, nav-bar-style segmented
//      control at the top of the screen: an icon + a label per tab.
//   2. On the desktop Web the message bar / bottom row of the chat was cut
//      off at the bottom of the viewport — the composer was pushed below the
//      window and could not be reached. (The grid's implicit row was sized
//      `auto`, so the row grew to the height of the whole message list.)
//   3. The Web's QR panel carried a long "open the app and point it at this
//      code" paragraph. The owner wanted it gone: too much text.
//   4. D1 row writes had to come down, because the Cloudflare free tier's
//      daily row-write limit was being spent and the outage of 2026-10-17
//      was the direct consequence.
//
// This file pins the source of every one of them, so a later round cannot
// quietly undo the fix. It reads the sources; it does not run the UI.

import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

const QR = read("native-android/app/src/main/java/app/kuchupuchu/android/QrScreen.kt");
const QR_PANEL = read("web/src/auth/QrLoginPanel.tsx");
const STYLES = read("web/src/styles.css");
const MESSAGING_CSS = read("web/src/messaging/messaging.css");
const WORKER = read("src/worker/index.ts");

/* ------------------------------------------------- 1. the QR switch ------- */
{
  const switchBlock = QR.slice(QR.indexOf("if (isMe) {"), QR.indexOf("if (!isMe || tab == 0) {"));
  check(
    "the My code / Scan switch is CENTRED (a Box with Alignment.Center)",
    /contentAlignment = Alignment\.Center/.test(switchBlock) &&
      /Box\(\s*Modifier\.fillMaxWidth\(\)/.test(switchBlock),
    switchBlock,
  );
  check(
    "the switch no longer hugs the left edge",
    !switchBlock.includes(".padding(start = 16.dp") && !switchBlock.includes("weight(1f)"),
  );
  check(
    "the switch sits at the TOP of the screen, above the code",
    switchBlock.indexOf("if (isMe) {") < QR.indexOf("AnimatedContent(") &&
      switchBlock.includes(".padding(top = 2.dp"),
  );
  // Owner round 35: the tabs are the owner's own glyphs and carry NO label
  // any more - the switch reads like the app's own nav bar.
  check(
    "each tab is the owner's own icon, with no label (the nav-bar look)",
    QR.includes('QrTabButton(QrMyCodeIcon, "My code", tab == 0)') &&
      QR.includes('QrTabButton(QrScanIcon, "Scan", tab == 1)') &&
      QR.includes("Icon(icon, contentDescription = label, tint = tint"),
  );
  check(
    "the tab buttons are small (one 21dp icon, no label)",
    QR.includes(".size(21.dp)") && !QR.includes("fontSize = 12.5.sp"),
  );
  check(
    "the selected tab is filled with the accent",
    QR.includes("val fill by animateColorAsState(") &&
      QR.includes("targetValue = if (selected) ActionBlueDeep else Color.Transparent,"),
  );
}

/* ------------------------------------- 2. the desktop composer cut off --- */
{
  const workspaceRule = STYLES.slice(
    STYLES.indexOf(".workspace {"),
    STYLES.indexOf(".preview-banner + .workspace {"),
  );
  check(
    "the workspace pins its grid row to the viewport height",
    /grid-template-rows:\s*minmax\(0,\s*1fr\)/.test(workspaceRule),
    workspaceRule,
  );
  check(
    "the chat pane is allowed to shrink (min-height: 0 on the grid item)",
    /\.conversation-pane\s*\{[^}]*min-height:\s*0/.test(STYLES),
  );
  check(
    "the transcript scrolls inside the pane (flex: 1 + min-height: 0)",
    /\.transcript\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/.test(MESSAGING_CSS),
  );
  check(
    "the layout can be measured, not guessed",
    existsSync("scripts/measure-desktop-layout.mjs") &&
      read("scripts/measure-desktop-layout.mjs").includes(".composer"),
  );
}

/* -------------------------------------- 3. the QR instructions are gone --- */
{
  // Comments are stripped first: the file still explains in a comment WHY
  // the paragraph was removed, and that is not the instruction text.
  const qrMarkup = QR_PANEL.replace(/\{[\s\S]*?\}/g, "");
  check(
    "the QR panel no longer explains how to scan (the instruction paragraph is gone)",
    !qrMarkup.includes('className="auth-copy"') &&
      !qrMarkup.includes("point it at this code") &&
      !qrMarkup.includes("open the QR scanner from the Home menu") &&
      !qrMarkup.includes("This browser signs in the moment your phone scans it"),
  );
  check(
    "the QR code itself is still there",
    QR_PANEL.includes("qr-login__frame") && QR_PANEL.includes("qr-login__image"),
  );
  check(
    "the way back to the phone-number form is still there",
    QR_PANEL.includes("Log in with phone number") && QR_PANEL.includes("onUsePhone"),
  );
}

/* ------------------------------------------- 4. the D1 row-write burn ----- */
{
  const backfill = WORKER.slice(
    WORKER.indexOf("const CLIENT_ID_BACKFILL"),
    WORKER.indexOf("const CLIENT_ID_BACKFILL") + 400,
  );
  check(
    "the client_id backfill converges (it no longer re-writes rows forever)",
    backfill.includes("AND json_extract(meta_json, '$.clientId') IS NOT NULL"),
    backfill,
  );
  for (const [table, column, idColumn] of [
    ["auth_devices", "platform", "device_id"],
    ["login_requests", "new_device_platform", "new_device_id"],
    ["recovery_requests", "new_device_platform", "new_device_id"],
  ]) {
    check(
      `the ${table} web-platform backfill converges`,
      new RegExp(
        `UPDATE ${table} SET ${column} = 'WEB' WHERE ${idColumn} LIKE 'web-%'\\s*\\n\\s*AND \\(${column} IS NULL OR ${column} <> 'WEB'\\)`,
      ).test(WORKER),
    );
  }
  check(
    "a quota refusal is never written back into D1",
    WORKER.includes("if (D1_QUOTA_ERROR.test(stack)) return;") &&
      WORKER.includes("await logWorkerError(env, stack);"),
  );
  check(
    "the same failure is logged at most once a minute per isolate",
    WORKER.includes("WORKER_ERROR_LOG_GAP_MS = 60_000") &&
      WORKER.includes("if (now - last < WORKER_ERROR_LOG_GAP_MS) return;"),
  );
  check(
    "only the roomy caps are sampled; the tight anti-brute-force caps stay exact",
    WORKER.includes("const SAMPLED_RATE_LIMIT_CAPS = new Set([60, 90, 120, 300, 600]);") &&
      WORKER.includes("SAMPLED_RATE_LIMIT_CAPS.has(cap)"),
  );
  check(
    "the tight caps (10, 20, 30, 40) are not in the sampled set",
    !/SAMPLED_RATE_LIMIT_CAPS = new Set\(\[[^\]]*\b(10|20|30|40)\b/.test(WORKER),
  );
}

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
