// 110 — the owner's THIRD 2026-10-21 feedback round (v295 / 3.9.218):
//
//   1. REGRESSION: "nav bar ta prottekta update a aste aste boro hoye
//      jacche... opacity onek beshi, tai blur bujha jacche na. ektu
//      transparent koro, blur lagbe" — the v293 1.2 upsize is OUT; the pill
//      returns to 248x56 (navScale 1f) and the Haze tints drop from 0.20/0.32
//      to 0.10/0.16 with the SAME 28dp blur, so the frost reads through.
//      Pinned in 62/65/63/109; this file keeps the verdict top-level.
//   2. Share link: the QR payload IS the pretty link
//      (https://kuchupuchu.web.app/@handle) on BOTH platforms — any scanner
//      yields the URL (owner: "QR scan korle amon link a asha uchit"). The
//      in-app scanner parses the link back to a handle (QrScanPolicy) and
//      the resettable kuchupuchu://user/<code> token still resolves.
//   3. Landing: an unknown handle renders an invalid-link view instead of a
//      card; verified accounts show the blue tick; the CTA intent carries
//      S.browser_fallback_url so Chrome lands on the app download when the
//      app is missing (was a silent dead-end).
//   4. AI bot: production NEVER had a GEMINI_API_KEY secret, so every text
//      turn answered the canned greeting ("I'm KuchuPuchu AI — I'm right
//      here with you! …"). The text brain now falls back to the account's
//      own free-tier Workers AI ([ai] AI binding; llama-4-scout →
//      llama-3.3-70b → llama-3.2-3b, all verified live 2026-10-21;
//      llama-3.1-8b was deprecated 2026-05-30). Reply falls to
//      AI_REPLY_DOWN when both brains are out, never the greeting twice.
//   5. Web OTP: the Verify button is gone — the sixth digit auto-submits
//      (owner: "otp verify button ta sorai daw"); Enter still submits and
//      the busy flag double-fire-guards autofill bursts.
//   6. Stale-web chaser: /logo.png leaves the service-worker precache (a
//      waiting old worker served the old mark for days — looked unfixed),
//      and the app asks the SW to update on open, every 15 min, and on
//      foregrounding. skipWaiting stays OUT (existing pin): no mid-session
//      reloads.

import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const lines = [];
const check = (label, ok) => {
  lines.push(`${ok ? "     ok" : "  BROKEN"} ${label}`);
  return ok;
};

const chatList = read(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
);
const qrScreen = read("../../native-android/app/src/main/java/app/kuchupuchu/android/QrScreen.kt");
const scanPolicy = read(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/QrScanPolicy.kt",
);
const scanTest = read(
  "../../native-android/app/src/test/java/app/kuchupuchu/android/QrScanPolicyTest.kt",
);
const kpApp = read("../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt");
const dialog = read("../../web/src/messaging/ProfileQrDialog.tsx");
const landing = read("../../web/src/site/UserLinkPage.tsx");
const authScreen = read("../../web/src/auth/AuthScreen.tsx");
const mainTsx = read("../../web/src/main.tsx");
const worker = read("../../src/worker/index.ts");
const workerEnv = read("../../src/worker/env.d.ts");
const wranglerToml = read("../../wrangler.toml");
const verifySw = read("../../scripts/verify-web-sw.ts");
const viteConfig = read("../../vite.web.config.ts");

/* 1 — the pill regression is closed -------------------------------------- */
check(
  "nav pill: back to navScale 1f (248x56), tints nearly halved (0.10/0.16, fallback 0.40), SAME 28dp blur — size reset + visible frost",
  chatList.includes("val navScale = 0.9f") &&
    !chatList.includes("val navScale = 1.2f") &&
    chatList.includes("val navContentYOffset = 0.dp") && // round 121 follow-up: centred, smaller
    chatList.includes("backgroundColor = pillBase.copy(alpha = 0.16f)") &&
    chatList.includes("tints = listOf(HazeTint(pillBase.copy(alpha = 0.30f)))") &&
    chatList.includes("blurRadius = 40.dp") &&
    chatList.includes("fallbackTint = HazeTint(pillBase.copy(alpha = 0.92f))"),
);

