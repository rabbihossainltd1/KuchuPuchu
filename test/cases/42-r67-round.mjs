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

/* ---------------- 1. one slim bar, everything in sync ---------------- */
{
  const attach = main("AttachSheet.kt");
  check("r67-1: the selection bar has ONE height constant", attach.includes("val barH = 40.dp"));
  check(
    "r67-1: the caption pill is that height (it was 52 dp) and its radius follows it",
    attach.includes(".height(barH)") &&
      attach.includes("RoundedCornerShape(barH / 2)") &&
      !attach.includes(".height(52.dp)"),
  );
  check(
    "r67-1: the view-once seat is pinned INSIDE the pill (barH - 8) so it cannot set the height",
    attach.includes(".size(barH - 8.dp)") && attach.includes("CenteredOnceIcon(barH - 8.dp,"),
  );
  check(
    "r67-1: the send circle is the same height as the pen and the pill",
    attach.includes("Modifier.size(barH + 4.dp)") && attach.includes(".size(barH)\n"),
  );
  check(
    "r67-1: the slimmer bar's glyph and badge came down with it (20 dp / 16 dp)",
    attach.includes(
      'contentDescription = "Send",\n                                    tint = ActionBlueInk,\n                                    modifier = Modifier.size(20.dp),',
    ) && attach.includes(".size(16.dp)"),
  );
  check(
    "r67-1: the 50% ground stays on the pill and the pen",
    (attach.match(/Color\(0x80000000\)/g) || []).length >= 2,
  );
}

/* ---------------- 3. one message = one flight ---------------- */
{
  const chat = main("ChatScreen.kt");
  const fx = main("ChatFx.kt");
  check(
    "r67-3: the flight is claimed once per STABLE key (clientId, else the server id)",
    fx.includes("object FxFlights") &&
      fx.includes("fun claim(key: String): Boolean") &&
      fx.includes("if (claimed.containsKey(key)) return false") &&
      chat.includes('val fxKey = m.optString("clientId").ifBlank { m.optString("id") }'),
  );
  check(
    "r67-3: that claim IS the arrival animation (no per-composition re-decision)",
    chat.includes("val fxFresh = remember { fxBorn && FxFlights.claim(fxKey) }"),
  );
  check(
    "r67-3: the SENDING echo is eligible now — the old `!pendingEcho` exclusion is gone from the birth predicate",
    !chat.includes("val liveBorn = !pendingEcho &&") &&
      chat.includes("val fxBorn =") &&
      chat.includes(
        'mine -> live\n                else -> live || FxArrivals.mark(m.optString("id")) != null',
      ),
  );
  check(
    "r67-3: v205/v207 survive — the emoji glyph plays on a live birth that is no longer a sending echo",
    chat.includes("val fxEmoji = fxBorn && !pendingEcho && fxScaleOf(ctx) > 0f") &&
      (
        chat.match(
          /EmojiGlyphRow\((?:st, 56f|m\.optText\("body"\)\.trim\(\), (?:40|66)f), fxEmoji,/g,
        ) || []
      ).length === 3,
  );
  check(
    "r67-3: the echo block and the thread block are the same kind of item (same key + content type)",
    chat.includes(
      'contentType = { it.optString("kind") },\n                ) { m ->\n                    Column {',
    ) &&
      (
        chat.match(
          /key = \{ it\.optString\("clientId"\)\.ifBlank \{ it\.optString\("id"\) \} \},/g,
        ) || []
      ).length >= 2,
  );
  check(
    "r67-3: the swap still pre-marks the server id, so the painted row takes the seat silently",
    chat.includes("FxArrivals.markSeen(id)"),
  );
}

/* ---------------- 4. reactions: both phones, every tap ---------------- */
{
  const emo = main("EmojiAnim.kt");
  const feel = main("Feel.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r67-4: a rapid tap is no longer swallowed — the local 300 ms gate is gone",
    !emo.includes("lastTapMs") && emo.includes("replayKey++"),
  );
  check(
    "r67-4: BOTH sides buzz — the tap and the replay that arrives from the other phone",
    emo.includes("fun replay(local: Boolean)") &&
      emo.includes("haptics.reaction()") &&
      emo.includes("if (isSingle) replay(local = true) else haptics.tap()"),
  );
  check(
    "r67-4: that buzz has its own vocabulary (CONFIRM on 30+, virtual key below)",
    feel.includes("fun reaction()") &&
      feel.includes("performHapticFeedback(HapticFeedbackConstants.CONFIRM)"),
  );
  check(
    "r67-4: the worker no longer dampens a repeated tap — every tap fans out to the room",
    !worker.includes("fxLastAt") &&
      !worker.includes("dampened: true") &&
      worker.includes("rateLimit(`fx:${uid}`, 80, 180)"),
  );
}

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
