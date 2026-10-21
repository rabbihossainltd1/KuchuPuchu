// 108 — the owner's 2026-10-20 round, four jobs in one:
//
//   1. The web's QR card now draws the app icon on a white plate in the
//      middle of the code, exactly like WhatsApp's (H error correction
//      carries the covered modules). The phone's QrScreen does the same.
//   2. The home nav pill's background card is real frosted glass (Haze
//      samples the scaffold's own content — the old OS cross-window blur
//      flags were ignored on most OEMs and on Android 15 in pop-up windows).
//   3. https://kuchupuchu.web.app IS the public web: Firebase Hosting serves
//      the same PWA build, and the CI workflow redeploys it on every web
//      change. The API stays on the Cloudflare worker (bearer + CORS were
//      already cut for this).
//   4. The profile share link is https://kuchupuchu.web.app/@handle; Android
//      hands it to the app through verified App Links (assetlinks.json ships
//      the v274-line signer fingerprint), the app resolves the handle to the
//      1:1 chat; the browser fallback shows a branded open/download page
//      instead of a 404.
//
// Runtime proof lives elsewhere: web/e2e-messaging/info.spec.ts pins the
// drawn canvas + the copied pretty link; the Kotlin compile/lint gates in CI
// prove the phone side. These checks pin the pieces text can pin.

import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const qrScreen = read("../../native-android/app/src/main/java/app/kuchupuchu/android/QrScreen.kt");
const chatList = read(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
);
const kpApp = read("../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt");
const mainAct = read(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
);
const manifest = read("../../native-android/app/src/main/AndroidManifest.xml");
const gradle = read("../../native-android/app/build.gradle.kts");
const firebaseCfg = read("../../firebase.json");
const firebaserc = read("../../.firebaserc");
const workflow = read("../../.github/workflows/firebase-hosting.yml");
const dialog = read("../../web/src/messaging/ProfileQrDialog.tsx");
const router = read("../../web/src/router.ts");
const app = read("../../web/src/App.tsx");
const userLinkPath = new URL("../../web/src/site/UserLinkPage.tsx", import.meta.url);
const userLink = existsSync(userLinkPath) ? readFileSync(userLinkPath, "utf8") : "";
const api = read("../../web/src/api.ts");

/* --------------------------- 1 · QR with the brand badge ------------------ */

check(
  "the phone's QR is drawn H-ECC with the brand mark on a center plate (WhatsApp-style)",
  qrScreen.includes("EncodeHintType.ERROR_CORRECTION") &&
    qrScreen.includes("ErrorCorrectionLevel.H") &&
    qrScreen.includes("R.drawable.icon_gold") &&
    qrScreen.includes("drawCircle(360f, 360f, plate, paint)"),
);

check(
  "the web's QR card draws the same badge: canvas, H-ECC, white plate, /logo.png",
  dialog.includes('errorCorrectionLevel: "H"') &&
    dialog.includes("drawQrWithBadge(canvas, qrPayload(code))") &&
    dialog.includes('logo.src = "/logo.png"') &&
    dialog.includes("ctx.arc(cx, cy, plate, 0, Math.PI * 2)"),
);

/* ----------------------- 2 · the frosted-glass nav pill -------------------- */

check(
  "the home pill's card is Haze-frosted scaffold content, not an OS flag ask",
  gradle.includes('"dev.chrisbanes.haze:haze:1.7.3"') &&
    chatList.includes(".hazeEffect(state = hazeState)") &&
    kpApp.includes("val homeNavHazeState = remember { dev.chrisbanes.haze.HazeState() }") &&
    kpApp.includes(".haze(state = homeNavHazeState)") &&
    kpApp.includes("hazeState = homeNavHazeState,"),
);

check(
  "the dialog-window pill machinery is gone for good (no cross-window blur begging left)",
  !chatList.includes("HomeNavPillDialog") &&
    !chatList.includes("setNavPillWindowBlur") &&
    !chatList.includes("setBackgroundBlurRadius") &&
    !chatList.includes("pillWindowBackground") &&
    chatList.includes("visible = dialogAttached"),
);

/* -------------------- 3 · kuchupuchu.web.app is the public web ------------- */

