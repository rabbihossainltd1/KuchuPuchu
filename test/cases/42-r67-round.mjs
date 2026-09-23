// r67 — the owner's round after v215 (2026-09-23). Six items, in his order.
// This file pins the parts of each fix that a future edit could silently undo.
//
// 1. attach bar: the caption pill was 52 dp tall and the row around it 40/44/46 —
//    "caption bar onek beshi mota hoye geche eita chikon koro, baki buttons gula
//    eitar sathe sync rekho". One height for the whole bar now (40 dp), and the
//    view-once glyph is pinned to its own (smaller) seat so it cannot push the
//    pill back up. Measured ink, not a claim: the seat is asserted by number.
// 2. notification: an E2EE 1:1 message arrives as an opaque envelope, so the card
//    said the lock. "massage phone a asha matroi decrypt hoye jabe. same as old
//    version" — the push handler now opens the envelope on arrival (a short one
//    straight from the push, a long one from the newest page) and the card is
//    posted with plaintext + Reply still attached.
// 3. one message = ONE animation. "agei place hoye abar animate hoye" — a send
//    used to appear in place (the pending echo) and then re-fly when the server
//    row replaced it. The flight is now claimed ONCE per stable key
//    (clientId-or-id) at birth, and the swap is silent.
// 4. reactions: tap = haptic on BOTH phones, and a rapid tap replays the
//    animation immediately instead of waiting for the running pass to finish.
//    The worker's 3 s dampener is what made the far side miss the repeats.
// 5. attach bar ground: 50% dim black behind caption / send / view-once.
// 6. message tones are mixed 50% lower (one constant, four call sites).
//
// There is no Android SDK in this sandbox, so items 1/2/3/4/6 are pinned as
// source shape (CI's assembleRelease + JVM tests are the behavioural half) —
// same convention as cases 32/34/35/36.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "} ${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (p) => readFileSync(p, "utf8");
const main = (f) => read(`${ANDROID}/${f}`);

/* ---------------- 6. message tones at half volume ---------------- */
{
  const feel = main("Feel.kt");
  check(
    "r67-6: the four message tones multiply by one trim constant",
    feel.includes("private const val MSG_VOLUME_TRIM = 0.5f"),
  );
  const trimmed = feel.match(/0\.(?:6|7|55)f \* MSG_VOLUME_TRIM/g) || [];
  check(
    "r67-6: send (0.60), sent (0.70), in-app (0.70) and receive (0.55) all honour it",
    trimmed.length === 4,
    JSON.stringify(trimmed),
  );
  check(
    "r67-6: no message tone is left at its old hard-coded level",
    !/pool\?\.play\((?:tapSendId|sentId|inAppId|receiveId), (?:0\.6f|0\.7f|0\.55f)/.test(feel),
  );
  check(
    "r67-6: the other event tones (reaction/call/status/screen) keep their levels",
    feel.includes("fun reaction(ctx: Context) = play(ctx, reactionId, 0.7f)") &&
      feel.includes("fun lineBusy(ctx: Context) = play(ctx, lineBusyId, 0.9f)"),
  );
}

console.log(lines.join("\n"));
console.log(
  `r67 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
