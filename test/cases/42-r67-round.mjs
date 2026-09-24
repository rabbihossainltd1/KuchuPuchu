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
    attach.includes(".size(barH + 4.dp)") && attach.includes(".size(barH)\n"),
  );
  check(
    "r67-1: the slimmer bar's glyph and badge came down with it (20 dp / 16 dp)",
    attach.includes(
      'contentDescription = "Send",\n                                    tint = ActionBlueInk,\n                                    modifier = Modifier.size(20.dp),',
    ) && attach.includes(".size(16.dp)"),
  );
  check(
    // r68-5 collapsed the per-control fills into one capsule, so the count is 1.
    "r67-1/r68-5: the bar still carries the 50% dim (one rounded ground now)",
    (attach.match(/Color\(0x80000000\)/g) || []).length === 1,
  );
}

/* ------- 5. the 50% ground under the bar (r68-5 merged it into one) ------- */
{
  const attach = main("AttachSheet.kt");
  // r67-5's per-seat fills are gone BY DESIGN: r68-5 (owner: "individual
  // background shob buttons mile ektai rounded type background Hobe")
  // replaced all four with a single capsule. This guard therefore checks that
  // the 50% dim still exists exactly ONCE and covers the whole row; the shape
  // of that merge is pinned in case 43.
  check(
    "r67-5/r68-5: the 50% dim survives as ONE ground for the whole bar",
    (attach.match(/Color\(0x80000000\)/g) || []).length === 1 &&
      attach.includes(".background(Color(0x80000000), RoundedCornerShape(barH / 2 + 8.dp))"),
  );
  check(
    "r67-5/r68-5: no control keeps a fill of its own",
    !attach.includes(".background(Color(0x80000000), CircleShape)"),
  );
}

/* ---------------- 2. the card decrypts on arrival ---------------- */
{
  const worker = read("src/worker/index.ts");
  const seal = main("PushSeal.kt");
  const push = main("KpPush.kt");
  check(
    "r67-2: the worker MARKS a sealed push and rides the envelope when it fits the FCM budget",
    worker.includes('...(sealedBody ? { kp_e2ee: "1" } : {})') &&
      worker.includes("...(sealedBody && sealedBody.length <= E2EE_PUSH_ENV_MAX") &&
      worker.includes("const E2EE_PUSH_ENV_MAX = 3_000;"),
  );
  check(
    "r67-2: …and a long envelope is left out rather than truncated",
    worker.includes("const sealedBody = text.startsWith(E2EE_PREFIX) ? text : null;"),
  );
  check(
    "r67-2: the system-drawn fallback card never inks the lock as if it were the message",
    worker.includes('body: preview === E2EE_PREVIEW ? "New message" : preview.slice(0, 120),') &&
      worker.includes('const E2EE_PREVIEW = "\\uD83D\\uDD12";'),
  );
  check(
    "r67-2: the phone opens the envelope on arrival — push-borne first, one bounded fetch otherwise",
    seal.includes("fun plan(kpE2ee: String?, kpEnv: String?, body: String?): Plan") &&
      seal.includes(
        "fun openBounded(ctx: Context, convoId: String, mid: String?, plan: Plan, budgetMs: Long): String?",
      ) &&
      seal.includes("if (plan.envelope != null) return open(ctx, convoId, mid, plan)"),
  );
  check(
    "r67-2: the row is fetched from its own conversation's newest page (the page the chat already loads)",
    seal.includes('runCatching { Api.get("/api/conversations/$convoId/messages") }.getOrNull()'),
  );
  check(
    "r67-2: the handler always posts a card inside the push budget",
    push.includes("PushSeal.openBounded(this, convoId, mid, plan, 3_500L)"),
  );
  check(
    "r67-2: a long message is readable in full from the shade (BigTextStyle, picture case untouched)",
    main("KpNotify.kt").includes("NotificationCompat.BigTextStyle().bigText(body)") &&
      main("KpNotify.kt").includes("NotificationCompat.BigPictureStyle()"),
  );
  check(
    "r67-2: ciphertext and the bare lock can never become the card's text",
    seal.includes(
      'if (plan.sealed && (raw == LOCK || E2eeMsg.isEnvelope(raw))) return "New message"',
    ) && push.includes('PushSeal.cardText(plan, opened, data["body"])'),
  );
  check(
    "r67-2: the foreground badge preview goes through the same judgement (list, not the shade)",
    push.includes(
      'ScreenStore.bumpUnread(convoId, PushSeal.cardText(fgPlan, fgPlain, data["body"]))',
    ),
  );
  check(
    "r67-2: a keyless phone costs no request at all — the key is resolved once, up front",
    seal.includes("val peer = peerKey(ctx, convoId)") &&
      seal.includes("if (peer.isBlank()) return null"),
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
    // r68-6 (owner: "50% 40% kore daw") moves the constant to 0.4; the r67-6
    // guarantee — ONE constant, four call sites, nothing else — is unchanged.
    "r67-6/r68-6: the four message tones multiply by one trim constant",
    /private const val MSG_VOLUME_TRIM = 0\.[45]f/.test(feel),
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
