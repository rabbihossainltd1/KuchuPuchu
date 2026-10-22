// Round 124 (owner 2026-10-22 r7 item 2): owner sees the canned AI_REPLY_FALLBACK
// line "bar bar" despite BOTH live scripts' CF settings listing an `ai` binding
// (+edge GEMINI secret). Prove the instrument exists: a diag route that names
// the answering script + lane truthiness, and both dead lines carry that tag;
// diag stays pre-auth so the sandbox can read the live core's lanes.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const edgeToml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
const coreToml = readFileSync(new URL("../../wrangler.kuchupuchu-preview.toml", import.meta.url), "utf8");
const chat = readFileSync(
  new URL("../../native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt", import.meta.url),
  "utf8",
);
const pill = readFileSync(
  new URL("../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt", import.meta.url),
  "utf8",
);
const app = readFileSync(
  new URL("../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt", import.meta.url),
  "utf8",
);

const lines = [];
const check = (label, ok) => lines.push(`  ${ok ? "OK      " : "BROKEN  "} ${label}`);

const diagIdx = src.indexOf('if (path === "/api/ai/diag" && method === "GET")');
const healthIdx = src.indexOf('if (path === "/api/health")');
check("AI diag route exists and sits before /api/health (pre-auth, same fence)", diagIdx > 0 && healthIdx > diagIdx);
check(
  "diag answers self + both lane booleans, never values",
  /path === "\/api\/ai\/diag"[\s\S]{0,400}self: env\.KP_SELF[\s\S]{0,200}gemini: !!env\.GEMINI_API_KEY[\s\S]{0,200}workersAi: !!env\.AI/.test(src),
);
const fallbackSite = src.indexOf("AI_REPLY_FALLBACK + aiDiagTag(env)");
const downSite = src.indexOf("AI_REPLY_DOWN + aiDiagTag(env)");
check("both AI dead lines carry the aiDiagTag fingerprint", fallbackSite > 0 && downSite > 0);
check("aiDiagTag names script + gemini + ai truthiness", /function aiDiagTag[\s\S]{0,300}g\$\{env\.GEMINI_API_KEY \? 1 : 0\} a\$\{env\.AI \? 1 : 0\}/.test(src));
check('edge deploy tags itself KP_SELF = "edge"', /\[vars\]\nKP_SELF = "edge"/.test(edgeToml));
check('core auto-build tags itself KP_SELF = "core"', /\[vars\]\nKP_SELF = "core"/.test(coreToml));

// Item 6: send = ONE sound (tap), zero sent-whoosh, zero send haptic.
check("chat send never plays the sent ack sound anywhere", !/KpSounds\.sent\(ctx\)/.test(chat));
check("the tap send sound survives (single sound)", (chat.match(/KpSounds\.send\(ctx\)/g) || []).length >= 4);
const sendBlock = chat.match(/onSend = \{ requestAttachExit \{[\s\S]{0,900}?showAttach = false[\s\S]{0,120}sendText/);
check("send tap carries no haptic call", !!sendBlock && !/haptics\./.test(sendBlock[0]));
check("photo/sticker special sounds kept (owner r21 set)", /KpSounds\.photoSend\(ctx\)/.test(chat));

// Item 3: maximum-frost pill (96dp blur, dense uniform tint, near-solid fallback).
const pillBlock = pill.match(/hazeEffect\(state = hazeState\) \{[\s\S]{0,2600}?\},\n\s+\)/);
check(
  "pill is at maximum frost: 96dp blur + 0.20/0.34 tint + 0.96 fallback",
  !!pillBlock &&
    /blurRadius = 96\.dp/.test(pillBlock[0]) &&
    /pillBase\.copy\(alpha = 0\.20f\)/.test(pillBlock[0]) &&
    /pillBase\.copy\(alpha = 0\.34f\)/.test(pillBlock[0]) &&
    /alpha = 0\.96f/.test(pillBlock[0]),
);

// Item 4: friend share-link — retry + profile fallback + reason-tagged toasts.
check("share-link open tags every failure stage", /linkFailReason = "lookup"/.test(app) && /linkFailReason = "chat create"/.test(app));
check("conversation create retries once then falls back to the profile", /kotlinx\.coroutines\.delay\(700\)[\s\S]{0,900}nav\.navigate\("profile\/\$id"\)/.test(app));
check("self 400 path still returns true (r121 self-route intact)", /selfCursor\.status == 400\) null else/.test(app));

let broken = 0;
for (const l of lines) {
  console.log(l);
  if (l.includes("BROKEN")) broken++;
}
if (broken) {
  console.error(`case124: ${broken} broken`);
  process.exit(1);
}
console.log(`case124: ${lines.length}/${lines.length} OK`);
