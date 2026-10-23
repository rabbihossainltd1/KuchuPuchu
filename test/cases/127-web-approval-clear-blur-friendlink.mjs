// Round 127 (owner 2026-10-23, round 9 — four items, fixes that REVISIT r126):
//  c. Web AuthScreen still carried approval-era copy ("Waiting for approval
//     from a signed-in KuchuPuchu device…") and a visible "Cancel sign-in
//     request" button — both removed; the OTP/code wording is the only story.
//  b. The nav pill read as OPACITY, not blur — because r126's 0.80 opaque
//     backing smothered the glass. Backing OUT; real Haze blur (24dp) with
//     light tints; non-RenderEffect devices still get the 0.88 slab.
//  d. THE REAL friend-link bug: the resolver effect keyed on `userHandle`
//     nulled the pending flow FIRST — restarting/cancelling ITSELF before the
//     lookup ever ran. App opened, nothing happened, since round 120. The
//     pending flow now clears LAST, after navigate/toast. Handles are also
//     lowercased before the gate regex (mixed-case @Rahimm links used to die
//     silently in MainActivity).
//  a. AI: the canned line comes from the STALE Vintox comm-core — every
//     /api/ai/* call proxies there. The owner's own GEMINI key is now set on
//     the EDGE secret store (diag gemini:true verified live 2026-10-23) and
//     the runbook carries the exact two Vintox ops steps. Only his account
//     can flip the core.
import { readFileSync, existsSync } from "node:fs";

const login = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const webAuth = readFileSync(new URL("../../web/src/auth/AuthScreen.tsx", import.meta.url), "utf8");
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
const manifest = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
    import.meta.url,
  ),
  "utf8",
);
const doc = existsSync(new URL("../../docs/ai-core-brain-2026-10-22.md", import.meta.url))
  ? readFileSync(new URL("../../docs/ai-core-brain-2026-10-22.md", import.meta.url), "utf8")
  : "";

const lines = [];
const check = (label, ok) => lines.push(`  ${ok ? "OK      " : "BROKEN  "} ${label}`);

// c — web approval-era surfaces wiped
check(
  "web sign-in: no 'Waiting for approval…' line, no visible Cancel button, no dead handler",
  !webAuth.includes("Waiting for approval from a signed-in") &&
    !webAuth.includes("Cancel sign-in request") &&
    !webAuth.includes("async function cancelApproval") &&
    !webAuth.includes("Use approval from a signed-in") &&
    webAuth.includes("the code is in the security message there") &&
    webAuth.includes("Start again to get one"),
);

// b — true blur, no smothering backing
check(
  "pill: r126's 0.80 opaque backing is GONE (no .background(pillBase.copy(alpha = 0.80f)) anywhere)",
  !pill.includes(".background(pillBase.copy(alpha = 0.80f))"),
);
const pillBlock = pill.match(/hazeEffect\(state = hazeState\) \{[\s\S]{0,4200}?\},\n\s+\)/);
check(
  "pill: real defocused blur (24.dp) + light 0.26 tint + 0.88 fallback slab",
  !!pillBlock &&
    /blurRadius = 24\.dp/.test(pillBlock[0]) &&
    /tints = listOf\(HazeTint\(pillBase\.copy\(alpha = 0\.26f\)\)\)/.test(pillBlock[0]) &&
    /fallbackTint = HazeTint\(pillBase\.copy\(alpha = 0\.88f\)\)/.test(pillBlock[0]),
);

// d — the self-cancelling effect, fixed
check(
  "friend link: pending handle clears LAST (clearPendingHandle after navigate/toast), never inside the run",
  app.includes("val clearPendingHandle = { MainActivity.pendingUserHandle.value = null }") &&
    !/handle\.isNullOrBlank\(\) \|\| !authed \|\| !meReady\) return@LaunchedEffect\n\s*MainActivity\.pendingUserHandle\.value = null/.test(
      app,
    ) &&
    /clearPendingHandle\(\)\n\s*\}/.test(app),
);
check(
  'friend link: retry + popUpTo("main") nav shape kept from r126',
  /kotlinx\.coroutines\.delay\(600\)/.test(app) &&
    app.includes('nav.navigate("chat/$convId") { popUpTo("main"); launchSingleTop = true }'),
);
check(
  "share-link intake: handle lowercased before the gate regex (mixed-case links work)",
  /removePrefix\("@"\)\.lowercase\(\)/.test(manifest),
);

// a — AI: key provisioned + ops runbook exact
check(
  "AI: runbook tells the owner the two Vintox steps (GEMINI_API_KEY secret + main redeploy) and the diag check",
  doc.includes("GEMINI_API_KEY") && /wrangler (secret put|deploy)/.test(doc),
);
check(
  "Android login already code-only (unchanged by this round)",
  login.includes("/api/auth/login/otp") && !login.includes("APPROVAL_WAIT_MS"),
);

let broken = 0;
for (const l of lines) {
  console.log(l);
  if (l.includes("BROKEN")) broken++;
}
if (broken) {
  console.error(`case127: ${broken} broken`);
  process.exit(1);
}
console.log(`case127: ${lines.length}/${lines.length} OK`);