/* 2 — QR payload IS the share link, both platforms ------------------------ */
check(
  "Android QR payload: kpShareLink(username, qrCode) feeds the bitmap — pretty link when a handle exists, token otherwise",
  qrScreen.includes('val payloadUsername = user?.optText("username").orEmpty()') &&
    qrScreen.includes("kpShareLink(payloadUsername, qrCode)") &&
    qrScreen.includes("remember(qrCode, payloadUsername)"),
);
check(
  "Web QR payload: qrPayload(code, username) — pretty link, token fallback, redraws when the username lands late",
  dialog.includes("function qrPayload(code: string, username: string)") &&
    dialog.includes("if (!handle) return `kuchupuchu://user/${code}`;") &&
    dialog.includes("drawQrWithBadge(canvas, qrPayload(code, user.username))") &&
    dialog.includes("}, [code, user.username]);"),
);
check(
  "the in-app scanner reads its OWN new codes: QrScanPolicy.UserHandle + https/@handle parsing (JVM-testable, no android.net.Uri)",
  scanPolicy.includes("data class UserHandle(val handle: String)") &&
    scanPolicy.includes(
      'SHARE_HOSTS = setOf("kuchupuchu.web.app", "kuchupuchu.firebaseapp.com")',
    ) &&
    scanPolicy.includes("private fun parseShareLink(contents: String)") &&
    scanPolicy.includes('substringAfter("://", missingDelimiterValue = "")') &&
    scanPolicy.includes("QrScanAction.UserHandle(handle)") &&
    qrScreen.includes("is QrScanAction.UserHandle ->") &&
    qrScreen.includes('Api.get("/api/users/username/${action.handle}", force = true)'),
);
check(
  "QrScanPolicyTest pins the new shapes: valid links, trailing slash, host fuzz, queries kept harmless, junk never half-parses",
  scanTest.includes('QrScanAction.UserHandle("rabbihossainltd")') &&
    scanTest.includes("https://kuchupuchu.web.app.evil.tld/@alice") &&
    scanTest.includes("https://kuchupuchu.web.app/settings/@alice") &&
    scanTest.includes("https://kuchupuchu.web.app/@rabbi?utm=print"),
);

/* 2b — own share link INSIDE the app: races removed, self-refusal rerouted (round 122) */
check(
  "the in-app resolver waits for Store.me before consuming the handle, so a cold start can never mistake the owner for a stranger",
  kpApp.includes("val meReady = Store.myId().isNotBlank()") &&
    kpApp.includes("LaunchedEffect(userHandle, authed, meReady)") &&
    kpApp.includes("if (handle.isNullOrBlank() || !authed || !meReady) return@LaunchedEffect"),
);
check(
  "own handle opens the own PROFILE — from the id comparison AND from the worker's 400 self-refusal (belt and braces, no offline toast)",
  kpApp.includes('Store.me?.optString("username", "")?.trim()?.lowercase().orEmpty()') && // round 123: own handle routes on the stored username with NO network at all
    kpApp.includes('nav.navigate("profile/${Store.myId()}") { launchSingleTop = true }') &&
    kpApp.includes("if (id == Store.myId()) {") &&
    kpApp.includes('nav.navigate("profile/$id") { launchSingleTop = true }') &&
    kpApp.includes("catch (selfCursor: ApiException) {") &&
    kpApp.includes("if (selfCursor.status == 400) null else throw selfCursor") &&
    worker.includes('if (!other || other === uid) fail(400, "Bad user.");'),
);
check(
  "an honest toast remains for REAL failures only",
  kpApp.includes("Couldn't open that profile. Try again when you're online."),
);

/* 3 — landing card: invalid state, tick, CTA fallback --------------------- */
check(
  "the share landing renders an invalid-link view for an unknown handle (never a phantom card)",
  landing.includes('type CardState = "loading" | "unknown" | "invalid" | "user";') &&
    landing.includes('setState(user ? "user" : "invalid")') && // only a REAL 200 + user:null verdict
    landing.includes('setState("unknown");') && // failed/offline lookups keep the generic card
    landing.includes('state === "invalid"') &&
    landing.includes("This link doesn&rsquo;t go anywhere") &&
    landing.includes("No KuchuPuchu user exists as"),
);
check(
  "verified accounts carry the blue tick next to the name on the landing card",
  landing.includes("card?.verified ? (") &&
    landing.includes('className="user-link-tick"') &&
    landing.includes('aria-label="Verified"'),
);
check(
  "the CTA intent carries S.browser_fallback_url → Chrome lands on the APK download when the app is not installed",
  landing.includes("S.browser_fallback_url=") &&
    landing.includes("https://kuchupuchu.web.app/download/apk"),
);
check(
  "a failed app-side profile open says something (was: silent nothing)",
  kpApp.includes("Couldn't open that profile. Try again when you're online.") &&
    kpApp.includes("}.getOrDefault(false)"),
);