check(
  "firebase.json: the SPA catches **, assetlinks maps onto a non-dot twin, the site is kuchupuchu, vintoxbd can frame it",
  firebaseCfg.includes('"site": "kuchupuchu"') &&
    firebaseCfg.includes('"source": "**"') &&
    firebaseCfg.includes('"destination": "/index.html"') &&
    firebaseCfg.includes('"source": "/.well-known/assetlinks.json"') &&
    firebaseCfg.includes('"destination": "/assetlinks.json"') &&
    firebaseCfg.includes("https://vintoxbd.online https://www.vintoxbd.online"),
);

check(
  ".firebaserc names the kuchupuchuff2026 project (firebase deploy --only hosting needs no interactive login)",
  firebaserc.includes('"kuchupuchuff2026"'),
);

check(
  "the CI workflow publishes web.app on every web change with the FIREBASE_SERVICE_ACCOUNT secret",
  workflow.includes("npm run build:web:firebase") &&
    workflow.includes("firebase") &&
    workflow.includes("deploy --only hosting") &&
    workflow.includes("secrets.FIREBASE_SERVICE_ACCOUNT") &&
    workflow.includes("branches: [main]"),
);

check(
  "the PWA still detects the web.app host itself and talks to the worker API (runtime fallback beside VITE_KP_API_ORIGIN)",
  api.includes('host.endsWith(".web.app")') && api.includes('host.endsWith(".firebaseapp.com")'),
);

/* --------------- 4 · /@handle pretty links + verified App Links ------------ */

check(
  "assetlinks.json ships the v274-line signer fingerprint for app.kuchupuchu.android, twin copies byte-identical",
  (() => {
    const a = new URL("../../web/public/.well-known/assetlinks.json", import.meta.url);
    const b = new URL("../../web/public/assetlinks.json", import.meta.url);
    if (!existsSync(a) || !existsSync(b)) return false;
    const ta = readFileSync(a, "utf8");
    const tb = readFileSync(b, "utf8");
    return (
      ta === tb &&
      ta.includes("app.kuchupuchu.android") &&
      ta.includes("delegate_permission/common.handle_all_urls") &&
      ta.includes(
        "4E:3C:89:25:D2:1E:BA:B9:4D:E0:9F:94:AE:58:95:51:CB:CE:A6:14:8B:99:39:43:14:25:27:CC:6A:54:86:C4",
      )
    );
  })(),
);

check(
  "the share/copy link is the pretty handle URL while the code inside the QR keeps its resettable token",
  qrScreen.includes('return "https://kuchupuchu.web.app/@$handle"') &&
    qrScreen.includes("private fun kpShareLink(username: String, qrCode: String)") &&
    qrScreen.includes('"kuchupuchu://user/$qrCode"') && // the QR payload, untouched
    dialog.includes("return `https://kuchupuchu.web.app/@${handle}`;") &&
    dialog.includes("function qrPayload(code: string)"),
);

check(
  "Android verifies App Links for the web.app/@ and firebaseapp.com/@ hosts, regex-gated lowercase slugs",
  manifest.includes('android:autoVerify="true"') &&
    manifest.includes('android:host="kuchupuchu.web.app"') &&
    manifest.includes('android:pathPrefix="/@"') &&
    mainAct.includes("pendingUserHandle") &&
    mainAct.includes('Regex("^[a-z0-9_]{3,30}$")'),
);

check(
  "KpApp turns an opened handle into the 1:1 chat (lookup by username -> create-or-reuse -> navigate)",
  kpApp.includes(
    'Api.get("/api/users/username/" + java.net.URLEncoder.encode(handle, "UTF-8"), true)',
  ) &&
    kpApp.includes('Api.post("/api/conversations", org.json.JSONObject().put("userId", id))') &&
    kpApp.includes("ScreenStore.convIdForUser[id] = convId") &&
    kpApp.includes('nav.navigate("chat/$convId")'),
);

check(
  "the browser fallback: /@handle routes to a branded page that offers the app intent and the APK, never a 404",
  router.includes('{ kind: "user-link"; handle: string }') &&
    router.includes("return `/@${route.handle}`;") &&
    app.includes('route.kind === "user-link"') &&
    app.includes("<UserLinkPage") &&
    userLink.includes("intent://kuchupuchu.web.app") &&
    userLink.includes("package=app.kuchupuchu.android") &&
    userLink.includes("href={APK_URL}") &&
    userLink.includes("Open KuchuPuchu Web"),
);

/* ------------------------------ the verdict ------------------------------- */

let broken = 0;
for (const line of lines) {
  if (line.includes("BROKEN")) broken++;
}
console.log(lines.join("\n"));
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
if (broken) process.exit(1);
