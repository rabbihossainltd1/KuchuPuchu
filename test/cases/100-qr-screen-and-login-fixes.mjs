// Owner round 33 — the four things the owner named on 2026-10-18:
//
//   1. The Android QR screen was cut off at the bottom, the "My code / Scan"
//      switch was huge, the QR panel had no visible border, the scanner had
//      no frame at all, and the app carried leftover filler.
//   2. The Web's hero banner did not load.
//   3. The Web's phone-number form had no way back to the QR login.
//   4. The Web's country <select> showed a white dropdown with invisible
//      options.
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
const SCAN_ACTIVITY = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/KpScanActivity.kt",
);
const SCAN_LAYOUT = read("native-android/app/src/main/res/layout/kp_scan_capture.xml");
const MANIFEST = read("native-android/app/src/main/AndroidManifest.xml");
const THEMES = read("native-android/app/src/main/res/values/themes.xml");
const WELCOME = read("web/src/auth/WelcomePage.tsx");
const AUTH = read("web/src/auth/AuthScreen.tsx");
const AUTH_CSS = read("web/src/auth/authStyles.css");

/* ------------------------------------------------------------- Android ---- */
{
  const tabRow = QR.slice(QR.indexOf('QrTabButton("My code"'), QR.indexOf('QrTabButton("Scan"'));
  check(
    "the My code / Scan switch is a compact control, not a full-width row",
    QR.includes('QrTabButton("My code", Icons.Filled.QrCode, tab == 0) { tab = 0 }') &&
      QR.includes('QrTabButton("Scan", Icons.Filled.QrCodeScanner, tab == 1) { tab = 1 }') &&
      !tabRow.includes("weight(1f)") &&
      !/Row\(\s*Modifier\s*\.fillMaxWidth\(\)[\s\S]{0,200}QrTabButton/.test(QR),
    tabRow,
  );
  check(
    "the tab buttons are a fixed, small size",
    QR.includes("fontSize = 12.5.sp") && QR.includes(".size(15.dp)"),
  );
  // Owner round 34: the switch is centred and reads like a nav bar.
  check(
    "the switch is CENTRED at the top of the screen (owner round 34)",
    /Box\(\s*\n\s*Modifier\.fillMaxWidth\(\)[\s\S]{0,200}contentAlignment = Alignment\.Center/.test(
      QR,
    ) && !QR.includes(".padding(start = 16.dp, top = 2.dp, bottom = 6.dp)"),
  );
  check(
    "each tab carries an icon next to its label (nav-bar look)",
    QR.includes("Icon(icon, contentDescription = null, tint = tint") &&
      QR.includes("Icons.Filled.QrCode") &&
      QR.includes("Icons.Filled.QrCodeScanner"),
  );
  check(
    "the My code pane scrolls, so nothing is cut off at the bottom",
    QR.includes(".verticalScroll(rememberScrollState())"),
  );
  check(
    "the QR panel has a visible border",
    QR.includes(".border(2.dp, ActionBlueDeep, RoundedCornerShape(18.dp))"),
  );
  check(
    "an account with no share code mints one instead of spinning for ever",
    QR.includes('Api.post("/api/users/me/qr-code/reset")') &&
      QR.includes("var loadError") &&
      QR.includes("Try again"),
  );
  check(
    "the leftover filler under the reset button is gone",
    !QR.includes("The old code stops working the moment you reset it."),
  );
  check(
    "the scanner is locked to portrait, so the phone is never turned over",
    QR.includes(".setOrientationLocked(true)") && !QR.includes(".setOrientationLocked(false)"),
  );
  check(
    "the scanner runs in our own capture activity (the one with the frame)",
    QR.includes(".setCaptureActivity(KpScanActivity::class.java)"),
  );
  check(
    "the scan pane itself carries a border",
    QR.includes(".border(2.dp, ActionBlueDeep, RoundedCornerShape(20.dp))"),
  );
  check(
    "the capture activity replaces the layout with ours",
    SCAN_ACTIVITY.includes("class KpScanActivity : CaptureActivity()") &&
      SCAN_ACTIVITY.includes("R.layout.kp_scan_capture"),
  );
  check(
    "the capture layout draws a frame over the camera",
    SCAN_LAYOUT.includes("com.journeyapps.barcodescanner.DecoratedBarcodeView") &&
      SCAN_LAYOUT.includes("KpScanFrameView") &&
      SCAN_LAYOUT.includes("zxing_framing_rect_width"),
  );
  check(
    "the capture activity is registered and locked to portrait",
    MANIFEST.includes('android:name=".KpScanActivity"') &&
      MANIFEST.includes('android:screenOrientation="portrait"'),
  );
  check(
    "the scanner window carries the brand's viewfinder colours",
    THEMES.includes("Theme.KuchuPuchu.Scan") && THEMES.includes("zxing_viewfinder_mask"),
  );
}

/* ----------------------------------------------------------------- Web ---- */
{
  const heroMatch = WELCOME.match(/src="(\/[^"]*banner[^"]*)"/);
  check(
    "the hero banner points at a file that actually exists",
    !!heroMatch && existsSync(`web/public${heroMatch[1]}`),
    heroMatch ? heroMatch[1] : "no banner src found",
  );
  check(
    "the hero no longer points at the file that never existed",
    !WELCOME.includes('src="/hero-illustration.jpg"'),
  );
  check(
    "the phone-number form has a way back to the QR login",
    AUTH.includes("function switchToQr()") &&
      AUTH.includes("onClick={switchToQr}") &&
      AUTH.includes("Sign in with a QR code instead"),
  );
  check(
    "going back to the QR panel really returns to the QR flow",
    AUTH.includes('setFlow({ kind: "qr" })'),
  );
  check(
    "the country select declares a dark colour-scheme",
    AUTH_CSS.includes(".auth-select {") && AUTH_CSS.includes("color-scheme: dark"),
  );
  check(
    "the country options carry their own colours (white-on-white is fixed)",
    AUTH_CSS.includes(".auth-select option") &&
      /\.auth-select option[\s\S]{0,200}color:\s*#edf3fc/.test(AUTH_CSS),
  );
  check("the country field uses that class", AUTH.includes('className="auth-input auth-select"'));
}

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