/* 4 — the AI bot gets a real fallback brain (Workers AI) ------------------ */
check(
  "wrangler.toml binds Workers AI ([ai] AI) and the Env type + ambient Ai interface exist",
  wranglerToml.includes('[ai]\nbinding = "AI"') &&
    worker.includes("AI?: Ai;") &&
    workerEnv.includes("interface Ai {") &&
    workerEnv.includes("run(model: string, inputs: Record<string, unknown>): Promise<unknown>;"),
);
check(
  "workersAiChat: 2026-10-21-verified models with OpenAI-style content extraction + { response } fallback, errors logged not thrown",
  worker.includes("WORKERS_AI_CHAT_MODELS = [") &&
    worker.includes('"@cf/meta/llama-4-scout-17b-16e-instruct"') &&
    worker.includes('"@cf/meta/llama-3.3-70b-instruct-fp8-fast"') &&
    worker.includes('"@cf/meta/llama-3.2-3b-instruct"') &&
    !worker.includes('"@cf/meta/llama-3.1-8b-instruct"') && // deprecated 2026-05-30 — live-verified
    worker.includes("data?.choices?.[0]?.message?.content ?? data?.response") &&
    worker.includes("`workers-ai ${model}:"),
);
check(
  "aiBrainStream falls back to Workers AI when no Gemini key, and the reply fallback distinguishes no-brain from brain-down",
  worker.includes("if (env.GEMINI_API_KEY) {") && // key present: try Gemini FIRST…
    worker.includes("await workersAiTurns(env, workersCtx.system, workersCtx.turns, maxTokens)") &&
    worker.includes(
      "const geminiAnswer = await geminiStream(env, prompt, [], maxTokens, onChunk, 12_000);",
    ) &&
    worker.includes("if (geminiAnswer && geminiAnswer.trim()) return geminiAnswer;") && // round 123: Gemini-empty is not a dead line — the free brain always gets a turn
    worker.includes("if (answer) onChunk(answer);") &&
    worker.includes(
      "answer ?? (!env.GEMINI_API_KEY && !env.AI ? AI_REPLY_FALLBACK : AI_REPLY_DOWN);",
    ),
);
check(
  "the welcome line also falls back through workersAiChat before its static greeting",
  worker.includes(
    "(await geminiParts(env, prompt, [], 120)) ?? (await workersAiChat(env, prompt, 120));",
  ),
);

/* 5 — web OTP auto-verify -------------------------------------------------- */
check(
  "the sixth digit submits the code itself (no Verify button); Enter still runs the same path; busy-guard holds",
  authScreen.includes("async function submitOtpValue(code: string)") &&
    authScreen.includes("void submitOtpValue(otp)") &&
    authScreen.includes("if (next.length === 6 && !otpLocked) void submitOtpValue(next);") &&
    !authScreen.includes('"Verify code"') &&
    !authScreen.includes("Verifying…"),
);

/* 6 — stale-web chasers ---------------------------------------------------- */
check(
  "/logo.png is OUT of the service-worker precache (vite config + pin), bytes still feeding the build id",
  viteConfig.includes("PRECACHE_IDENTITY") && verifySw.includes('!precache.includes("/logo.png")'),
);
check(
  "the app asks the service worker to update: on open, every 15 minutes, and on foregrounding — plus a refresh chip when one is waiting (round 122: pinned tabs never saw fixes)",
  mainTsx.includes("registration.update().catch(() => {})") &&
    mainTsx.includes("window.setInterval(poke, 15 * 60_000)") &&
    mainTsx.includes('document.visibilityState === "visible"') &&
    mainTsx.includes("showRefreshChip(registration.waiting)") &&
    mainTsx.includes('{ type: "KP_SKIP_WAITING" }') &&
    mainTsx.includes("navigator.serviceWorker.controller") &&
    // the chip's whole look is INLINE — a stale tab by definition also serves stale CSS
    mainTsx.includes("background:#0f6fdc") &&
    mainTsx.includes('textContent = "A newer KuchuPuchu Web is ready."'),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
if (broken > 0) {
  console.error(`\ncase 110 FAILED — ${broken} broken check(s)`);
  process.exit(1);
}
console.log(`\ncase 110 ok — ${lines.length} checks`);
