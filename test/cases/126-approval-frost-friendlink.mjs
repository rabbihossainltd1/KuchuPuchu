// Round 126 (owner 2026-10-23, round 8 — four items):
//  1. AI still canned → live-probed AGAIN: the comm core is still the stale
//     build (its /api/ai/diag·sw BUILD unchanged), so nothing code-side shifts
//     until the Vintox redeploy (docs/ai-core-brain-2026-10-22.md stays the
//     runbook); the pinned evidence here is the static part of that story.
//  2. Pill "kono blur e nai THIK KORO" → frost is now PAINTED
//     unconditionally: a dense 0.80 navy backing sits UNDER the haze glass —
//     even a device whose blur pipeline never samples can no longer read
//     through. 96dp blur + 0.96 fallback stay on top.
//  3. New-login approval REMOVED → OTP is the single completion path:
//     worker approve/decline → 403 APPROVAL_REMOVED, the security card loses
//     its buttons, the shade loses Decline, the web card loses its actions,
//     and LoginScreen speaks code-only.
//  4. Friend share-link → lookup retries once, and the chat opens through the
//     proven popUpTo("main") nav shape used by the contacts screen.
import { readFileSync, existsSync } from "node:fs";

const w = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const chat = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const login = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const notify = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/KpNotify.kt",
    import.meta.url,
  ),
  "utf8",
);
const manifest = readFileSync(
  new URL("../../native-android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const pill = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const app = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt",
    import.meta.url,
  ),
  "utf8",
);
const webApp = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const docExists = existsSync(new URL("../../docs/ai-core-brain-2026-10-22.md", import.meta.url));

const lines = [];
const check = (label, ok) => lines.push(`  ${ok ? "OK      " : "BROKEN  "} ${label}`);

// 3 — approval removal
check(
  "worker approve + decline routes are 403 corridors (never sessions)",
  /if \(path === "\/api\/auth\/login\/approve" && method === "POST"\) \{\n\s+fail\(\n\s+403,\n\s+"Sign-in approval was removed\./.test(
    w,
  ) &&
    /if \(path === "\/api\/auth\/login\/decline" && method === "POST"\) \{\n\s+fail\(\n\s+403,/.test(
      w,
    ) &&
    (w.match(/APPROVAL_REMOVED/g) || []).length >= 2,
);
check(
  "security alert is a code courier: no login-request id in the push payload",
  !w.includes("kp_login_req:") &&
    w.includes("no login-request id rides the push") &&
    w.includes("the sign-in code is in this chat"),
);
check(
  "OTP completion lane untouched (otp route still mints SESSION, poll/cancel alive)",
  w.includes('if (path === "/api/auth/login/otp" && method === "POST")') &&
    w.includes('if (path === "/api/auth/login/poll" && method === "POST")') &&
    w.includes('if (path === "/api/auth/login/cancel" && method === "POST")') &&
    w.includes('status: "APPROVAL_REQUIRED"'),
);
check(
  "Android security card: buttons gone, code + Copy + passive status line only",
  !chat.includes("/api/auth/login/approve") &&
    !chat.includes("/api/auth/login/decline") &&
    !chat.includes("val canApprove") &&
    chat.includes('contentDescription = "Copy sign-in code"') &&
    chat.includes("Enter this code on the new device to finish signing in."),
);
check(
  "LoginScreen speaks code-only (no approval wording, no 60s give-up timer)",
  !/approval still works/i.test(login) &&
    !login.includes("Waiting for approval in the background") &&
    !login.includes("APPROVAL_WAIT_MS") &&
    login.includes("/api/auth/login/otp") &&
    login.includes("/api/auth/login/poll"),
);
check(
  "shade: no Decline action, no receiver branch, no manifest filter",
  !notify.includes("ACTION_DECLINE_LOGIN") &&
    !notify.includes("declineAction") &&
    !notify.includes("/api/auth/login/decline") &&
    !manifest.includes("NOTIF_DECLINE_LOGIN"),
);
check(
  "classic web card: no approve/decline buttons, no action post",
  !webApp.includes('data-login-action="approve"') &&
    !webApp.includes("/api/auth/login/${action}") &&
    !webApp.includes("actOnLoginApproval(messageId"),
);

// 2 — unconditional frost
const pillBlock = pill.match(/hazeEffect\(state = hazeState\) \{[\s\S]{0,2600}?\},\n\s+\)/);
check(
  "pill paints frost unconditionally: dense 0.80 navy backing under the haze",
  /\.clip\(CircleShape\)\n\s+\.background\(pillBase\.copy\(alpha = 0\.80f\)\)\n\s+\.hazeEffect\(state = hazeState\)/.test(
    pill,
  ),
);
check(
  "maximum glass stack still on top (96dp + uniform tint + 0.96 fallback)",
  !!pillBlock && /blurRadius = 96\.dp/.test(pillBlock[0]) && /alpha = 0\.96f/.test(pillBlock[0]),
);

// 4 — friend share-link hardening
check(
  "friend link: username lookup retries once behind a breath",
  /runCatching \{\s+\n?\s*kotlinx\.coroutines\.withContext\([\s\S]{0,260}users\/username\/[\s\S]{0,260}\}\.getOrNull\(\)\s+if \(data == null\) \{\s+kotlinx\.coroutines\.delay\(600\)/.test(
    app,
  ),
);
check(
  'friend link: chat opens through popUpTo("main") like the contacts screen',
  app.includes('nav.navigate("chat/$convId") { popUpTo("main"); launchSingleTop = true }'),
);
check(
  "stage-tagged toasts + profile fallback stay from round 124",
  app.includes('linkFailReason = "lookup"') &&
    app.includes('linkFailReason = "chat create"') &&
    /kotlinx\.coroutines\.delay\(700\)[\s\S]{0,900}nav\.navigate\("profile\/\$id"\)/.test(app),
);

// 1 — AI: the instrument is live, the runbook exists, no code-side lane changed
check(
  "AI diag probe + fingerprinted dead lines still shipped, runbook documented",
  w.includes('if (path === "/api/ai/diag" && method === "GET")') &&
    w.includes("AI_REPLY_FALLBACK + aiDiagTag(env)") &&
    docExists,
);

let broken = 0;
for (const l of lines) {
  console.log(l);
  if (l.includes("BROKEN")) broken++;
}
if (broken) {
  console.error(`case126: ${broken} broken`);
  process.exit(1);
}
console.log(`case126: ${lines.length}/${lines.length} OK`);
