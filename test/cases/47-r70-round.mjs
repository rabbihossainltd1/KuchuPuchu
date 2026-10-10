// r70 round (owner's list after testing r69). Eleven items confirmed fixed;
// item 4 came back "not fixed" a second time; five are new (12–16).
//
//   13. send/sending/sent + reply: "reply massage send korle first a normal
//       vabe jai tarpor reply massage hisabe jai" — the optimistic echo never
//       carried the quote, so the bubble was born unquoted and BECAME a reply
//       when the server row replaced it. One `replyId` per send, written to
//       the payload AND the echo, for text, photo and file alike (a photo /
//       clip / document reply used to drop the quote entirely and leave the
//       quote bar open behind it).
//   4. the mirrored reaction's animation + buzz (see the second half of this
//       file once the r70 gate lands).
//
// No Android SDK here, so the app half is pinned as source shape; CI's apk job
// (testDebugUnitTest lintDebug) is the compile witness.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "} ${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (p) => readFileSync(p, "utf8");
const main = (f) => read(`${ANDROID}/${f}`);

/* ---------- 13. one replyId per send, written to payload AND echo ---------- */
{
  const chat = main("ChatScreen.kt");
  const echoQuote =
    chat.split('.also { if (replyId != null) it.put("replyTo", replyId) }').length - 1;

  check(
    "r70-13: the text send captures ONE replyId and writes it to the payload and the echo (the echo is what the bubble is born with)",
    chat.includes('val replyId = replyTo?.optString("id")?.takeIf { it.isNotBlank() }') &&
      chat.includes('replyId?.let { payload.put("replyTo", it) }') &&
      chat.includes('// r70-13 (owner: "send sending sent a ekhono problem ache jemon reply') &&
      // r71-20: the once flag rides its own `.also` between them.
      chat.includes(
        '.put("body", body)\n                // r71-20: the echo is a once-text from its first frame — veiled',
      ) &&
      chat.includes(
        '.also { if (replyId != null) it.put("replyTo", replyId) }\n                .put("createdAt", java.time.Instant.now().toString()),',
      ),
  );
  check(
    "r70-13: the old shape is gone — the quote no longer goes on the payload ALONE (that is what made the bubble change shape after landing)",
    !chat.includes(
      'replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }',
    ) &&
      !chat.includes(
        'replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }\n        replyTo = null\n        bornKeys',
      ),
  );
  check(
    "r70-13: photos answer their quote too — echo, live payload and the send-later payload all carry it",
    chat.includes("// r70-13: the quote a photo (or a scheduled photo) is answering") &&
      chat.includes("// r70-13: the photo's own echo carries the quote from frame one.") &&
      chat.includes("// r70-13: the quote rides the payload, so the server row that") &&
      chat.includes("// r70-13: a photo sent for LATER answers its quote too.") &&
      echoQuote >= 6,
  );
  check(
    "r70-13: clips / documents answer their quote too — the uncaptioned arm passes an explicit payload (it used to build its own without the quote), the captioned arm and the send-later payload carry it as well",
    chat.includes("// r70-13: the quote a clip / document (or a scheduled one) is answering") &&
      chat.includes("fun plainPayload() =") &&
      chat.includes(
        "Uploads.sendFile(convId, clientId, name, mime, file, if (clipMeta.length() > 0) clipMeta else docMeta, plainPayload()) { outcome ->",
      ) &&
      chat.includes("// r70-13: the file's own echo carries the quote from frame one.") &&
      chat.includes("// r70-13: the quote a captioned clip is answering."),
  );
  check(
    "r70-13: the reply bar is consumed exactly once per send (every send path clears it through the captured replyId)",
    chat.split("replyTo = null").length - 1 >= 5 &&
      !chat.includes('replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let'),
  );
}

/* ------------- 14. the caption bar: slimmer, longer, lighter ------------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r70-14: the bar is 34 dp (was 40) and the pencil seat rides the SAME constant — no 40 dp literal is left in the row",
    attach.includes("val barH = 34.dp") &&
      attach.includes(".size(barH)") &&
      !attach.includes(".size(40.dp)") &&
      attach.includes(".height(barH)"),
  );
  check(
    "r70-14: it runs almost the whole width — 4 dp of side air (it was 10) — and both grids reserve its real 70 dp of ink",
    attach.includes(".padding(horizontal = 4.dp, vertical = 8.dp)") &&
      (attach.match(/bottom = if \(sel\.isNotEmpty\(\)\) 70\.dp else 4\.dp,/g) || []).length ===
        2 &&
      !attach.includes("76.dp else 4.dp"),
  );
  check(
    "r70-14: the ground is lighter — 40% black, ONE capsule for the whole bar (it was 50%)",
    (attach.match(/Color\(0x99000000\)/g) || []).length === 1 &&
      attach.includes(".background(Color(0x99000000), RoundedCornerShape(barH / 2 + 8.dp))") &&
      !attach.includes("Color(0x80000000)"),
  );
}

/* -------- 15. the pencil seat wears the first ticked item's thumb -------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r70-15: the edit seat shows the FIRST ticked media's own thumbnail (same decode path as the grid), with a smaller pencil over a scrim — never a bare white glyph",
    attach.includes("val editFirst = sel.firstOrNull()") &&
      attach.includes("initialValue = editFirst?.let { ThumbCache.get(it.uri) },") &&
      attach.includes("key1 = editFirst?.uri,") &&
      attach.includes("ThumbDecodeGate.decode(one.uri, ctx, one.isVideo)") &&
      !attach.includes("sel.lastOrNull()?.uri]"),
  );
  check(
    "r70-15: it is still the editor's door — a tap opens the LAST ticked item in the editor, and the pencil is 16 dp (the seat is barH)",
    attach.includes("sel.lastOrNull()?.let(onEdit)") &&
      attach.includes('Icons.Filled.Edit,\n                                "Edit",') &&
      attach.includes("modifier = Modifier.size(16.dp),") &&
      !attach.includes(
        'Icon(Icons.Filled.Edit, "Edit", tint = Color.White, modifier = Modifier.size(20.dp))',
      ),
  );
}

/* ---------- 16 (r71 → r73): no drop shadows, and that is final ---------- */
{
  const app = "native-android/app/src/main/java/app/kuchupuchu/android/";
  const srcs = [
    "CallScreens.kt",
    "CallsTabScreen.kt",
    "ChatListScreen.kt",
    "ChatScreen.kt",
    "MediaEditScreen.kt",
    "ProfileScreen.kt",
  ];
  const withShadow = srcs.filter((f) => readFileSync(app + f, "utf8").includes(".shadow("));
  check(
    'r71-16: the drop shadow the owner rejected ("ekhon je type er shadow ta implement korecho ... ei shadow ta amar ekdomi valo lage na change koro") is GONE from the whole app — bubbles, call buttons, chat list, profile, media editor, and the import too',
    withShadow.length === 0 &&
      srcs.every(
        (f) => !readFileSync(app + f, "utf8").includes("import androidx.compose.ui.draw.shadow"),
      ),
    withShadow.join(", "),
  );
  const edit = main("MediaEditScreen.kt");
  check(
    "r71-16: without a shadow the editor reads the MEDIA instead — the rail samples its own column and flips the glyphs between white and near-black, so white media no longer swallows them",
    edit.includes("val chromeInk by") &&
      edit.includes("produceState(Color.White, shot, clip, thumbs.firstOrNull())") &&
      edit.includes("android.graphics.Bitmap.createScaledBitmap(src, 24, 24, false)") &&
      edit.includes("(if (rail > 0.60) Color(0xFF10141A) else Color.White)") &&
      // every rail glyph + the Aa ride it
      (edit.match(/tint = if \((penMode|cropping|filtersOpen)\) ActionBlue else chromeInk/g) || [])
        .length === 3 &&
      (edit.match(/tint = chromeInk/g) || []).length === 3 &&
      edit.includes('Text("Aa", color = chromeInk, fontSize = 15.sp'),
  );
  check(
    "r71-16: the top bar keeps white ink on purpose (it sits on the dark top scrim) — the ✕ / undo / redo were NOT flipped",
    edit.includes(
      'Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp))',
    ) &&
      (edit.match(/tint = Color\.White\.copy\(alpha = if \(can(Undo|Redo)\)/g) || []).length === 2,
  );
}

/* ------------- 21. double tap a bubble = the ❤️ reaction ------------- */
{
  const chat = main("ChatScreen.kt");
  const emo = main("EmojiAnim.kt");
  check(
    "r71-21: `heartReact` is a REAL reaction — it guards a sending echo (no id), then goes through the same `applyReaction` the sheet uses, so the chip, the server row and the other phone all agree",
    chat.includes("fun heartReact(m: JSONObject) {") &&
      chat.includes('if (mid.startsWith("c_") || mid.isBlank()) return') &&
      chat.includes('applyReaction(m, "❤️")') &&
      chat.includes("lastHeartReactionAt = remember { HashMap<String, Long>() }") &&
      chat.includes("now - previous < HEART_REACTION_COOLDOWN_MS") &&
      // exactly one heart call into applyReaction beyond the sheet's own
      (chat.match(/applyReaction\(m, "❤️"\)/g) || []).length === 1 &&
      (chat.match(/applyReaction\(it, e\)/g) || []).length === 1,
  );
  check(
    "r71-21: non-emoji-only bubble kinds still heart on double tap; emoji-only text deliberately opts out",
    // Five child rows keep their callback; MessageRow gates only emoji-only TEXT.
    (chat.match(/onDoubleClick = \{ if \(!pendingEcho\) onDoubleTapHeart\(m\) \}/g) || [])
      .length === 5 &&
      chat.includes("onDoubleClick = if (!pendingEcho && emojiOnly == 0)") &&
      chat.includes("onDoubleTapHeart: (JSONObject) -> Unit = {},") &&
      // five tiles + the r71-20 once-text bubble
      (chat.match(/onDoubleTapHeart: \(JSONObject\) -> Unit = \{\},/g) || []).length === 6 &&
      (chat.match(/onDoubleTapHeart = ::heartReact,/g) || []).length === 3,
  );
  check(
    "r71-21: emoji glyphs keep instant replay; emoji-only text has no heart callback, while the sticker retains its double-tap callback",
    emo.includes("internal const val DOUBLE_TAP_HEART_MS = 320L") &&
      emo.includes("val lastTapAt = remember { longArrayOf(0L) }") &&
      emo.includes("val doubleTapConsumed = remember { booleanArrayOf(false) }") &&
      emo.includes("val isDoubleTap = lastTapAt[0] > 0L && gap in 1..DOUBLE_TAP_HEART_MS") &&
      emo.includes("if (isDoubleTap && !doubleTapConsumed[0] && onDoubleTap != null)") &&
      emo.includes("onDoubleTap: (() -> Unit)? = null,") &&
      (
        chat.match(
          /onDoubleTap = \{ if \(!pendingEcho\) onDoubleTapHeart\(m\) \},\s*onTap = onRevealStamp,\s*danceKey = fxKey,/g,
        ) || []
      ).length === 1 &&
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 66f') &&
      !chat
        .split("\n")
        .filter((line) => line.includes('EmojiGlyphRow(m.optText("body").trim(),'))
        .some((line) => line.includes("onDoubleTap =")),
  );
}

/* ------------- 19. the voice lock (r71) ------------- */
{
  const chat = main("ChatScreen.kt");
  const comp = chat.slice(
    chat.indexOf("private fun Composer("),
    chat.indexOf("private val VIDEO_NAME_EXT"),
  );
  const mic = chat.slice(
    chat.indexOf("private fun HoldMicButton("),
    chat.indexOf("private val VIDEO_NAME_EXT"),
  );
  const vnotes = main("VoiceNote.kt");
  const e2 = main("E2eeMsg.kt");
  const sf = main("SendFlight.kt");
  const app = "native-android/app/src/main/java/app/kuchupuchu/android/";
  const ui = readFileSync(app + "Ui.kt", "utf8");
  check(
    'r76-1 (owner: "kono bug na just eita implement korte hobe ... screenshot ta dekh ki korche ager session ar html a dekh koto sundor kore gochano"): the recorder is REBUILT state by state from the approved preview v5.8 — the hold stays the release-decides machine, now with the preview\'s thresholds (cancel arms past 120 dp with an 84 dp unarm hysteresis, lock-at 62 dp, rise cap 126 dp (r76-9: the button stops AT the column top), slide cap 150 dp) and the axis-lock with the low-left escape; NOTHING fires while the finger is down',
    mic.includes("val cancelDist = with(density) { 120.dp.toPx() }") &&
      mic.includes("val cancelUnarm = with(density) { 84.dp.toPx() }") &&
      mic.includes("val lockAtDist = with(density) { 62.dp.toPx() }") &&
      mic.includes("val riseMax = with(density) { 126.dp.toPx() }") &&
      mic.includes("val slideCap = with(density) { 150.dp.toPx() }") &&
      mic.includes("change.positionChangeIgnoreConsumed()") &&
      mic.includes("if (totX < -slop && -totX > -totY * 1.15f) axis = 2") &&
      mic.includes("else if (totY < -slop && -totY > -totX * 1.15f) axis = 1") &&
      mic.includes(
        "if (axis == 1 && -dragY < escRise && totX < -escDx && -totX > -totY * 1.8f) axis = 2",
      ) &&
      mic.includes("cancelHold = true") &&
      mic.includes("VoiceHoldGesture.decide(") &&
      mic.includes("cancelDist = if (wasCancel) cancelUnarm else cancelDist,") &&
      mic.includes("VoiceHoldGesture.Result.CANCEL -> onFinishRecord(true)") &&
      mic.includes("VoiceHoldGesture.Result.LOCK -> onLockRecord()") &&
      mic.includes("VoiceHoldGesture.Result.SEND -> onFinishRecord(false)") &&
      // r76-19 (owner item 10): a single tap (< 250 ms, no drag) locks the
      // take like the slide-up release; the decide() grew the tap arm.
      mic.includes("tap =") &&
      read("native-android/app/src/main/java/app/kuchupuchu/android/VoiceNote.kt").includes(
        "if (tap) return Result.LOCK",
      ) &&
      mic.includes("IntOffset(micX.roundToInt(), micY.roundToInt())") &&
      vnotes.includes("fun decide(") &&
      vnotes.includes("if (dy <= -lockDist) return Result.LOCK") &&
      vnotes.includes("if (dx <= -cancelDist) return Result.CANCEL") &&
      vnotes.includes("return Result.SEND"),
  );
  check(
    "r76-1: the HOLD bar and the LOCKED panel are the preview's geometry, control for control — 25 dp cards, 14/11 padding; hold row: 15 sp clock (min 42 dp), 28 dp accent wave, 12 sp muted hint; the cancel arm sinks the clock 26 dp (180 ms) and raises the small dustbin 100 ms late (never overlapping); locked rows: grey 28 dp wave + the app's own view-once glyph filling the 40 dp circle (borderless; arming only recolors it, r76-9), then the 48 dp red bin (DIRECT cancel), the 48 dp Pause pill (16 dp glyph + 14.5 sp label) and the 48 dp accent Send with the APP's own send glyph in the preview's dark ink",
    comp.includes("private fun RecorderLockedPanel(") &&
      comp.includes("private fun RecorderHoldBar(") &&
      (comp.match(/\.clip\(RoundedCornerShape\(25\.dp\)\)/g) || []).length >= 2 &&
      comp.includes("LiveVoiceWave(color = Muted, modifier = Modifier.weight(1f).height(28.dp))") &&
      comp.includes(
        "LiveVoiceWave(color = accent, modifier = Modifier.weight(1f).height(28.dp))",
      ) &&
      comp.includes(
        "CenteredOnceIcon(20.dp, tint = if (voiceOnce) accent else Color.White, fillBounds = true)",
        comp.includes("Box(Modifier.offset { IntOffset(-2, 0) }) {") &&
          comp.includes("Modifier.size(40.dp).clickable { onToggleVoiceOnce() },") &&
          vnotes.includes("r76-11 (owner:") &&
          chat.includes("LaunchedEffect(e2eePeerKey, E2eeMsg.restoredNonce) {") &&
          e2.includes("restoreRoaming(ctx)"),
      ) &&
      comp.includes(".clickable { onToggleVoiceOnce() }") &&
      comp.includes(".background(Red.copy(alpha = 0.16f))") &&
      comp.includes('"Delete recording",') &&
      comp.includes(".clickable { onTogglePause() }") &&
      comp.includes('if (paused) "Resume" else "Pause",') &&
      comp.includes("tint = Color(0xFF0D1524),") &&
      comp.includes('"Send voice message",') &&
      comp.includes("onDoubleClick = if (selectCount == 0) onSendVoiceOnce else null,") &&
      comp.includes('Text("‹ Slide to cancel", color = Muted, fontSize = 12.sp, maxLines = 1)') &&
      comp.includes("Modifier.offset(y = 26.dp * sink).alpha(1f - sink)") &&
      comp.includes("tween(200, delayMillis = 100)") &&
      !comp.includes("PulsingDot()") &&
      chat.includes("var voiceOnce by remember { mutableStateOf(false) }") &&
      chat.includes("voiceOnce = voiceOnce,") &&
      chat.includes("onSendVoice = { finishRecording(cancelled = false, once = voiceOnce) },"),
  );
  check(
    "r76-1: the seat wrap is the preview's #seatWrap — the FIXED 50x172 lock column (22 dp corners both ends, 2 dp accent border only when armed, dimmed to 30% while the cancel arm holds) sits BEHIND the 46 dp mic (2 dp ring over the screen's own background so the column never shows through) flushed to its bottom right; only the mic rides the finger, and the column is gone once locked",
    comp.includes("private fun LockColumn(") &&
      comp.includes(".size(width = 46.dp, height = colH)") &&
      comp.includes("LaunchedEffect(micY) { RecorderAnchors.micRise = -micY }") &&
      comp.includes(
        ".border(2.dp, if (armed) accent else Color.Transparent, RoundedCornerShape(22.dp))",
      ) &&
      comp.includes(".alpha(if (dimmed) 0.3f else 1f)") &&
      comp.includes("PadlockGlyph(locked = armed, tint = if (armed) accent else Color.White)") &&
      comp.includes("Icons.Filled.KeyboardArrowUp,") &&
      comp.includes("RepeatMode.Reverse") &&
      comp.includes(".padding(top = 10.dp),") &&
      comp.includes("Modifier.offset(y = (chev - 18f).dp).size(20.dp)") &&
      mic.includes("val armAtDist = with(density) { 32.dp.toPx() }") &&
      mic.includes("val lockArmed = axis == 1 && dragY <= -armAtDist") &&
      comp.includes("Box(Modifier.width(50.dp).height(46.dp).fxMicAnchor())") &&
      // r76-19 (owner item 2: "massage type korle massage bar ta halka right
      // side a bere jai ba boro hoi"): the send circle sits in the SAME
      // 50x46 seat as the mic spacer, so the bar's width cannot change on
      // the first typed character.
      comp.includes(
        "Box(\n                    Modifier\n                        .width(50.dp)\n                        .height(46.dp)\n                        .fxMicAnchor(),\n                    contentAlignment = Alignment.Center,\n                ) {",
      ) &&
      comp.includes("onLockRecord = onLockRecord,") &&
      comp.includes(".background(Cream)") &&
      comp.includes(
        ".border(2.dp, if (cancelArmed) Red else if (enabled) accent else Muted, CircleShape)",
      ) &&
      mic.includes(
        "LaunchedEffect(lockArmed, cancelArmed) { onLockVisual(lockArmed, cancelArmed) }",
      ) &&
      chat.includes("import androidx.compose.material.icons.filled.KeyboardArrowUp") &&
      chat.includes("RecorderAnchors.columnArmed = armed") &&
      chat.includes("val composerShown =") &&
      chat.includes("onLockRecord = { lockRecording() }") &&
      chat.includes("var ownOrigin by remember { mutableStateOf(Offset.Zero) }") &&
      chat.includes("FlightAnchors.micBounds") &&
      // r76-15: the mic seat anchor is snapshot state (overlay follows every
      // layout move) and the mic stands down while the send circle is up.
      sf.includes("var micBounds: Rect? by mutableStateOf(null)") &&
      chat.includes("sendSeat = input.isNotBlank() || selected.size > 0,") &&
      chat.includes("!sendSeat && mic != null"),
  );
  check(
    "r76-1: the recorder wears the APP'S palette on the preview's geometry — accent circles, DarkCard bar/panel/column, 8% white Pause pill (the once glyph has been bare since r76-12), Red bin; the old DoubleArrow chevron send is gone with the rebuild (import included)",
    comp.includes(".background(accent)") &&
      comp.includes("Icons.AutoMirrored.Filled.Send,") &&
      (comp.match(/\.background\(DarkCard\)/g) || []).length === 3 &&
      (comp.match(/Color\.White\.copy\(alpha = 0\.08f\)/g) || []).length === 1 &&
      comp.includes('"Send voice message",') &&
      !comp.includes("Icons.Filled.DoubleArrow,") &&
      !chat.includes("import androidx.compose.material.icons.filled.DoubleArrow") &&
      chat.includes('if (paused) "Resume recording" else "Pause recording",'),
  );
  check(
    "r75-1: the tap-to-lock machine is gone with the system it served — no queued lock, no recStarting window, no tap shortcut anywhere on the recorder's path, and a failed start still says why",
    !chat.includes("lockPending") &&
      !chat.includes("recStarting") &&
      !vnotes.includes("TAP_LOCK") &&
      !vnotes.includes("TAP_MS") &&
      !mic.includes("tapSlop") &&
      !mic.includes("lockReached") &&
      chat.includes('error = "Mic is not available. Check the mic permission."'),
  );
  /* ---- r75-3: the locked panel — WhatsApp's two rows, Pause is real ---- */
  const vn = main("VoiceNote.kt");
  check(
    "r73-19 + r75-3: Pause / Resume is the panel's wide pill — a REAL pause with the bin circle beside it, the clock greys out while paused, and the chat's state wiring is unchanged",
    comp.includes(".clickable { onTogglePause() }") &&
      comp.includes("if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause,") &&
      comp.includes('if (paused) "Resume recording" else "Pause recording",') &&
      comp.includes('if (paused) "Resume" else "Pause",') &&
      comp.includes("color = if (paused) Muted else Ink,") &&
      chat.includes("paused = recPaused,") &&
      chat.includes("onTogglePause = { toggleRecPause() },") &&
      chat.includes("var recPaused by remember { mutableStateOf(false) }") &&
      chat.includes("fun toggleRecPause() {") &&
      chat.includes("VoiceNote.pause()") &&
      chat.includes("VoiceNote.resume()"),
  );
  check(
    "r73-19: Pause is a REAL pause — MediaRecorder.pause/resume with the clock and the peak sampler stopped, so the take's length and its wave are the words actually spoken (a paused recorder is resumed before stop())",
    vn.includes("fun pause(): Boolean =") &&
      vn.includes("recorder?.pause()") &&
      vn.includes("fun resume(): Boolean =") &&
      vn.includes("recorder?.resume()") &&
      vn.includes("pausedTotal += System.currentTimeMillis() - pausedAt") &&
      vn.includes(
        "(if (isPaused) pausedAt else System.currentTimeMillis()) - startedAt - pausedTotal",
      ) &&
      vn.includes("val secs = (elapsedMs() / 1000).toInt()") &&
      /if \(isPaused\) \{\n            runCatching \{ recorder\?\.resume\(\) \}/.test(vn) &&
      vn.includes("isPaused = false") &&
      vn.includes("var isPaused: Boolean = false"),
  );
  check(
    "r72-19: the composer's Send seat runs in the owner's 0.45 s double-tap window (the platform's ~0.3 s was too tight for the once-send) — one seat-local ViewConfiguration, everything else inherited",
    ui.includes("const val KP_DOUBLE_TAP_MS = 300L") &&
      ui.includes("object : ViewConfiguration by base {") &&
      ui.includes("override val doubleTapTimeoutMillis: Long get() = ms") &&
      ui.includes("fun KpDoubleTapSeat(content: @Composable () -> Unit)") &&
      chat.includes("KpDoubleTapSeat {") &&
      // r76-17: only the locked panel's send circle keeps the seat now.
      (chat.match(/KpDoubleTapSeat \{/g) || []).length === 1,
  );
}

/* ------------- 19b. the once-view voice note (r71) ------------- */
{
  const chat = main("ChatScreen.kt");
  const list = main("ChatListScreen.kt");
  check(
    "r71-19b: the locked seat's SECOND tap is the view-once send — combinedClickable's own double-tap window holds the plain tap, so one tap still sends a normal note and two send it once",
    chat.includes("onSendVoiceOnce: () -> Unit = {},") &&
      // r75-3: the double tap lives on the PANEL's Send now (the 0.45 s seat).
      chat.includes("onDoubleClick = if (selectCount == 0) onSendVoiceOnce else null,") &&
      chat.includes("onSendVoiceOnce = { finishRecording(cancelled = false, once = true) },") &&
      chat.includes("fun finishRecording(cancelled: Boolean, once: Boolean = false) {") &&
      chat.includes("sendVoice(take.file, take.seconds, name, take.waveform, once)"),
  );
  check(
    "r71-19b: `once` rides the whole send — the meta, the optimistic echo and the queued payload all carry viewOnce, so the sender's own bubble is a once-view card from the first frame",
    chat.includes(
      "fun sendVoice(file: File, seconds: Int, name: String, waveform: List<Int> = emptyList(), once: Boolean = false) {",
    ) &&
      // meta builder + optimistic echo + queued payload
      (chat.match(/\.also \{ if \(once\) it\.put\("viewOnce", true\) \}/g) || []).length === 3 &&
      chat.includes("// r71-19b: a locked note sent with a double tap on Send goes") &&
      chat.includes('.also { if (once) it.put("viewOnce", true) }'),
  );
  check(
    "r71-19b: a view-once VOICE renders as its own card — ViewOnceRow takes the voice player, routes a voice row to VoiceOnceTile instead of the blurred photo tile, and sizes it wide and short; r76-13 keeps the r76-11 picture and the wave subsamples to its canvas so the duration never overlaps it",
    chat.includes("player: VoicePlayer,") &&
      chat.includes("val voice = !sentAsDocument(m) && fileLooksVoice(m)") &&
      /VoiceOnceTile\(\s*m = m,\s*mine = mine,\s*pendingEcho = pendingEcho,\s*player = player,\s*playing = player\.playingId == m\.optString\("id"\),\s*onSpent = \{ if \(!mine\) ViewOnce\.spend\(m\.optString\("id"\)\) \},\s*onRevealStamp = onRevealStamp,?\s*\)/.test(
        chat,
      ) &&
      chat.includes(".widthIn(max = if (voice) 196.dp else 138.dp)") &&
      chat.includes("else -> List(fit) { bars[it * bars.size / fit] }") &&
      // r76-14: the NORMAL voice bubble mirrors the once card and the
      // 1-mark seat cycles playback speed.
      chat.includes("player.cycleSpeed(id)") &&
      chat.includes("player.speedOf(id).toInt()}x") &&
      // r76-18 item 2: the empty-pill hint carries the field's exact line
      // metrics, so the composer is one size typed or not.
      chat.includes(
        "lineHeight = 20.sp,\n                                modifier = Modifier.padding(vertical = 6.dp),",
      ) &&
      chat.includes("Modifier.heightIn(min = 44.dp)") &&
      chat.includes('targetScale = if (kind == "TEXT") 1.05f else 1f,') &&
      /ViewOnceRow\(\s*m = m,\s*mine = mine,[\s\S]{0,700}?onDoubleTapHeart = onDoubleTapHeart,\s*onRevealStamp = onRevealStamp,?\s*\)/.test(
        chat,
      ),
  );
  check(
    "r71-19b: playing it once IS the opening — the RECIPIENT's play fetches the message's own media route (that fetch spends + deletes for both sides, the photo's H3 rule) while the sender's preview reads the file key and spends nothing; the card keeps the wave, the duration and the 1 mark",
    chat.includes('val source = if (mine) fileKey else "/api/messages/$id/media"') &&
      chat.includes("player.toggle(ctx, id, source) { onSpent() }") &&
      chat.includes("VoiceWave(") &&
      chat.includes("CenteredOnceIcon(30.dp)") &&
      // no seek on a once-only note
      chat.includes("onSeek = {},"),
  );
  check(
    "r71-19b: the chat list passes the worker's 'Voice message · View once' through instead of folding it into a plain voice bubble",
    list.includes('if (t == "Voice message · View once") return t'),
  );
}

/* ------------- 20. the once-view text (r71) ------------- */
{
  const chat = main("ChatScreen.kt");
  const list = main("ChatListScreen.kt");
  const onceTextRow = chat.slice(
    chat.indexOf("private fun OnceTextRow("),
    chat.indexOf("private fun VoiceOnceTile("),
  );
  check(
    "r71-20 + r76-17: the once-text lives in the SCHEDULE sheet now (owner: double tap remove, schedule er vetor once icon) — the sheet's View-once toggle rides scheduleText's once flag into the stored payload; the seat's tap is instant (no double-tap seat), and `sendText` still takes the flag through the meta, the payload and the optimistic echo",
    chat.includes(
      "fun scheduleText(body: String, at: java.time.Instant, once: Boolean = false) {",
    ) &&
      chat.includes("withOnce = true,") &&
      chat.includes("scheduleText(input, at, once)") &&
      // r76-19 (owner item 12): the sheet's View-once row is a SEND button
      // (bigger ①, tap = the typed text goes out veiled right now).
      chat.includes("onOnceNow: () -> Unit = {},") &&
      chat.includes('sendText(input, "TEXT", once = true)') &&
      chat.includes("CenteredOnceIcon(30.dp)") &&
      !chat.includes("input.isNotBlank() -> onSendTextOnce") &&
      chat.includes('fun sendText(body: String, kind: String = "TEXT", once: Boolean = false) {') &&
      chat.includes(
        'if (once) payload.put("meta", JSONObject().put("viewOnce", true)).put("viewOnce", true)',
      ) &&
      chat.includes(
        '.also { if (once) it.put("viewOnce", true).put("meta", JSONObject().put("viewOnce", true)) }',
      ),
  );
  check(
    "r71-20: the once-text row is dispatched to its own bubble (never the blurred-photo tile), and that row keeps the reply swipe, the long press and the heart",
    chat.includes('if (kind == "TEXT" && m.optText("body").isNotBlank()) {') &&
      chat.includes('targetScale = if (kind == "TEXT") 1.05f else 1f,') &&
      chat.includes("val onFocusedLongPress: (JSONObject) -> Unit = { pressed ->") &&
      /OnceTextRow\(\s*m = m,\s*mine = mine,[\s\S]{0,500}?onDoubleTapHeart = onDoubleTapHeart,\s*onRevealStamp = onRevealStamp,?\s*\)/.test(
        chat,
      ) &&
      chat.includes(
        "@Composable\n@OptIn(ExperimentalFoundationApi::class)\nprivate fun OnceTextRow(",
      ) &&
      onceTextRow.includes("Modifier.messageReplySwipe(") &&
      onceTextRow.includes("onLongClick = {") &&
      chat.includes("if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)"),
  );
  check(
    "r71-20 + r74-2: the veil is real on every device — a Compose blur where the platform has one (API 31+), the same shape in placeholder marks where it does not — it covers BOTH copies now (mine too), and the far side's tap starts the visible five seconds",
    chat.includes("internal const val ONCE_TEXT_REVEAL_MS = 5_000L") &&
      chat.includes("internal fun veiledText(body: String): String =") &&
      chat.includes(
        "if (veil && android.os.Build.VERSION.SDK_INT < 31) veiledText(body) else body",
      ) &&
      chat.includes("Modifier.blur(7.dp, edgeTreatment = BlurredEdgeTreatment.Unbounded)") &&
      chat.includes("val veil = !revealed") &&
      chat.includes("if (!mine && !revealed) {") &&
      chat.includes("onRevealStamp()") &&
      chat.includes('Text("${((leftMs + 999) / 1000)}s", color = Red, fontSize = 10.sp)'),
  );
  check(
    "r71-20 + r74-2: the fifth second spends the opening (ViewOnce.spend → the row is deleted for BOTH sides), and the veil is the SAME on my copy — `veil` no longer asks whose message it is",
    chat.includes("delay(ONCE_TEXT_REVEAL_MS)") === false &&
      chat.includes("ViewOnce.spend(id)") &&
      /while \(true\) \{[\s\S]{0,200}?leftMs = left\.coerceAtLeast\(0L\)[\s\S]{0,120}?delay\(200\)/.test(
        chat,
      ) &&
      chat.includes("var leftMs by remember(id) { mutableStateOf(0L) }"),
  );
  check(
    "r71-20: nothing leaks the body outside the bubble — the quote of a once-text reads 'Message · View once' (the shared label), and the list passes the worker's preview through",
    chat.includes("internal fun onceQuoteLabel(m: JSONObject): String =") &&
      chat.includes('isViewOnce(m) && m.optString("kind") == "TEXT" -> "Message · View once"') &&
      chat.includes("if (isViewOnce(replyTo)) onceQuoteLabel(replyTo)") &&
      chat.includes("if (q != null && isViewOnce(q)) onceQuoteLabel(q)") &&
      list.includes('if (t == "Message · View once") return t'),
  );
  /* ---- the r72 redo of 20 (owner: "once view text massage er massage bubble
     massage onujai hocche na. ar notification ei text show hoye jacche") ---- */
  const seal = main("PushSeal.kt");
  const push = main("KpPush.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r72-20: the once-view text bubble IS the app's own text bubble — the same width rule as every message, the same wrap, and the stamp riding UNDER it (never a private 260 dp box with the stamp crammed inside)",
    chat.includes("val bubbleMax =") &&
      chat.includes(".widthIn(max = bubbleMax)") &&
      chat.includes(".wrapContentWidth()") &&
      chat.includes("BubbleStamp(m, mine, pendingEcho, otherReadAt, 0, stampInk)") &&
      !chat.includes(".widthIn(max = 260.dp)") &&
      // the same stamp ink the other bubbles compute, and the countdown on the
      // same line as the stamp
      chat.includes(
        'theme == "darkblue" ->\n            if (KpThemeMode.darkBlue) Color(0xFFA9C4F2) else Color(0xFF5B7FC7)',
      ) &&
      chat.includes('Text("${((leftMs + 999) / 1000)}s", color = Red, fontSize = 10.sp)') &&
      // and the bubble + its stamp share a column with the common row swipe host
      chat.includes("modifier = Modifier.messageReplySwipe(") &&
      chat.includes("horizontalAlignment = if (mine) Alignment.End else Alignment.Start"),
  );
  check(
    'r74-2 (owner, r74: "kichui na icon o na kono text level o na just blur thakbe" and "ami send korbo amar kache + je receive korbe tar kacheo blur"): the once-text bubble is ONLY the blur — the 1 mark (r73-20, then 28 dp) and the "Tap to view" hint are both gone — and the veil covers both sides, with the below-API-31 placeholder marks as the platform-legal stand-in',
    chat.includes("val veil = !revealed") &&
      !chat.includes("CenteredOnceIcon(28.dp)") &&
      !chat.includes('"Tap to view"') &&
      chat.includes(
        "if (veil && android.os.Build.VERSION.SDK_INT < 31) veiledText(body) else body",
      ) &&
      chat.includes("Modifier.blur(7.dp, edgeTreatment = BlurredEdgeTreatment.Unbounded)"),
  );
  check(
    "r72-20: the notification can never show the once-view text — the worker sends no envelope and no e2ee marker for such a row (only kp_once and its masked label), and the phone refuses to open or print one: the label beats any plaintext, for the card AND for the list row it feeds",
    worker.includes('...(sealedBody && !message.viewOnce ? { kp_e2ee: "1" } : {})') &&
      worker.includes('...(message.viewOnce ? { kp_once: "1" } : {}),') &&
      seal.includes(
        'fun isOnceLabel(s: String?): Boolean = s?.trim()?.endsWith("View once") == true',
      ) &&
      seal.includes(
        "data class Plan(val sealed: Boolean, val envelope: String?, val once: Boolean = false)",
      ) &&
      seal.includes('return Plan(sealed, env ?: bodyEnv, kpOnce == "1" || isOnceLabel(body))') &&
      seal.includes("if (!plan.sealed || plan.once) return null") &&
      seal.includes('return raw.takeIf { isOnceLabel(it) } ?: "Message · View once"') &&
      push.includes('PushSeal.cardText(plan, opened, data["body"])') &&
      push.includes(
        'PushSeal.plan(data["kp_e2ee"], data["kp_env"], data["body"], data["kp_once"])',
      ),
  );
}

/* ------------- 18. the chat's privacy sheet (r71) ------------- */
{
  const chat = main("ChatScreen.kt");
  const cap = main("KpCapture.kt");
  const media = main("ChatMediaScreen.kt");
  const viewer = main("MediaViewer.kt");
  const doc = main("DocViewerScreen.kt");
  const manifest = read("native-android/app/src/main/AndroidManifest.xml");
  check(
    "r71-18: the ⋮ loses its Add contact row (a person already in the book keeps View contact) and gains Chat privacy",
    // the ROW is gone (the words survive in a comment saying so); the
    // navigation it used to offer is gone with it
    !chat.includes('Icons.Filled.PersonAdd, "Add contact"') &&
      !chat.includes('"newcontact?name=') &&
      chat.includes('KpSheetRow(Icons.Filled.Person, "View contact")') &&
      chat.includes('KpSheetRow(Icons.Filled.Lock, "Chat privacy")') &&
      chat.includes("showChatPrivacy = true"),
  );
  check(
    "r71-18: three REAL switches in the sheet — the two capture alerts and the save permission, each one saying what it does (and a version that cannot be told says so instead of pretending)",
    chat.includes("private fun ChatPrivacySheet(") &&
      chat.includes('label = "Screenshot alert"') &&
      chat.includes('label = "Screen record alert"') &&
      chat.includes('label = "Allow Media Save"') &&
      // r76-18 (owner item 3): the sheet grew the two Allow switches, and the
      // alert rows only exist while their Allow switch is on.
      chat.includes('label = "Allow Screenshot"') &&
      chat.includes('label = "Allow Screen Record"') &&
      chat.includes("if (allowShot)") &&
      chat.includes("if (allowRec)") &&
      // r76-30 (owner: "alert er details instructions text ogula remove
      // koro"): the two alert rows are label-only now.
      chat.split('sub = "",').length === 3 &&
      !chat.includes("Alert me when they screenshot this chat") &&
      // r76-22 (owner: "short 1 line a rakho"): every sub-line is one short
      // sentence now.
      chat.includes("They can save the media I send here") &&
      chat.includes("They cannot save my media") &&
      // r72-18: the screenshot row is no longer "Android 14 or newer" — the
      // 12/13 folder watch covers the versions below it, so the row is live
      // everywhere. r76-20 (owner item 3): the RECORDING row lost its
      // "Android 15 or newer" floor too — below 15 the saved-recording file
      // is read from the Screen recordings folder, so it is live everywhere.
      !chat.includes("Needs Videos access to spot them") &&
      !chat.includes("Alerts need Android 15 or newer") &&
      chat.includes("folderWatch = KpCapture.folderPermissions().isNotEmpty(),") &&
      chat.includes("folderGranted = KpCapture.folderGranted(ctx),"),
  );
  check(
    "r71-18: the alerts are wired to the OS callbacks — Android 14's ScreenCaptureCallback and Android 15's screen-recording state — reported only while that chat is the one on screen",
    manifest.includes("android.permission.DETECT_SCREEN_CAPTURE") &&
      manifest.includes("android.permission.DETECT_SCREEN_RECORDING") &&
      cap.includes('Activity.ScreenCaptureCallback { report("shot") }') &&
      cap.includes("registerScreenCaptureCallback(activity.mainExecutor, cb)") &&
      cap.includes("addScreenRecordingCallback(activity.mainExecutor, cb)") &&
      cap.includes("WindowManager.SCREEN_RECORDING_STATE_VISIBLE") &&
      cap.includes("unregisterScreenCaptureCallback") &&
      cap.includes("removeScreenRecordingCallback") &&
      cap.includes('Api.post("/api/conversations/$id/capture"') &&
      chat.includes("KpCapture.watch(MainActivity.current, convId)") &&
      chat.includes("onDispose { KpCapture.stop() }"),
  );
  check(
    "r72-18 (owner: \"screenshot alert ta android 14 newer keno ami to Snapchat a dekhchi eita hocche Android 13/12 a o\"): below Android 14 the same alert reads the system's OWN Screenshots folder — the permission the switch asks for, a watermark set from today's newest shot, a MediaStore observer plus a slow poll while the chat is on screen, and a two-minute freshness rule so a late media scan never fakes an alert",
    // the permission: READ_MEDIA_IMAGES on 13, READ_EXTERNAL_STORAGE below
    cap.includes("fun folderPermission(): String?") &&
      cap.includes("android.Manifest.permission.READ_MEDIA_IMAGES") &&
      cap.includes("android.Manifest.permission.READ_EXTERNAL_STORAGE") &&
      cap.includes("fun folderGranted(ctx: android.content.Context?): Boolean") &&
      // the folder read: only Screenshots buckets / names, newest first
      cap.includes("MediaStore.Images.Media.EXTERNAL_CONTENT_URI") &&
      cap.includes('bucket.contains("screenshot")') &&
      cap.includes('name.startsWith("screencap")') &&
      cap.includes('MediaStore.Images.Media._ID + " DESC"') &&
      // the watermark + the freshness window + the poll
      // r76-20: the watermark line grew the recording half.
      cap.includes("watermark = if (shots) newestShot(ctx)?.first ?: 0L else 0L") &&
      cap.includes("val age = System.currentTimeMillis() / 1000 - addedSec") &&
      cap.includes('if (age in 0..120) report("shot")') &&
      cap.includes("registerContentObserver(") &&
      cap.includes("h.postDelayed(this, 5_000)") &&
      cap.includes("stopFolder()") &&
      // r76-20 (owner item 3: "screen record alert ... lower a o jeno kaj
      // kore"): the recording half below 15 — the video store's own query /
      // observer / watermark / freshness rule, the 15+ callback untouched.
      cap.includes("private fun newestRec(") &&
      cap.includes("MediaStore.Video.Media.EXTERNAL_CONTENT_URI") &&
      cap.includes('name.startsWith("recording")') &&
      cap.includes("private fun changedRec(") &&
      cap.includes("if (age in 0..120) {") &&
      cap.includes('report("rec")') &&
      cap.includes("startFolder(activity, shots = false)") &&
      cap.includes("fun folderPermissions(): List<String>") &&
      // armed only where the callback is missing, and only with the permission
      cap.includes(
        "if (folderPermission() != null && folderGranted(activity)) startFolder(activity)",
      ) &&
      // the switch asks for it (owner Q&A: on the switch, not at launch)
      chat.includes("act.ensurePermissions(perms) { capturePermNonce++ }") &&
      chat.includes("DisposableEffect(convId, capturePermNonce) {") &&
      chat.includes("var capturePermNonce by remember { mutableStateOf(0) }") &&
      // r76-22: the alert rows are SUB-options — small row, small toggle,
      // indented under their Allow switch, and one short line of text.
      !chat.includes("Needs Photos access to spot them") &&
      chat.split("small = true,").length === 3 &&
      chat.includes("Modifier.scale(if (small) 0.62f else 0.85f)"),
  );
  check(
    'r73-18b (owner: "screenshot chat er baire nileo alert jai"): the watch follows the ACTIVITY, not the composition — [pause] tears every registration down when the screen loses focus, [resume] re-arms it, and arming always starts from a FRESH watermark, so a screenshot taken in another app can never be attributed to this chat',
    cap.includes("fun pause() {") &&
      cap.includes("fun resume() {") &&
      cap.includes("private fun teardown() {") &&
      cap.includes("if (!armed) return") &&
      cap.includes("armed = false") &&
      cap.includes("private var armed = false") &&
      /fun resume\(\) \{\n        if \(watched == null \|\| convId.isBlank\(\) \|\| armed\) return\n        arm\(\)/.test(
        cap,
      ) &&
      // the watermark is taken at ARM time (today's newest shot), not at boot
      // r76-20: the watermark line grew the recording half.
      cap.includes("watermark = if (shots) newestShot(ctx)?.first ?: 0L else 0L") &&
      // and the activity drives it
      read("native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt").includes(
        "KpCapture.resume()",
      ) &&
      read("native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt").includes(
        "KpCapture.pause()",
      ) &&
      // the tiny alert: one line of red text, no chip around it
      chat.includes('r73-18c (owner: "alert eto boro kore ekdom choto kore jabe background') &&
      chat.includes("fontSize = 10.5.sp,") &&
      chat.includes("lineHeight = 13.sp,\n                color = Muted,") &&
      chat.includes("textAlign = TextAlign.Center,"),
  );
  check(
    "r71-18: the switches are the server's (read from the conversation, written back one at a time) and a capture alert lands as a red chip with one buzz",
    chat.includes('c?.optJSONObject("privacy")') &&
      chat.includes(
        "fun setChatPrivacy(\n        shot: Boolean? = null,\n        rec: Boolean? = null,\n        save: Boolean? = null,\n        allowShot: Boolean? = null,\n        allowRec: Boolean? = null,\n        readReceipts: Boolean? = null,\n    )",
      ) &&
      chat.includes('"/api/conversations/$convId/privacy"') &&
      chat.includes('readReceipts?.let { put("readReceipts", it) }') &&
      !chat.includes("readReceiptsOverride") &&
      !chat.includes("globalReadReceipts") &&
      // r76-19 (owner item 3: rapid flips auto-reverted): pokes are ignored
      // while a write is in flight, and the writes serialize on a mutex, so
      // the last flip is the last write and its poke is the final word.
      chat.includes("if (privWrites > 0) return@LaunchedEffect") &&
      chat.includes("privMutex.withLock {") &&
      chat.includes("internal fun captureAlertOf(m: JSONObject): String?") &&
      chat.includes('b.endsWith("took a screenshot of this chat") -> "shot"') &&
      chat.includes('b.endsWith("started a screen recording of this chat") -> "rec"') &&
      // r73-18c: the alert is a single small line of red text on the wallpaper.
      !chat.includes("Icons.Filled.Videocam else Icons.Filled.VisibilityOff") &&
      // r77-2 superseded the r76-20 ring+buzz: the alert is SILENT everywhere
      // (chat-only) — see the r77-2 block at the bottom.
      !chat.includes("KpSounds.captureAlert(") &&
      chat.includes('r77-2 (owner: "kono notification sound ba notification e thakbe na'),
  );
  check(
    "r71-18: the save permission is enforced where media is opened — their switch withholds MY save (photo viewer, gallery, clip, document) and never my own media",
    chat.includes('val peerSaveOk = c?.optBoolean("peerSave", true) != false') &&
      chat.includes(
        'viewerPhotos.getOrNull(viewerAt)?.optString("senderId") == Store.myId() || peerSaveOk',
      ) &&
      media.includes('val peerSaveOk = convSnap?.optBoolean("peerSave", true) != false') &&
      media.includes('(!privateChat && (m.optString("senderId") == Store.myId() || peerSaveOk))') &&
      chat.includes('.also { if (!isMe && !peerSaveOk) it.put("kpNoSave", true) }') &&
      viewer.includes('val noSaveClip = m?.optBoolean("kpNoSave") == true') &&
      viewer.includes("(KpSecure.amOwner() || (!privateClip && !noSaveClip))") &&
      doc.includes('val noSaveDoc = m?.optBoolean("kpNoSave") == true') &&
      doc.includes("(KpSecure.amOwner() || (!privateDoc && !noSaveDoc)) && !saved && state == 1"),
  );
}

/* ------------- 18b. the worker half of the chat-privacy switches ------------- */
{
  const worker = read("src/worker/index.ts");
  check(
    "r71-18: worker — the switches live on the MEMBER row (defaults: no alerts, saving allowed), one partial-update route writes them, and the payload carries mine plus the peer's save answer",
    worker.includes("ALTER TABLE members ADD COLUMN priv_shot INTEGER NOT NULL DEFAULT 0") &&
      worker.includes("ALTER TABLE members ADD COLUMN priv_rec INTEGER NOT NULL DEFAULT 0") &&
      worker.includes("ALTER TABLE members ADD COLUMN priv_save INTEGER NOT NULL DEFAULT 1") &&
      worker.includes("path.match(/^\\/api\\/conversations\\/([^/]+)\\/privacy$/)") &&
      // r76-18 (owner items 3/4): the UPDATE grew the two Allow columns and
      // the payload answers them — NULL rows come back as the member's
      // profile defaults (private: off; public: shot on, rec off, save on).
      worker.includes(
        "UPDATE members SET priv_shot = ?, priv_rec = ?, priv_save = ?, priv_allow_shot = ?, priv_allow_rec = ?, priv_read_receipts = ? WHERE conv_id = ? AND user_id = ?",
      ) &&
      worker.includes(
        "shot: meShot,\n      rec: meRec,\n      save: meSave,\n      allowShot: meAllowShot,\n      allowRec: meAllowRec,",
      ) &&
      worker.includes("peerSave: solo ? (otherSave ?? true) : true,") &&
      worker.includes("peerShotOk: solo ? otherAllowShot : true,") &&
      worker.includes("peerRecOk: solo ? otherAllowRec : true,"),
  );
  check(
    "r71-18: worker — the capture route alerts only the members whose OWN switch is on, folds a burst into one row per 20 s, writes a real SYSTEM chip; r77-2: and NOTHING pushes (the alert is chat-only now)",
    worker.includes("path.match(/^\\/api\\/conversations\\/([^/]+)\\/capture$/)") &&
      worker.includes(
        'kind === "rec" ? Number(m.priv_rec ?? 0) === 1 : Number(m.priv_shot ?? 0) === 1',
      ) &&
      worker.includes("Date.now() - Date.parse(last.created_at) < 20_000") &&
      // the two phrases, separately: prettier may re-wrap the ternary line.
      worker.includes('"started a screen recording of this chat"') &&
      worker.includes('"took a screenshot of this chat"') &&
      !worker
        .slice(
          worker.indexOf("/capture$/"),
          worker.indexOf("afterMessageChanged(env, db, convId, { id: mid"),
        )
        .includes("pushMessageUnlessHidden"),
  );
}

/* ------------- 17. the owner's account is exempt (r71) ------------- */
{
  const secure = main("KpSecure.kt");
  const profile = main("ProfileScreen.kt");
  const chat = main("ChatScreen.kt");
  const media = main("ChatMediaScreen.kt");
  const viewer = main("MediaViewer.kt");
  const doc = main("DocViewerScreen.kt");
  check(
    "r71-17: @Rabbihossainltd is exempt — one place says who he is, Block AND Report stay off his profile, and his own save rule is the only thing that lifts the view-once / withheld-media gate",
    secure.includes('const val OWNER_USERNAME = "rabbihossainltd"') &&
      secure.includes(
        'fun ownerUser(u: JSONObject?): Boolean = u?.optText("username") == OWNER_USERNAME',
      ) &&
      secure.includes("fun amOwner(): Boolean = ownerUser(Store.me)") &&
      profile.includes("val unblockable = isMe || isKpBot(userId) || KpSecure.ownerUser(user)") &&
      profile.includes(
        'if (!unblockable) {\n                    KpSheetRow(Icons.Filled.Flag, "Report", tint = Red) {',
      ) &&
      profile.includes("if (!unblockable) {\n                    KpSheetRow(Icons.Filled.Block,") &&
      chat.includes("canSave = KpSecure.amOwner() ||") &&
      media.includes("canSave = KpSecure.amOwner() ||") &&
      viewer.includes("(KpSecure.amOwner() || (!privateClip && !noSaveClip))") &&
      doc.includes("(KpSecure.amOwner() || (!privateDoc && !noSaveDoc))"),
  );
}

{
  // r76-23 (owner): "shob buttons toggle switch same thakbe ... just
  // animation ta add Hobe" — his AnimatedToggleSwitch (blue wipe + spinning
  // knob) is THE switch at every site; the privacy sub-rows shift left as
  // WHOLE rows; an OWN row flies only when it BECOMES sent (the sending echo
  // is static — no animation to cut mid-send); a pending gif shows exactly
  // ONE progress ring; the view-once send ring rides the normal centered
  // scrim system.
  const chat = main("ChatScreen.kt");
  const settings = main("SettingsScreen.kt");
  const group = main("GroupInfoScreen.kt");
  const toggle = main("AnimatedToggleSwitch.kt");
  check(
    "r76-23: the owner's animated toggle is app-wide, sub-rows shift whole, own flights start at SENT, one gif ring, view-once ring centered",
    toggle.includes("fun AnimatedToggleSwitch(") &&
      toggle.includes("Color(0xFFD8DAE0)") &&
      toggle.includes("Color(0xFF3D72F6)") &&
      toggle.includes("knobRotation.animateTo") &&
      chat.split("AnimatedToggleSwitch(").length === 2 &&
      settings.split("AnimatedToggleSwitch(").length === 3 &&
      group.split("AnimatedToggleSwitch(").length === 2 &&
      !chat.includes("import androidx.compose.material3.Switch") &&
      !settings.includes("import androidx.compose.material3.Switch") &&
      chat.includes(
        "if (!isPending)\n                CircularProgressIndicator(color = if (mine) AmberInk else Gold, modifier = Modifier.size(22.dp))",
      ) &&
      chat.includes(
        "Box(Modifier.matchParentSize().background(Color(0x59000000)), contentAlignment = Alignment.Center) {",
      ),
  );
}

{
  // r76-25 (owner): arrivals must be INSTANT and the flight must SURVIVE the
  // pending->server swap (global time-based FlightAnims, flight claimed at
  // birth); sub-rows start at the SAME left edge as every other row; the gif
  // echo keeps its true ratio; the once-mark stays hidden while uploading;
  // the message channel always re-rings the user's picked tone (self-heal);
  // and the list-refresh fallback never stacks a second card over a fresh
  // FCM card.
  const chat = main("ChatScreen.kt");
  const flight = main("SendFlight.kt");
  const store = main("ScreenStore.kt");
  const push = main("KpPush.kt");
  const notify = main("KpNotify.kt");
  check(
    "r76-25: instant animated arrivals that survive the swap, flush-left sub-rows, self-healing channel, no duplicate card",
    flight.includes("object FlightAnims") &&
      flight.includes("fun birth(key: String): Flight") &&
      flight.includes("fun valueAt(f: Flight, durMs: Int): Float") &&
      flight.includes("FastOutSlowInEasing.transform(t)") &&
      flight.includes('key: String = ""') &&
      chat.split("key = fxKey").length === 6 &&
      !chat.includes("fxSendHold") &&
      chat.includes("Column(Modifier.weight(1f))") &&
      !chat.includes("if (small) Spacer(Modifier.width(10.dp))") &&
      chat.includes("start = 14.dp,") &&
      chat.includes('payload.put("meta", JSONObject().put("w", gw).put("h", gh))') &&
      chat.includes('.put("mediaW", gw)') &&
      chat.includes(
        "if (!pendingEcho)\n                    Box(\n                        Modifier\n                            .align(Alignment.Center)\n                            .size(52.dp),",
      ) &&
      store.includes("fun markPushCard(convId: String)") &&
      store.includes("< 30_000L") &&
      push.includes("ScreenStore.markPushCard(convoId)") &&
      notify.includes("mgr.getNotificationChannel(CHAT_CHANNEL)") &&
      notify.includes("mgr.deleteNotificationChannel(CHAT_CHANNEL)"),
  );
}

/* ---------- r76-26: the owner's seven (sticker verified, six shipped) ---------- */
{
  const chat = main("ChatScreen.kt");
  const list = main("ChatListScreen.kt");
  const viewer = main("MediaViewer.kt");
  const chatFx = main("ChatFx.kt");
  const e2 = main("E2eeMsg.kt");
  const backup = main("E2eeBackup.kt");
  const settings = main("SettingsScreen.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r76-26: sub-switches aligned, GIF says GIF, once-media saves from held bytes, cached animator scale, passphrase-locked key backup",
    chat.includes("Column(Modifier.weight(1f))") &&
      !chat.includes("if (small) Spacer(Modifier.width(10.dp))") &&
      worker.includes('if (type === "image/gif") return `GIF${once}`;') &&
      worker.includes('if (type.startsWith("image/")) return `Photo${once}`;') &&
      list.includes('fileLike && lower.endsWith(".gif") -> "GIF"') &&
      list.includes('if (t == "GIF" || t == "GIF \u00b7 View once") return t') &&
      viewer.includes("val oncePages = remember(pages, once)") &&
      viewer.includes("oncePages.getOrElse(pager.currentPage)") &&
      viewer.includes("oncePages.getOrElse(page) { pages[page] }") &&
      chatFx.includes("private var fxScaleCache = 1f") &&
      chatFx.includes("now - fxScaleAt < 2_000L") &&
      e2.includes('private const val V2 = "KP2."') &&
      e2.includes("fun packBackup(priv: String, pub: String, pass: String): String") &&
      e2.includes("fun unpackBackup(blob: String, pass: String)") &&
      e2.includes("fun tryRestore(ctx: Context, pass: String): Boolean") &&
      e2.includes("pendingRestore = remote") &&
      e2.includes("PBKDF2WithHmacSHA256") &&
      // New identities never upload KP1; a legacy blob is only replaced by
      // the explicit passphrase flow after its decoded pair matches locally.
      e2.includes("val legacy = decodeLegacyBackup(remote)") &&
      e2.includes("if (legacy != pair) return@runCatching false") &&
      !e2.includes("backupLocal(") &&
      backup.includes("Legacy backup — not passphrase-locked") &&
      backup.includes("Lock legacy backup") &&
      backup.includes("fun KeyBackupSheet(onClose: () -> Unit)") &&
      backup.includes("fun E2eeRestoreGate()") &&
      backup.includes("Wrong passphrase \u2014 try again") &&
      settings.includes('SettingRow(Icons.Filled.Key, "Message key backup"') &&
      list.includes("E2eeRestoreGate()"),
  );
}

/* ---------- r76-27: the audit's animations + haptics ---------- */
{
  const ui = main("Ui.kt");
  const viewer = main("MediaViewer.kt");
  const status = main("StatusScreens.kt");
  const chat = main("ChatScreen.kt");
  const list = main("ChatListScreen.kt");
  const backup = main("E2eeBackup.kt");
  check(
    "r76-27: hard pops learned to fade (viewer/composer/editor), quote bar rises, rows travel and fade out, badge springs, dot fades, top bar crossfades; saves/unlocks tick",
    ui.includes("fun Modifier.kpPopIn(zoom: Boolean = true): Modifier") &&
      viewer.includes(".then(if (heroSeat == null) Modifier.kpPopIn() else Modifier)") &&
      viewer.includes("if (!dismissBuzz && abs(dragLocal) > size.height * 0.16f) {") &&
      viewer.includes("savedPill = true") &&
      viewer.includes('"Saved to Pictures/KuchuPuchu",') &&
      viewer.includes("if (ok) haptics.confirm()") &&
      status.includes("Box(Modifier.kpPopIn()) {") &&
      chat.includes(".kpPopIn(zoom = false)") &&
      chat.includes(".popUp()") &&
      chat.includes(
        "Column(Modifier.animateItem(fadeInSpec = null, fadeOutSpec = tween(220))) {",
      ) &&
      list.includes('label = "chattopbar",') &&
      (
        list.match(
          /Box\(Modifier\.animateItem\(fadeOutSpec = androidx\.compose\.animation\.core\.tween\(200\)\)\)/g,
        ) || []
      ).length === 2 &&
      list.includes(
        "enter = androidx.compose.animation.scaleIn() + androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(150)),",
      ) &&
      list.includes(
        "enter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(300)) + androidx.compose.animation.scaleIn(),",
      ) &&
      (backup.match(/haptics\.confirm\(\)/g) || []).length === 2,
  );
}

/* ---------- r76-28: the owner's retest feedback ---------- */
{
  const flight = main("SendFlight.kt");
  const chat = main("ChatScreen.kt");
  const viewer = main("MediaViewer.kt");
  const status = main("StatusScreens.kt");
  const stickers = main("StickerSheet.kt");
  const list = main("ChatListScreen.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r76-28: flights fire 0.5 s after the ack, sub-switches same-x leftish, gifs ship real ratios, photo opens as a hero from its tile, status reply slims + resumes, presence goes realtime",
    flight.includes("sent: Boolean = true,") &&
      flight.includes("fun armIn(key: String, delayMs: Long): Boolean {") &&
      flight.includes(
        "withTimeoutOrNull(60_000L) { snapshotFlow { f.goAt >= 0L }.first { it } }",
      ) &&
      // r76-30: the wait is INVISIBLE now - the flight is the entrance.
      flight.includes("else -> 0f") &&
      chat.split("sent = !mine || !pendingEcho, key = fxKey").length === 6 &&
      chat.includes("Column(if (small) Modifier.width(150.dp) else Modifier.weight(1f)) {") &&
      chat.includes("val catalog = TenorGifs.gifs.firstOrNull { it.url == url }") &&
      chat.includes("gw = catalog.w") &&
      stickers.includes("val w: Int, val h: Int)") &&
      (stickers.match(/w = \d+, h = \d+\),/g) || []).length === 31 &&
      viewer.includes("object PhotoHero {") &&
      viewer.includes("heroFrom: androidx.compose.ui.geometry.Rect? = null,") &&
      viewer.includes("val heroSeat = remember { heroFrom }") &&
      // r90-2: one linear pass now
      viewer.includes("tween(320, easing = androidx.compose.animation.core.LinearEasing)") &&
      // r76-30: uniform scale now.
      viewer.includes("scaleX = androidx.compose.ui.util.lerp(s0, 1f, t)") &&
      chat.includes("hostView.getLocationOnScreen(loc)") &&
      chat.includes("heroFrom = PhotoHero.take(),") &&
      chat.includes("PhotoHero.lastId = null") &&
      status.includes("focusManager.clearFocus()") &&
      status.includes(".padding(start = 14.dp, end = 2.dp, top = 1.dp, bottom = 1.dp),") &&
      status.includes(".padding(vertical = 4.dp)") &&
      worker.includes('type: "presence",') &&
      worker.includes(
        "async function requireUser(db: D1Database, request: Request, env?: Env, ctx?: ExecutionContext) {",
      ) &&
      list.includes('"presence" -> refresh()'),
  );
}

/* ---------- r76-29: the owner's second retest - deterministic flight, hero v2, auto backup ---------- */
{
  const flight = main("SendFlight.kt");
  const chat = main("ChatScreen.kt");
  const viewer = main("MediaViewer.kt");
  const status = main("StatusScreens.kt");
  const e2 = main("E2eeMsg.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r76-29: the ack arms the flight (deterministic 0.5 s, swap-proof), 150dp sub-switch column, my gifs render from the cached CDN url, hero starts on the tile with no platform dim and reverses on close, pill slimmer, private-key backup is opt-in and passphrase-locked",
    flight.includes("f.goAt = android.os.SystemClock.uptimeMillis() + delayMs") &&
      flight.includes("if (f.goAt > android.os.SystemClock.uptimeMillis()) {") &&
      // r77-1/r77-6 superseded the ack-arm: the arm now lands at the echo's
      // birth with 0 wait (see the r77 crash/fix block at the bottom).
      // r81-8 emoji-only rows arrive unarmed now (self-arm after the
      // viewport gate); r92-4: the flight is back, arm and all.
      chat.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat.includes("Column(if (small) Modifier.width(150.dp) else Modifier.weight(1f)) {") &&
      // (r76-30 reverted the sender-side CDN detour - the R2 copy won.)
      chat.includes("hostView.getLocationOnScreen(loc)") &&
      worker.includes("...(fetchedSrc ? { src: fetchedSrc } : {}),") &&
      viewer.includes("w.setDimAmount(0f)") &&
      viewer.includes("val dismiss: () -> Unit = {") &&
      // r90-2: linear close now
      viewer.includes("tween(320, easing = androidx.compose.animation.core.LinearEasing)") &&
      viewer.includes("onDismissRequest = dismiss,") &&
      viewer.includes("alpha = dim * hero.value") &&
      status.includes(".padding(vertical = 4.dp)") &&
      e2.includes("identity(ctx)") &&
      e2.includes("packBackup(pair.first, pair.second, pass)") &&
      !e2.includes("backupLocal(") &&
      e2.includes("never uploaded automatically"),
  );
}

/* ---------- r76-30: the flight IS the entrance, alert rows bare, ratio-safe hero, back un-pauses status ---------- */
{
  const flight = main("SendFlight.kt");
  const chat = main("ChatScreen.kt");
  const viewer = main("MediaViewer.kt");
  const status = main("StatusScreens.kt");
  check(
    "r76-30: a mine row is INVISIBLE until its armed flight (no message in the chat before the animation), the two alert rows carry no instruction text, photoUrlOf is back to the R2 copy, the hero scales uniformly (ratio holds on close), BACK while the reply field is focused releases it so the video status resumes",
    flight.includes("if (v != 0f) v = 0f") &&
      !flight.includes("active && !sent -> 1f") &&
      !flight.includes("if (v != 1f) v = 1f") &&
      chat.split('sub = "",').length === 3 &&
      chat.includes("if (sub.isNotBlank()) Text(sub") &&
      chat.includes("internal fun photoUrlOf(m: JSONObject): String? =") &&
      !chat.includes("if (src.startsWith") &&
      viewer.includes("val s0 = maxOf(h.width / sw, h.height / sh)") &&
      viewer.includes("scaleX = androidx.compose.ui.util.lerp(s0, 1f, t)") &&
      status.includes("BackHandler(enabled = replyFocused)") &&
      status.includes("foldReplyKeyboard()") &&
      status.includes("hideSoftInputFromWindow(replyImeView.windowToken, 0)"),
  );
}

/* ---------- r77-crash: socket frames apply on Main; paintSent keeps no iterator ---------- */
{
  const api = main("Api.kt");
  const chat = main("ChatScreen.kt");
  const onMsg = api.slice(
    api.indexOf("override fun onMessage(webSocket: WebSocket, text: String)"),
    api.indexOf("override fun onFailure(webSocket: WebSocket"),
  );
  check(
    "r77-crash (owner v247 report: ConcurrentModificationException at paintSent): KpSocket.onMessage ran on OkHttp's reader thread while it structurally mutated the msgs/pending snapshot lists, racing the main thread's StateListIterator - frames are main-posted now, and paintSent's seat lookup is index-based like the r53 sweeps",
    api.includes(
      "private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())",
    ) &&
      onMsg.includes("mainHandler.post { listeners.forEach { l -> runCatching { l(ev) } } }") &&
      !chat.includes(
        'val idx = msgs.indexOfFirst { it.optString("id") == id || (cid.isNotBlank() && it.optString("clientId") == cid) }',
      ) &&
      chat.includes("var idx = -1") &&
      chat.includes("no iterator ever walks the live snapshot"),
  );
}

/* ---------- r77-1/r77-6: instant entrance at send; sending and sent are ONE ---------- */
{
  const chat = main("ChatScreen.kt");
  const flight = main("SendFlight.kt");
  check(
    'r77-1/r77-6 (owner: "item onek slow chat a paste hocche, instant animation diye asche na" + "send sending sent alada na ek kore daw, zero gap, alada kono animation effect kichui na"): a mine row\'s flight arms at the echo\'s BIRTH with no wait - the lift-off IS the entrance, the ack does nothing at all (first arm wins), and the echo->server swap shares one time-based flight keyed by clientId, so the swap is a silent seat swap with no second effect',
    // r81-8 emoji-only rows arrive unarmed now (self-arm after the
    // viewport gate); the birth arm below stays for every other kind.
    // r92-4: the flight is back - the arm lands at the echo's birth again.
    chat.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      !chat.includes("!pendingEcho && fxBorn) FlightAnims.armIn(fxKey, 500L") &&
      flight.includes("if (f.goAt >= 0L) return false") &&
      chat.includes(
        'val fxKey = remember { m.optString("clientId").ifBlank { m.optString("id") } }',
      ),
  );
}

/* ---------- r77-2: capture alerts are chat-only ---------- */
{
  const chat = main("ChatScreen.kt");
  const feel = main("Feel.kt");
  const worker = read("src/worker/index.ts");
  const cap = worker.slice(
    worker.indexOf("/capture$/"),
    worker.indexOf("afterMessageChanged(env, db, convId, { id: mid"),
  );
  check(
    'r77-2 (owner: "chat screenshot screen record alert a kono notification sound ba notification e thakbe na just chat a dekhabe"): the capture route pushes NOTHING, the alert row plays no tone and buzzes no buzz - the alert exists only as the small text line in the chat',
    !cap.includes("pushMessageUnlessHidden") &&
      cap.includes('r77-2 (owner: "kono notification sound ba notification e thakbe na just') &&
      !chat.includes("KpSounds.captureAlert(") &&
      !feel.includes("captureAlert"),
  );
}

/* ---------- r77-9: rapid toggle flips never dance back (writes serialized, pokes gated) ---------- */
{
  const settings = main("SettingsScreen.kt");
  const group = main("GroupInfoScreen.kt");
  // (anchors are find-the-literal-first: SettingsScreen has an earlier fun keyOf,
  // GroupInfoScreen an earlier val c = conv - absolute indexOf pairs mis-slice.)
  const save = settings.slice(
    settings.indexOf("val privMutex = remember { kotlinx.coroutines.sync.Mutex() }"),
  );
  const poke = group.slice(Math.max(0, group.indexOf("if (busy) return@LaunchedEffect") - 300));
  check(
    'r77-9 (owner: "toggle switch button ... bar bar on off korle auto kaj kore kichu somoy"): the Settings privacy writes are serialized (two rapid flips could ARRIVE or ANSWER out of order and the older truth put the switch back by itself - the r76-19 chat-privacy discipline, here), and the group-screen poke reload must not paint a pre-write truth over an in-flight flip',
    settings.includes("val privMutex = remember { kotlinx.coroutines.sync.Mutex() }") &&
      save.includes("privMutex.withLock {") &&
      poke.includes("if (busy) return@LaunchedEffect"),
  );
}

/* ---------- r77-10: privacy lands inside a poll tick, socket or no socket ---------- */
{
  const chat = main("ChatScreen.kt");
  const worker = read("src/worker/index.ts");
  check(
    'r77-10 (owner: "screenshot block on kori tobe opponent taw screenshot nite parche - app reopen na kora porjonto privacy apply hoi na, shob privacy tei same problem"): the messages poll carries the conversation\'s privacy truth (same rule/defaults as the detail payload), the freshness marker SEALS it (a flip busts `unchanged`), and the chat re-reads its detail the moment any field drifts - Guard and the save gates move within one tick instead of after a reopen. Behavior live-proven in 08-change-markers (baseline flags, unchanged tick, flip busts marker, new truth arrives)',
    worker.includes("const readReceiptSettings = {") &&
      worker.includes("let priv: Record<string, unknown> = { ...readReceiptSettings };") &&
      worker.includes("typingKind,\n        priv,\n      ]),") &&
      worker.includes("      marker,\n      priv,\n") &&
      chat.includes("val priv: JSONObject?,") &&
      chat.includes('priv = data.optJSONObject("priv"),') &&
      chat.includes('pv.optBoolean("peerShotOk", true)') &&
      chat.includes('pr != null && pv.has("meSave") &&') &&
      chat.includes("if (drifted) {"),
  );
}

/* ---------- r77-5: the attach gallery keeps its scroll across the editor detour ---------- */
{
  const sheet = main("AttachSheet.kt");
  const chat = main("ChatScreen.kt");
  check(
    'r77-5 (owner: "photo attach click korle photo selection page ... edit e click korle ... back dei ... photo selection already kora ache seigulo back korle previous position e chole asche na"): the selection itself already survived (attachSel lives on the chat); what died was the gallery GRID\'s scroll position - the mediaedit route unmounts the panel, so its in-panel remember zeroed. The grid state now lives on the chat and is saved with the back-stack entry (rememberSaveable), handed down as a parameter',
    sheet.includes("gridState: androidx.compose.foundation.lazy.grid.LazyGridState =") &&
      !sheet.includes(
        "val gridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()",
      ) &&
      chat.includes(
        "rememberSaveable(saver = androidx.compose.foundation.lazy.grid.LazyGridState.Saver)",
      ) &&
      chat.includes("gridState = attachGridState,"),
  );
}

/* ---------- r77-8: exactly ONE animation per emoji send ---------- */
{
  const chat = main("ChatScreen.kt");
  check(
    'r77-8 (owner: "emojis send korle first time animate hobe just ekbar, eita kortei onek session failed korche ... amar moner moto hoini"): every failed mode he lists came from the ack-armed double animation - the glyph re-playing at the server swap (appears, hides, re-animates) and the body clipping mid-flight. Emoji rows ride the one-motion flight now: armed at the echo\'s BIRTH (r77-1), keyed by clientId so the echo->server swap adds nothing (r77-6, the same LazyColumn key in pending and messages), and the glyph itself renders static (r76-18), so one send = one animation, never two',
    // r81-8 emoji-only rows arrive unarmed now (self-arm after the
    // viewport gate); the birth arm below stays for every other kind.
    // r92-4: the flight is back (light effects off, motion kept).
    chat.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat.includes(
        'val fxKey = remember { m.optString("clientId").ifBlank { m.optString("id") } }',
      ) &&
      chat.includes("val fxEmoji = fxBorn"),
  );
}

/* ---------- r77-3: the hero is the ONLY copy; the exit lands on the live seat ---------- */
{
  const viewer = main("MediaViewer.kt");
  const chat = main("ChatScreen.kt");
  check(
    'r77-3 (owner: "chat media open korle extract oi media tai animation hoye Fullscreen hoye asbe fake doublicate na ar photo theke ber hole extract ager position a chole jabe zero gap properly"): the tapped tile hides while its hero is out (no second render), the exit hero targets the tile\'s LIVE seat (the chat scrolls/rows arrive while the viewer is open - the old snapshot landed mid-air), and the tile returns one frame before the window detaches - zero gap, no blank',
    viewer.includes("var outId: String? by androidx.compose.runtime.mutableStateOf(null)") &&
      viewer.includes("fun seatOf(id: String?)") &&
      viewer.includes(
        "LaunchedEffect(pager.currentPage) { PhotoHero.outId = heroPageId.invoke(pager.currentPage) }",
      ) &&
      viewer.includes("PhotoHero.seatOf(it.invoke(pager.currentPage))") &&
      viewer.includes("androidx.compose.runtime.withFrameNanos { }") &&
      chat.includes('heroPageId = { i -> viewerPhotos.getOrNull(i)?.optString("id") ?: "" }') &&
      chat.includes(
        // r79-3: the hide/fade lives in PhotoHero.tileAlphaFor now (the
        // cross-fade handoff) - the formula moved, the gate did not.
        'alpha = PhotoHero.tileAlphaFor(m.optString("id").ifBlank { m.optString("clientId") })',
      ),
  );
}

/* ---------- r77-7: video-status reply - the FIRST back resumes the clip, any nav mode ---------- */
{
  const status = main("StatusScreens.kt");
  check(
    'r77-7 (owner: "video status a reply bar tap kore back koror media abar resume hoi na, extra back kora lage"): with button navigation the IME eats the first BACK, so the r76-30 BackHandler never fired and the clip sat paused until back #2 - an IME-collapse watcher now releases the reply focus the frame the keyboard folds, and the BackHandler flips the flag itself instead of waiting for onFocusChanged',
    status.includes("val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)") &&
      status.includes("LaunchedEffect(imeBottom) {") &&
      status.includes("if (imeBottom == 0 && replyFocused) {") &&
      status.includes("focusManager.clearFocus()\n        replyFocused = false") &&
      status.includes("import androidx.compose.foundation.layout.ime\n"),
  );
}

/* ---------- r78 round (owner retest after r77/v248) ---------- */
{
  const media = main("MediaViewer.kt");
  const chat = main("ChatScreen.kt");
  const fx = main("ChatFx.kt");
  const toggle = main("AnimatedToggleSwitch.kt");
  const attach = main("AttachSheet.kt");

  check(
    'r78-4 (owner retest: "allow screenshot on thaklei view once photo tuk kora jacche") + the owner\'s permanent rule: view-once media NEVER respects either Allow switch - the photo pager adds `once` to every one of its guard paths, plants FLAG_SECURE on the dialog window directly, and ref-counts it on the activity window too',
    media.includes("KpSecure.Guard(secure || !canSave || once)") &&
      media.includes("if (secure || !canSave || once) {") &&
      media.includes(
        "val secureWindow = (LocalView.current.parent as? DialogWindowProvider)?.window",
      ) &&
      media.includes("secureWindow?.setFlags(") &&
      media.split("android.view.WindowManager.LayoutParams.FLAG_SECURE").length - 1 >= 3 &&
      media.includes("val activityWindow = MainActivity.current?.window") &&
      media.includes("KpSecure.acquire(activityWindow)") &&
      media.includes("KpSecure.release(activityWindow)"),
  );

  check(
    "r78-4b: the once flag reaches the standalone video player (nav arg `kpOnce` for a view-once clip I received) and the player guards on `privateClip || onceClip` - the capture hole was the clip that was ONLY private by its once-ness",
    chat.includes('.also { if (once && !isMe) it.put("kpOnce", true) }') &&
      media.includes('val onceClip = m?.optBoolean("kpOnce") == true') &&
      media.includes("KpSecure.Guard(privateClip || onceClip)"),
  );

  check(
    'r78-6/r78-8 (owner: "emoji send korle 0.2 seconds flicking kore halka kata pore abar thik hoi" + "first time animate hobe just ekbar"): the composer flight starts below the LazyColumn viewport, so a 66sp glyph painted CHOPPED at the list edge for ~30% of its entrance - emoji rows now take fxEmojiEntrance, one grow+fade fully inside the row\'s own bounds, clientId-keyed once-per-message, and every non-emoji row keeps its flight',
    // r85-1: the bespoke entrance is GONE - emoji rows ride the text flight
    // (armed at birth: a birth-armed row skips fxFlyIn's visibility gate
    // and ticks from its first frame).
    !fx.includes("fxEmojiEntrance") &&
      chat.includes(".fxSlotOpen(fxFresh)") &&
      chat.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat.includes('fxFlyIn(fxFresh, if (kind == "TEXT") 680') &&
      chat.includes(
        '.fxFlyIn(fxFresh, if (kind == "TEXT") 680 else if (kind == "FILE" && fileLooksVoice(m)) 720 else 700, isSent = mine, sent = !mine || !pendingEcho, key = fxKey)',
      ),
  );

  check(
    "r78-9 (owner retest: toggles still act on their own on rapid flips): AnimatedToggleSwitch keeps the intended state LOCALLY (`want`), flips it in the tap's own frame, and the animations chase `want` - a stale composition can no longer swallow or invert a rapid tap burst, and the parent truth re-syncs through LaunchedEffect(checked)",
    toggle.includes("var want by remember { mutableStateOf(checked) }") &&
      toggle.includes("LaunchedEffect(checked) { want = checked }") &&
      toggle.includes("LaunchedEffect(want)") &&
      toggle.includes("want = !want\n                    onCheckedChange(want)"),
  );

  check(
    'r78-5 (owner: "koyta media select korse oi gulai nai" + "back korle ager position a chole asho"): the attach pencil STAGES the pick and keeps the batch for EVERY count (Done replaces it back, Back/Discard reopen the panel with its ticks), the panel eats back layer by layer (fullscreen grid, then folders, then the chat closes the panel), and the chat-level close handler now sits BELOW those inner handlers so it no longer swallows the gesture first',
    chat.includes(
      "ScreenStore.editStageUri = item.uri.toString()\n                    showAttach = false",
    ) &&
      attach.includes("BackHandler(enabled = fullscreen) { setFullscreen(false) }") &&
      attach.includes("BackHandler(enabled = foldersOpen)") &&
      chat.includes("// r78-5: this handler must sit BELOW the panels it closes") &&
      chat.indexOf("// r78-5: this handler must sit BELOW the panels it closes") <
        chat.indexOf("AttachPanel(\n"),
  );
}

/* ---------- r78-10: call tones can never become a stuck "message sound," and back ---------- */
{
  const callNotify = main("CallNotify.kt");
  check(
    'r78-10 (owner: "theke theke massage er sounds na hoye call sounds play hoi" - every sound path audited: push types, FCM channels, KpSounds ids and the KpApp msg:1 frame are all disjoint; the one remaining way a phone plays a CALL tone on a message is a ring / ringback MediaPlayer that escaped every manual stop and loops forever): CallSounds self-caps both tones - a scheduled, epoch-guarded stop (> the server\'s ~60s unanswered sweep, so nothing legit is cut) burns any leaked loop',
    callNotify.includes("@Volatile private var ringEpoch = 0") &&
      callNotify.includes("ringEpoch += 1") &&
      callNotify.includes("val e = ringEpoch") &&
      callNotify.includes("if (e == ringEpoch && ring === player) stop()") &&
      callNotify.includes("95_000L") &&
      callNotify.includes("val eb = ringbackEpoch") &&
      callNotify.includes("eb == ringbackEpoch && ringback === player) stopRingback()") &&
      callNotify.includes("70_000L") &&
      callNotify.includes(
        "private val ringBirthHandler = android.os.Handler(android.os.Looper.getMainLooper())",
      ),
  );
}

/* ---------- r79 round (owner retest after r78): deeper root causes ---------- */
{
  const media = main("MediaViewer.kt");
  const chat = main("ChatScreen.kt");
  const fx = main("ChatFx.kt");
  const store = main("ScreenStore.kt");
  const edit = main("MediaEditScreen.kt");
  const anim = main("EmojiAnim.kt");

  check(
    'r79-5 (owner: "attach panel a i thakche but selected media selected thakche na"): the mediaedit nav route kills the chat composition below it, so the r78 in-remember batch died on every detour and the reopened panel was empty - the batch now lives in ScreenStore keyed by conversation (same clear sites), and the no-edit back paths on the staged pencil trip return to the panel like Discard does',
    store.includes("private val attachSelMap =") &&
      store.includes("fun attachPanelSel(convId: String)") &&
      chat.includes("val attachSel = remember { ScreenStore.attachPanelSel(convId) }") &&
      edit.includes(
        "BackHandler(enabled = !hasEdits && !cropping && !showDiscard && ScreenStore.editStageUri != null) {",
      ) &&
      edit.includes("if (ScreenStore.editStageUri != null) ScreenStore.reopenAttach = true"),
  );

  check(
    'r79-6/r79-8 root cause (owner: "ekhono halka flicking kore" + "first time animates hoi na"): every glyph is a LOTTIE - uncached first use painted the SYSTEM glyph, then swapped the Noto frame in ~100-300 ms later (the flicker), and that parse jank ate the birth animation window (no entrance). NotoEmojiWarm preloads the composition at draft / send / live-arrival, and fxEmojiEntrance now clocks from the row\'s FIRST LAYOUT (perception time), never from the arm',
    anim.includes("internal object NotoEmojiWarm {") &&
      anim.includes("fun preload(ctx: android.content.Context, body: String)") &&
      chat.includes("NotoEmojiWarm.preload(ctx, v)") &&
      chat.includes('if (kind == "TEXT") NotoEmojiWarm.preload(ctx, body)') &&
      chat.includes(
        'if (liveMsg.optString("kind") == "TEXT") NotoEmojiWarm.preload(ctx, liveMsg.optText("body"))',
      ) &&
      // r85-1: the custom entrance is gone - emoji rows ride the text
      // flight, armed at birth (birth-armed rows skip the visibility gate).
      !fx.includes("fxEmojiEntrance") &&
      chat.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      anim.includes("NotoEmojiWarm.peek(cacheKey)"),
  );

  check(
    'r79-3 (owner: "close a photo age thekei thakche + overlap + position a na"): the hidden-tile handoff snapped released at the very END of the close flight - any window-level seat disagreement flashed the photo twice. The handoff is now a CROSS-FADE over the close\'s last 45% (hero opacity down, tile opacity up on the same progress), album tiles gained the seat report + hide wiring they never had (they opened with no entrance and closed to nothing before)',
    media.includes("var heroCloseT by androidx.compose.runtime.mutableStateOf(0f)") &&
      media.includes("fun tileAlphaFor(id: String?): Float") &&
      // r91-2: the cross-fade math is gone - the tile is flat-hidden for
      // the whole trip (hard handoff at the landing frame).
      media
        .slice(media.indexOf("fun tileAlphaFor"), media.indexOf("fun tileAlphaFor") + 900)
        .includes("return 0f") &&
      media.includes("PhotoHero.heroCloseT = if (closing) v else 0f") &&
      // r89-2: the hero itself no longer fades on close (pure reverse
      // flight); r91-2 removed the tile-side cross-fade too (flat hide).
      !media.includes("alpha = if (closing && t < 0.45f)") &&
      chat.includes("alpha = PhotoHero.tileAlphaFor(") &&
      chat.includes(
        'val photoId = photo.optString("id").ifBlank { photo.optString("clientId") }',
      ) &&
      chat.includes(".graphicsLayer { alpha = PhotoHero.tileAlphaFor(photoId) }") &&
      chat.includes("PhotoHero.set(\n                    photoId,"),
  );
}

/* ---------- r80 round (owner retest after r79): the certainty round ---------- */
{
  const media2 = main("MediaViewer.kt");
  const chat2 = main("ChatScreen.kt");
  const anim2 = main("EmojiAnim.kt");
  const fx2 = main("ChatFx.kt");
  const ui2 = main("Ui.kt");
  const list2 = main("ChatListScreen.kt");

  check(
    'r80-6 (owner: "not fixed" - the flicker SURVIVED warming): rememberLottieComposition is async even on a warm cache, so every glyph was born composition==null, painted the SYSTEM emoji for a frame or two, then swapped the Noto frame in - and that swap IS the flicker. The glyph now seeds its composition state SYNCHRONOUSLY from LottieCompositionCache (the r79 warm fills it), and only runs the async loader on a true cold miss',
    anim2.includes("NotoEmojiWarm.peek(cacheKey)") &&
      anim2.includes("val cacheKey = if (isBundled) assetName else netUrl") &&
      anim2.includes("kotlinx.coroutines.suspendCancellableCoroutine { cont ->") &&
      !anim2.includes("rememberLottieComposition("),
  );

  check(
    'r80-8 (owner: "not fixed" - no entrance, settles instantly): two clocks already died on device (r78 wall-clock eaten by first-frame jank, r79 layout-anchor never visible). The entrance now rides the ONE family of animation the owner demonstrably SEES: the row flight - time-based, GLOBAL per key (FlightAnims.birth + valueAt + the same withFrameNanos tick), gated on fxBorn (survives churn) with a self-arm fallback, armed at birth for mine and armed in fast-paint for emoji-only received rows; the old second birth animator (glyph-row fxPopIn) is gone so one message is one animation',
    !fx2.includes("fxEmojiEntrance") &&
      chat2.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat2.includes('fxFlyIn(fxFresh, if (kind == "TEXT") 680') &&
      // r81-8: no external arm for received emoji (self-arm only)
      !chat2.includes("FlightAnims.armIn(liveMsg") &&
      // r81-8: external arming was REMOVED (r81) - the entrance self-arms
      // only after the r76-21 viewport gate, or the clock ran out
      // off-screen ("first time animates hoi na").
      chat2.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      anim2.includes("Modifier.padding(start = 2.dp, end = 2.dp),") &&
      !anim2.includes("fxPopIn("),
  );

  check(
    'r80-3a (owner: "click korle late kore open hoi, onek rudely hoi"): TWO device-real roots - (i) the open clock started at LaunchedEffect(Unit) while the new dialog window warmed and the pager was still unmeasured, so the grow half elapsed unseen and the size-guard let one fullscreen frame POP before the transform applied; the sprint now starts on the viewer FIRST REAL LAYOUT (openLaidOut latch) and pre-layout frames are invisible (alpha 0), so the first thing seen is the photo AT the tile and the full 320 ms plays',
    media2.includes("var openLaidOut by remember { mutableStateOf(false) }") &&
      media2.includes("LaunchedEffect(openLaidOut) {") &&
      media2.includes(".onGloballyPositioned { openLaidOut = true }") &&
      media2.includes("alpha = if (heroSeat != null && !openLaidOut) 0f else 1f"),
  );

  check(
    'r80-3b (owner: "late open"): (ii) the tile decodes at 720/480px but the viewer asks 1200px and Coil never serves a SMALLER cached bitmap, so the tile never primed the viewer - most opens were a network/blank window. The tile now deposits its own decoded pixels into PhotoHero (bounded 24; view-once deposits nothing - H3), KpNetImage gained a placeholderBitmap base layer, and every viewer page paints the tile bitmap as its first frame so the flight always starts on the real picture and the full image crossfades/sharpens over it',
    media2.includes("private val bitmaps =") &&
      media2.includes("fun setBitmap(id: String, bmp: android.graphics.Bitmap)") &&
      media2.includes("fun bitmapOf(id: String?): android.graphics.Bitmap?") &&
      media2.includes(
        "placeholderBitmap = if (once) null else PhotoHero.bitmapOf(heroPageId?.invoke(page))",
      ) &&
      ui2.includes("placeholderBitmap: android.graphics.Bitmap? = null") &&
      ui2.includes("onDecoded: ((android.graphics.Bitmap) -> Unit)? = null") &&
      chat2.includes("PhotoHero.setBitmap("),
  );

  check(
    'r80-5 (owner: "system back ta full app i same hobe - kothaw jeno ekbare back na hoi, previous screen option a jai"): the nav root (main/ChatListScreen) was the ONE place a system back FINISHED the whole app - now back walks tabs to Chats first, then PARKS the app (moveTaskToBack, state survives), and it only fires when nothing above consumed the back; non-root routes keep popping to their previous screen via the NavHost',
    list2.includes("MainActivity.current?.moveTaskToBack(true)") &&
      list2.includes("androidx.activity.compose.BackHandler(enabled = !selecting) {"),
  );
}

/* ---------- r81 round (owner retest after r80): geometry + smoothness ---------- */
{
  const media3 = main("MediaViewer.kt");
  const chat3 = main("ChatScreen.kt");
  const fx3 = main("ChatFx.kt");
  const app3 = main("KpApp.kt");

  check(
    'r81-6/8 (retargeted r83-1; owner: "emojis left theke animate kore asche - normal massage jemon right er nicher theke" + "first time animates hoi na ekhono"): TWO device-true causes - (a) the entrance pivoted around the full-width ROW\'s center (= the screen\'s center), so a right-side bubble grew out of mid-screen and read as arriving from the LEFT; the pivot is the bubble corner now (1,1 mine / 0,1 theirs - the fxFlyIn geometry the owner calls normal). (b) SUPERSEDED by r83-1: the coroutine-gated self-arm (r76-21 viewport gate, 600 ms cap) still left the FIRST send of a session settled on device, so the arm moved into the layout callback itself - the same seat-inside-listBounds test now runs inside onGloballyPositioned and sets the clock the moment the row is first laid out on screen (fx4 r83-1 pin); the birth-arm for emoji rows stays removed',
    !fx3.includes("fxEmojiEntrance") &&
      chat3.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat3.includes('fxFlyIn(fxFresh, if (kind == "TEXT") 680') &&
      chat3.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)"),
  );

  check(
    'r81-3a smoothness (owner: "animation ta smooth hobe"): the open/close flights traded the fast-out punch for the Material emphasized pair - decelerate (0.05,0.7,0.1,1) over 400 ms on the way in, accelerate (0.3,0,0.8,0.15) over 300 ms on the way out; the photo viewer and the video player share the same pair (r90-2 supersedes: ONE linear 320 ms pass each way)',
    media3.includes(
      "hero.animateTo(\n                1f,\n                tween(320, easing = androidx.compose.animation.core.LinearEasing)",
    ) && media3.includes("tween(320, easing = androidx.compose.animation.core.LinearEasing)"),
  );

  check(
    "r81-3b video (owner: \"video chat er all media same vabe open hobe\"): the player was a plain nav-route with the default horizontal slide fighting whatever motion played inside - it now owns the SAME hero as the photo viewer: the tapped tile deposits its poster + seat (VideoMessageRow), onOpenVideo hands the seat over (PhotoHero.lastId), VideoPlayerScreen takes it, hides the tile (outId), stays invisible until its first real layout, grows from the seat on the emphasized curve with the tile's poster as the base layer, cross-fades the tile in during the close's last 45% (heroCloseT), and both the system back and the top-bar back run the reverse flight before popping; the route transition is a quiet fade",
    chat3.includes(
      'PhotoHero.lastId = msg.optString("id").ifBlank { msg.optString("clientId") }\n                                // Owner round 31: the app\'s own player',
    ) &&
      chat3.includes('val vidId = m.optString("id").ifBlank { m.optString("clientId") }') &&
      chat3.includes(".graphicsLayer { alpha = PhotoHero.tileAlphaFor(vidId) }") &&
      media3.includes("val vidHeroSeat = remember { PhotoHero.take() }") &&
      media3.includes("var vidHeroLaidOut by remember { mutableStateOf(false) }") &&
      media3.includes("val vidPoster = remember(vidHeroId) { PhotoHero.bitmapOf(vidHeroId) }") &&
      media3.includes(
        "BackHandler(enabled = vidHeroSeat != null && !vidClosing) { dismissVid() }",
      ) &&
      media3.includes("PhotoHero.heroCloseT = if (vidClosing) v else 0f") &&
      app3.includes(
        '"videoplayer/{b64}",\n                    enterTransition = { fadeIn(tween(140)) }',
      ),
  );

  check(
    'r81-3c view-once (owner: "ounce view o"): the once-card was a busy galaxy card with NO hero wiring at all - photo cards now report their seat and honour the hero hide/cross-fade exactly like a normal tile, so the view-once viewer grows out of the card the same way (voice once-cards stay cards)',
    chat3.includes('val onceId = m.optString("id").ifBlank { m.optString("clientId") }') &&
      chat3.includes(
        ".graphicsLayer { alpha = if (voice) 1f else PhotoHero.tileAlphaFor(onceId) }",
      ) &&
      chat3.includes("PhotoHero.set(\n                                onceId,"),
  );
}

/* ---------- r82 round (owner retest after r81): three alive-on-device bugs ---------- */
{
  const fx4 = main("ChatFx.kt");
  const media4 = main("MediaViewer.kt");
  const ui4 = main("Ui.kt");
  const notify4 = main("KpNotify.kt");
  const nids4 = main("NotifyIds.kt");
  const pick4 = main("StatusPickScreen.kt");
  const edit4 = main("MediaEditScreen.kt");
  const settings4 = main("SettingsScreen.kt");
  const anim4 = main("EmojiAnim.kt");
  const voice4 = main("VoiceNote.kt");
  const worker4 = read("src/worker/index.ts");
  const chat4 = main("ChatScreen.kt");
  const list4 = main("ChatListScreen.kt");
  const store4 = main("ScreenStore.kt");
  const kpapp4 = main("KpApp.kt");
  const flight4 = main("SendFlight.kt");
  const feel4 = main("Feel.kt");
  const calln4 = main("CallNotify.kt");
  const attach4 = main("AttachSheet.kt");
  const contacts4 = main("ContactsScreens.kt");

  check(
    'r83-1 (owner r83 #1: "shob thik ache just animate hoi na first time" - STILL dead after r78/r81/r82): every prior design armed the emoji flight from inside a cancellable LaunchedEffect, so the first send of a session painted settled on device while later sends flew. The arm is now bound to the layout pass itself - the onGloballyPositioned report that puts the seat inside the list viewport sets the clock (fxFlyIn\'s device-proven live-seat signal); the coroutine only waits on the armed flag and ticks, and a 600 ms fallback arm covers a row that never becomes visible',
    // r85-1 SUPERSEDES r83-1: the whole custom entrance was deleted -
    // emoji rows ride the text flight, armed at birth.
    !fx4.includes("fxEmojiEntrance") &&
      chat4.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat4.includes('fxFlyIn(fxFresh, if (kind == "TEXT") 680'),
  );

  check(
    'r82-2 (owner: "video open kore back korle chat a ekdom niche niye asche auto ... baki media gulaw dekho"): the LazyListState saver + didInitialScroll saveable were BOTH shipped for this and still fail - the covered nav destination\'s save bundle does not survive the dispose on device. The chat now RECORDS its scroll spot into ScreenStore.chatReturnScroll before pushing ANY in-app viewer route (video player / doc viewer / media editor, all four exit points), and the return consumes the record and restores exactly that spot as the initial position; the newest-message jump is skipped because didInitialScroll seeds true when a record exists',
    store4.includes("val chatReturnScroll = java.util.HashMap<String, Pair<Int, Int>>()") &&
      chat4.includes("val markViewerReturn: () -> Unit = {") &&
      (chat4.match(/markViewerReturn\(\)/g) || []).length >= 4 &&
      chat4.includes("ScreenStore.chatReturnScroll.remove(convId)") &&
      chat4.includes("mutableStateOf(returnScroll != null)") &&
      chat4.includes(
        "runCatching { listState.scrollToItem(returnScroll.first, returnScroll.second) }",
      ),
  );

  check(
    'r82-3 (owner: "nav bar a unread number ta ekdom baje vabe show hocche ... massage button er right corner a rekhe daw ar double number hole double line jeno na hoi"): the count no longer sits inline after the tab label (pill crush = the ugly wrap) - it is an overlay pinned to the Chats icon\'s top-right corner with zero width pressure, and maxLines=1 + softWrap=false hard-lock one line so a two-digit count can never stack',
    list4.includes(".align(Alignment.TopEnd)") &&
      list4.includes("offset(x = 6.dp * sizeScale, y = (-8).dp * sizeScale)") &&
      list4.includes("lineHeight = 11.sp * sizeScale,"),
  );
  check(
    'r84-1 (owner r84 #1: "emoji ekhono first time animates hoi na" - STILL dead after r78/r81/r82/r83): every prior round carried a 600 ms CAP on the entrance\'s visibility wait, and on the first send of a session the list is still settling (page fill, newest snap, keyboard glide) so the row could pass the cap OFF SCREEN - the fallback started the clock there and the whole window was spent before a visible frame. The wait is UNCAPPED now (cancelled on dispose), the layout callback only FLAGS visibility, and the clock starts only after the GLYPH is in hand (EmojiGlyphWarm - the warm cache marks readiness without a composition, so the entrance plays on the real glyph, never the system fallback + swap); the glyph wait itself is capped 1.2 s for a never-seen emoji',
    // r85-1 SUPERSEDES r84-1: the custom entrance and the glyph-ready
    // machinery were deleted - emoji rows ride the text flight, armed at
    // birth (a birth-armed row skips fxFlyIn's visibility gate and ticks
    // from its first frame - why text bubbles always animated).
    !anim4.includes("EmojiGlyphWarm") &&
      !fx4.includes("fxEmojiEntrance") &&
      chat4.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat4.includes('fxFlyIn(fxFresh, if (kind == "TEXT") 680'),
  );

  check(
    'r84-2 (owner r84 #2: "video theke ber hocche jokhon background black thakche chat dekha jai na photo er moto"): the player was a nav ROUTE from the chat, and while a route is on top the chat destination is NOT composed - the close flight played against the nav host\'s black container. From the chat the player now rides an in-compose Dialog (KpVideoOverlay) exactly like the photo viewer: the chat stays alive behind it, close shrinks into the tile over the live chat, open skips the route push (also r84 #6), and the scroll position survives by itself - the chat is never disposed',
    media4.includes("fun KpVideoOverlay(nav: NavController, arg: String, onClose: () -> Unit) {") &&
      media4.includes("VideoPlayerScreen(nav, arg, overlayClose = onClose)") &&
      media4.includes(
        "val closePlayer: () -> Unit = { if (overlayClose != null) overlayClose() else nav.popBackStack() }",
      ) &&
      chat4.includes("var videoOverlayArg by remember { mutableStateOf<String?>(null) }") &&
      chat4.includes("KpVideoOverlay(nav, varg) { videoOverlayArg = null }") &&
      !chat4.includes('nav.navigate("videoplayer/'),
  );

  check(
    'r84-3 (owner r84 #3: "voice button hold kore record korte ektu late start hocche super fast hobe"): MediaRecorder prepare()+start() ran ON MAIN before recording=true, so 50-150 ms of encoder spin-up was dead time between the finger and the first hint the take began. The UI flips instantly on the press, the tone plays immediately, and the recorder spins up off-main with a session guard - a hold that ends mid-spin-up discards the orphan take instead of leaking it',
    chat4.includes("val session = ++voiceSession") &&
      chat4.includes("val ok = withContext(Dispatchers.IO) { VoiceNote.start(ctx) }") &&
      chat4.includes("ok -> VoiceNote.discard()") &&
      voice4.includes("@Synchronized\n    fun discard() {") &&
      voice4.includes("@Synchronized\n    fun start(ctx: Context): Boolean ="),
  );

  check(
    'r84-4 (owner r84 #4: "opponent all open na korle double tick hoi na mane user background a notification peleo delivered dekhai na"): delivered_at was only stamped by the recipient\'s OWN activity (socket connect / list poll / chat open) - a backgrounded phone with a tray card left the sender on one tick. FCM ACCEPTING the message push now stamps the row delivered at the same moment the live-socket path does, and the sender is told at once (room "delivered" frame + list poke, gated on a real NULL->set flip)',
    worker4.includes("if ((live > 0 || pushed) && !stamped) await stampDelivered();") &&
      worker4.includes("const pushed = await pushToUser(") &&
      worker4.includes("ctx.waitUntil(pokeUserReceipt(env, uid, convId, at));"),
  );

  check(
    'r84-5 (owner r84 #5: "calling ringing a same problem call notification geleo ringing dekhai na app open na kora porjonto"): the caller\'s "Ringing…" text was gated on the callee\'s LIVE presence (otherOnline from last_active_at), so a backgrounded callee with a call notification still read "Calling…". The call row now carries reached_at - stamped when FCM accepts the ring push - and otherOnline is true whenever the push reached the phone',
    worker4.includes("ALTER TABLE calls ADD COLUMN reached_at TEXT") &&
      worker4.includes("reached_at?: string | null;") &&
      worker4.includes("onlineNow(other) || row.reached_at != null") &&
      worker4.includes("UPDATE calls SET reached_at = ? WHERE id = ? AND reached_at IS NULL"),
  );

  check(
    "r84-6 (owner r84 #6: \"photo open korle late open hoi video o same super fast hobe\"): the hero open/close flights shortened to the same emphasized curves over 280 ms in and 220 ms out (was 400/300) - the open's first frame was already the tile's own pixels (r80-3), so the remaining latency was the flight length itself",
    (media4.match(/tween\(320, easing = androidx\.compose\.animation\.core\.LinearEasing\)/g) || [])
      .length === 2 &&
      !media4.includes(
        "tween(300, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))",
      ) &&
      !media4.includes(
        "tween(280, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))",
      ),
  );

  check(
    "r85-2 (owner r85 #2: \"ekhon full black background na tobe dim black mone hocche\"): the leftover grey-black behind the fading player was the overlay DIALOG's platform dim. The overlay window now sets dim 0 (the photo viewer's rule) and the player's own backdrop fades WITH the hero - open brings the black up as the clip grows, close drains it back out over the live chat",
    media4.includes("w.setDimAmount(0f)") &&
      media4.includes(
        ".background(Color.Black.copy(alpha = if (vidHeroSeat != null) vidHero.value else 1f))",
      ),
  );

  check(
    'r85-3 (owner r85 #3: "voice cancel animation ta fast koto ekhon slow ache"): the cancel swallow (window flyer + dustbin lid) spent 900 ms linear - a lazy amble. It now spends 420 ms end to end; the release paths and segment easings are untouched',
    chat4.includes("swallowT.animateTo(1f, tween(420, easing = LinearEasing))") &&
      !chat4.includes("tween(900, easing = LinearEasing)"),
  );

  check(
    'r85-4 (owner r85 #6: "super fast hoini instant"): the hero OPEN flight shortened again - 280 ms to 180 ms (same emphasized decelerate curve) on both the photo viewer and the video overlay; close keeps its 220 ms',
    (media4.match(/tween\(320, easing = androidx\.compose\.animation\.core\.LinearEasing\)/g) || [])
      .length === 2,
  );
  check(
    'r87-1 (retargeted r88-1; owner r87 #1: "sending er somoy hoi thik ache but sent hobar por abar reanimate keno ... send sending sent zero gap"): the birth dance is GLOBAL and TIME-BASED per message key - EmojiDance (begin idempotent, progress off the wall clock), the same swap-proof pattern the row flights ride. The pending echo starts the clock the moment its glyph composition is in hand; the server row that takes the seat keys on the SAME stable fxKey (clientId-first, handed down EmojiGlyphRow danceKey -> NotoEmojiGlyph -> NotoAnimatedEmoji liveDanceKey) and renders at the CURRENT global frame - no restart, no freeze, no second pass. A cold glyph starts the clock the moment its composition lands; taps keep the local replay (replayKey seeds 0 now); history rows never dance',
    anim4.includes("internal object EmojiDance {") &&
      anim4.includes("fun begin(key: String): Long =") &&
      anim4.includes("fun progress(key: String, durationMs: Int): Float {") &&
      anim4.includes("EmojiDance.begin(liveDanceKey)") &&
      anim4.includes("if (liveDanceKey != null && replayKey == 0) {") &&
      anim4.includes("val resume = EmojiDance.progress(liveDanceKey, durMs)") &&
      anim4.includes("initialProgress = resume") &&
      !anim4.includes("liveT") &&
      anim4.includes("liveDanceKey: String? = null,") &&
      anim4.includes("var replayKey by remember(mid, ch) { mutableStateOf(0) }"),
  );

  check(
    'r87-2 (superseded by r88-2; owner r87 #2: "animation ta smooth koro hotath open hoi hotath close hoi smooth na ... once view soho chat a all medias same animation hobe"): the 180 ms open read as a snap (the r84-r85 speed hunt overshot); the flights moved to 460 ms in / 400 ms out and r88-2 made the path TWO-segment (tile -> centre at 58% -> fullscreen) - r90-2 supersedes both: ONE linear 320 ms pass each way. The photo viewer, the video overlay and the view-once photo pages share the one composable, so every chat media (once included) plays the identical flight',
    (media4.match(/tween\(320, easing = androidx\.compose\.animation\.core\.LinearEasing\)/g) || [])
      .length === 2 &&
      !media4.includes(
        "tween(180, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))",
      ),
  );

  check(
    'r86-1 (retargeted r87-1; owner r87 #1: "sending animation hoi sent hole abar stop hoye animation hoi ... send sending sent zero gap"): the r86 per-composition dance seed RESTARTED the pass at the pending->server swap (two different compositions, two local clocks - the emoji froze a beat and danced again as soon as the row read sent). The birth dance now rides a GLOBAL time-based clock (EmojiDance, the FlightAnims pattern): the echo\'s glyph starts it exactly once and the server row RESUMES the same wall-clock frame - one continuous dance from sending to sent, the swap invisible; fxEmoji still gates on fxBorn (live births only, history static), taps keep the local replay',
    chat4.includes("val fxEmoji = fxBorn") &&
      !chat4.includes("val fxEmoji = false") &&
      anim4.includes("internal object EmojiDance {") &&
      anim4.includes(
        "liveDanceKey = if (active && isSingle && animScale > 0f) danceKey else null",
      ) &&
      [...chat4.matchAll(/EmojiGlyphRow\([\s\S]*?^\s*\)/gm)].length === 3 &&
      [...chat4.matchAll(/EmojiGlyphRow\([\s\S]*?^\s*\)/gm)].every(
        ([call]) => call.includes("danceKey = fxKey,") && call.includes("onTap = onRevealStamp,"),
      ),
  );

  check(
    "r86-4 (owner r86 #4: delivered tick \"aro fast possible hole kore daw\"): the stamp left FCM's roundtrip critical path - a recipient with any registered device is stamped the moment the send loop reaches them (the tray card is delivery, r84-4's rule), the sender is told at once, and FCM's own acceptance only backstops the no-device case",
    worker4.includes("const stampDelivered = async () => {") &&
      worker4.includes(
        "(SELECT EXISTS(SELECT 1 FROM devices WHERE devices.user_id = members.user_id)) AS has_device",
      ) &&
      worker4.includes("if (hasDevice) {") &&
      worker4.includes("if ((live > 0 || pushed) && !stamped) await stampDelivered();"),
  );
  check(
    "r88-1 (owner r88 #1: \"first time animates hoi na ... tap korleo animate hoi na majhe majhe hoi\"): r87's separate wall-clock render loop SHADOWED the tap replay for the whole (seconds-long) birth window - a tap inside it looked dead - and a 0-duration composition ended the birth before a frame. ONE driver now: the birth dance and the tap replay are the SAME animatable pass (the library's own frame clock, what a tap has always used). A live birth starts at the global clock's current frame (EmojiDance.begin + progress -> initialProgress = resume), so the pending->server swap resumes exactly where the echo left off - zero gap, no restart, no freeze - and a tap always restarts from 0 and shows immediately; a 0-duration composition falls back to a 1200 ms window",
    anim4.includes("if (liveDanceKey != null && replayKey == 0) {") &&
      anim4.includes("EmojiDance.begin(liveDanceKey)") &&
      anim4.includes("initialProgress = resume") &&
      !anim4.includes("liveT"),
  );

  check(
    'r90-2 (owner r90 #2: "middle theke zoom in hocche Only ar middle a fast asche Fullscreen hocche slow but shob time speed same Hobe closing o fast same koro ar smoothly shob shortcut na"): the two-segment hop is GONE - the hero is ONE continuous linear flight (position and scale travel together at the same constant speed, tile -> fullscreen, uniform scale so the ratio holds - r76-30), and the close is the same 320 ms pass played backwards at the same speed (r92-2: the target is measured in the layers own screen space). The photo viewer and the video overlay share the literals, so every chat media (once included) plays the identical flight',
    !media4.includes("sMid") &&
      !media4.includes("tween(460") &&
      !media4.includes("tween(400") &&
      (media4.match(/lerp\(s0, 1f, t\)/g) || []).length === 2 &&
      (media4.match(/lerp\(h\.center\.x - cx, 0f, t\)/g) || []).length === 2 &&
      (media4.match(/lerp\(h\.center\.y - cy, 0f, t\)/g) || []).length === 2 &&
      (
        media4.match(/tween\(320, easing = androidx\.compose\.animation\.core\.LinearEasing\)/g) ||
        []
      ).length === 2 &&
      // r93-2 (owner r93 #2: "fixed but finishing ta rudely hoye geche"):
      // the CLOSE eases its tail (an ease-out curve) so the landing settles
      // instead of stopping dead at full speed; the open stays linear.
      (
        media4.match(
          /tween\(320, easing = androidx\.compose\.animation\.core\.CubicBezierEasing\(0\.4f, 0f, 1f, 1f\)\)/g,
        ) || []
      ).length === 2,
  );
  check(
    'r89-2 (owner r89 #2: "exactly oi media tai aste aste middle a ashe fullscreen a hobe ... fake fade effect add korecho"): the media page itself never fades - KpNetImage crossfade(false) on every path (the tile pixels are the base layer and the full decode hard-swaps under the flight), and the CLOSE is the pure reverse flight (r90-2 made it one linear pass): neither the photo pager nor the video player fades its hero out any more (the chat tile cross-fades underneath, invisible while the hero covers it - the r79-3 duplicate guard survives on the tile side)',
    ui4.includes(".crossfade(false)") &&
      !media4.includes("alpha = if (closing && t < 0.45f)") &&
      !media4.includes("vidClosing && t < 0.45f"),
  );

  check(
    'r89-3 (owner r89 #3: "amay keo massage send korle call ringtone 7 ta play hoi, ami massage tone onno ta set kore rakhleo"): on several OEM ROMs a channel deleted and recreated under the SAME id keeps its ORIGINAL sound (the tombstone) - the r76-25 recreate never changed the tone on those phones, so messages kept playing the channel\'s birth sound (an old call-style ring that trings ~7 times). Message cards now ride a PER-TONE channel id (kp_msg_t<index>, siblings swept) and kp_messages_v2 stays as the FCM fallback the system payload names',
    notify4.includes(
      'private fun toneChannelFor(ctx: Context): String = "kp_msg_t${SoundPrefs.notifIndex(ctx)}"',
    ) &&
      notify4.includes("for (i in SoundPrefs.notifRes.indices) {") &&
      notify4.includes("if (muted) SILENT_CHANNEL else toneChannelFor(ctx)"),
  );

  check(
    "r89-4 (owner r89 #4: system back = the PREVIOUS screen, everywhere): (a) the status media picker stays in the back stack - back from the editor without sharing returns to the picker (the popUpTo-inclusive that destroyed it is gone), and a real share pops editor+picker together; (b) Settings > Appearance > Sounds keeps the sounds screen under the ringtone picker - back from the picker returns to Sounds, not Appearance",
    !pick4.includes('popUpTo("statuspick")') &&
      edit4.includes('nav.popBackStack("statuspick", true)') &&
      settings4.includes("soundKind = kind\n                showRingPicker = true") &&
      !settings4.includes("onPick = { kind ->\n                showSoundType = false"),
  );

  check(
    'r92-4 (owner r92 #4, r91 #4 "not fixed (regression)": "tomay bolechi light effect remove korte massage send animation jemon right side er nicher theke asto ota remove na korte"): the SEND FLIGHT IS BACK exactly as it was - fxFresh claims per stable key and the birth arm lands at the echo, so a sent message rises in from the bottom-right corner the way it always did. What is removed is the LIGHT effect only: the letter-by-letter reveal stays deleted AND the blue shine sweep (fxShineRipple) no longer fires on a landing. The emoji dance is a different gate (fxEmoji = fxBorn) and is untouched',
    !chat4.includes("fxLetterSpans") &&
      !fx4.includes("fun fxLetterSpans") &&
      !chat4.includes(".fxShineRipple(") &&
      chat4.includes("val fxFresh = remember { fxBorn && FxFlights.claim(fxKey) }") &&
      chat4.includes("if (mine && fxBorn) FlightAnims.armIn(fxKey, 0L)") &&
      chat4.includes("val fxEmoji = fxBorn"),
  );

  check(
    'r93-4 (owner r93 #4: "massage ekhon halka right theke zoom hoye asche but ami chai full right side theke asbe massage ta right side er ektu niche mane corner theke. fast asbe slow na ar eshe bonus Hobe"): the sent bubble no longer zooms in place - it FLIES IN from the bottom-right corner: off the list right edge a little below its seat, at full size (no zoom), FAST (the caller duration is halved, clamped 240-360 ms), and it settles with a small overshoot bounce over the last 28% (the bonus). r101: the received rows now fly the mirrored corner flight instead of the old corner grow',
    flight4.includes(
      "val dur = ((durMs * 0.5f * scale).toInt().coerceIn(240, 360)).coerceAtLeast(1)",
    ) &&
      flight4.includes("translationX = x0 * inv - bounce") &&
      flight4.includes("sin((v0 - 0.75f) / 0.25f * PI.toFloat()) * 18f * density"),
  );

  check(
    'r101 (owner r100: "ekhon jemon massage send korle right side a nicher theke asche Receiver er screen o same sevabe asbe tobe left er ektu niche theke"): the RECEIVED bubble flies in exactly like the sent one, mirrored - off the LEFT edge of the list (x0 = -(seat.right - list.left + 14dp), fallback -120dp), 110dp below its seat, full size (no zoom), the same halved fast duration, and the same little overshoot bounce over the last 28% (ADDED past the landing - the mirror of the sent subtraction). Only live arrivals fly (fxFresh gates, r96 bornHere + r97 armed-adoption floors intact); history/loadOlder/reopen never do',
    flight4.includes(
      "val x0 = if (s != null && lb != null) -(s.right - lb.left + 14f * density) else -120f * density",
    ) &&
      flight4.includes("translationX = x0 * inv + bounce") &&
      flight4.includes("translationY = y0 * inv") &&
      (flight4.match(/val y0 = 110f \* density/g) || []).length === 2 &&
      !flight4.includes("val sc = 0.6f + 0.4f * v0"),
  );

  check(
    'r102 + r103 (owner r101: "bouns effect nei massage send receive a"; r102 test: "bounce not fixed"): the r93 bonus was 5dp over the last 28% - invisible; the r102 hump was ADDED to a translation that was still closing, so the bubble only crossed its seat by a few dp for a couple of frames. r103 makes the bounce REAL: the flight lands at 75% of the progress (approach clamps to 1) and the whole last quarter IS the bounce - a true 18dp pass over the seat and back, subtracted for the sent direction, added for the received one. One shared hump before the direction branch so both flights bounce identically',
    flight4.includes("val approach = (v0 / 0.75f).coerceAtMost(1f)") &&
      flight4.includes("sin((v0 - 0.75f) / 0.25f * PI.toFloat()) * 18f * density") &&
      (flight4.match(/val bounce =/g) || []).length === 1 &&
      flight4.includes("translationX = x0 * inv - bounce") &&
      flight4.includes("translationX = x0 * inv + bounce") &&
      !flight4.includes("* 5f * density"),
  );

  check(
    'r93-5 (owner r93 #5: "in app er system sounds volume kom hobe massage send sound sent sound call end sound"): the send tone drops to 0.30x trim and the sent tone to 0.35x trim (in-app / receive keep the r68 levels), and the call-end MediaPlayer plays at 0.3 volume instead of full',
    feel4.includes("val v = 0.3f * MSG_VOLUME_TRIM") &&
      feel4.includes("val v = 0.35f * MSG_VOLUME_TRIM") &&
      calln4.includes("player.setVolume(0.3f, 0.3f)"),
  );

  check(
    'r93-6 (owner r93 #6: "voice button a tap korle ta sounds hoi voice tap hold ar lock eksathe but just tap korle just voice lock sound ta hobe"): the record-start tone no longer fires on the PRESS - it waits out the 250 ms tap window and only plays for a genuine hold (still recording, not locked, same session). A quick tap locks the take and plays ONLY the lock tone; a slip-cancel stays silent',
    chat4.includes("delay(250L)") &&
      chat4.includes("if (recording && !voiceLocked && session == voiceSession) {") &&
      !chat4.includes("instant now, it is the press's own confirmation."),
  );

  check(
    'r94-4 (owner r94 #4: "right theke asche ok but ektu nicher thekeo asbe ekdom corner theke right side er nicher theke"): the sent bubble\'s take-off sits well BELOW its seat - it flies in from the true bottom-right corner, not merely from the right edge',
    flight4.includes("val y0 = 110f * density"),
  );

  check(
    'r94-7 (owner r94 #7: "jemon swipe up korle attach panel ta Fullscreen hoi temoni ami chai attach panel ta jokhon half thakbe swipe down korle attach panel ta close hoye habe (media select thakle kintu ager motoi deselect korte bole)"): the symmetric gesture - a swipe DOWN at the half panel (the grid at its top, or the drag handle) CLOSES it, routed through the exit gate so a panel with ticked media ASKS to deselect first (the old confirm sheet) and an empty one just closes',
    attach4.includes("onSwipeDismiss: () -> Unit = {},") &&
      attach4.includes("gridPreHalfTotal") &&
      attach4.includes("if (fullscreen) setFullscreen(false) else onSwipeDismiss()") &&
      chat4.includes("onSwipeDismiss = {") &&
      chat4.includes("requestAttachExit"),
  );

  check(
    'r94-8 (owner r94 #8: "chat history ekbare shob load thakbe na beshi kichu chat thakbe load user scroll kore history dekhte gele tokhon loading Hobe chat top a load hoye server theke history dekhte parbe"): an OPEN paints only the newest 60 rows (the store may hold the whole thread), a list that SETTLES at the top also loads (the fling often ends right at index 0), and a small loader pill pins to the list top while an older page is in flight',
    chat4.includes("next.takeLast(60)") &&
      chat4.includes("if ((idx <= 2 && scrolling) || idx == 0) loadOlder()") &&
      chat4.includes("var olderLoading by remember") &&
      chat4.includes('Text("Loading…", fontSize = 12.5.sp, color = Muted)'),
  );

  check(
    'r94-9 (owner r94 #9: "contacts er number a Kuchupuchu account na theke invite ekhon phone sms a jai but ota Whatsapp a kore daw"): Invite opens WHATSAPP first - a wa.me link with the number and the invite text preloaded (digits only, URL-encoded), SMS and the share sheet stay as fallbacks',
    contacts4.includes('"https://wa.me/$digits?text="') &&
      contacts4.includes('.setPackage("com.whatsapp")') &&
      contacts4.includes("java.net.URLEncoder.encode(INVITE_TEXT"),
  );

  check(
    'r94-10 (owner r94 #10: "massage bar a ekhono images paste hoi na"): the composer PASTE understands a clipboard IMAGE - the system paste menu is kept, only the Paste action is intercepted (a custom TextToolbar): an image clip opens the media editor exactly like the attach panel single-photo pick, a text clip pastes as text. r95-10 added the always-visible clipboard chip (the system menu never offers Paste for an image clip on most ROMs)',
    chat4.includes("onPasteImage: () -> Boolean = { false },") &&
      chat4.includes("fun composerPasteImage(): Boolean {") &&
      chat4.includes("onPasteRequested?.let { op -> { if (!onPasteImage()) op() } }") &&
      chat4.includes("LocalTextToolbar provides inputPasteToolbar") &&
      chat4.includes("pastePreview?.let { (pMime, pUri, pKey) ->") &&
      chat4.includes("openPastePreview(pMime, pUri, pKey)"),
  );

  check(
    'r95-5 (owner r95 #5: "handle i dhore swipe down korle close hocche but emni normally swipe down free swipe down a close hoi na"): the FREE swipe closes the half panel now - the panel ROOT carries its own vertical drag detector (the grid nested-scroll only ever reported drags that started ON the grid, so the action rows / chips never closed anything; deeper nodes keep their own handlers so nothing double-fires), and the grid top-path close gained the r45-style onPostScroll backup some ROMs need',
    attach4.includes("rootDragTotal") &&
      attach4.includes("if (rootDragTotal > 70f) onSwipeDismiss()") &&
      (attach4.match(/gridPreHalfTotal > 60f/g) || []).length === 2,
  );

  check(
    'r96-2 (owner r96 #2: "loading text er background border thakbe na remove koro"; r95 #6 made it blue): the chat-top history loader is BARE - spinner (ActionBlueDeep, never Gold) + text, no pill background at all',
    (() => {
      const i = chat4.indexOf("Loading\u2026");
      const slice = chat4.slice(Math.max(0, i - 600), i);
      return (
        slice.includes("color = ActionBlueDeep") &&
        !slice.includes("color = Gold") &&
        !slice.includes(".background(Card)")
      );
    })(),
  );

  check(
    'r96-4 (owner r96 #4: "chat a history ba notun kore chat a gele ager chat a thaka emojis 1 second er jonno niche ar right side a kata pore jacche abar thik o hoye jacche"): a message that predates its first composition can never fly - fxBorn gains a bornHere floor (createdAt > composedAt - 2s of clock-skew slack), so a re-entered chat never re-runs the corner flight on rows that were live seconds ago, and an off-screen arrival scrolled to later is covered by the same floor',
    chat4.includes("val bornHere =") && chat4.includes("!bornHere -> false"),
  );

  check(
    'r97-4 (owner r96 #4 "not fixed": the re-entered chat STILL flew its old emojis from the corner for ~1 s): the r96 bornHere floor was the right idea at the WRONG LAYER - fxFlyIn also picks up flights PASSIVELY. A row composed with active=false still read FlightAnims.of(key), and any registry entry that had been birthed but never ARMED (its owning row left composition inside the 600 ms viewport gate, or a send that never acked) made the row render pinned at the bottom-right corner (v=0) while the effect SELF-ARMED it - a fresh corner flight on a re-entered chat, every gate bypassed. A passive pick-up may now only ADOPT an already-armed flight (goAt >= 0, the pending->server swap handoff); unarmed entries are ignored and the row renders settled',
    flight4.includes("FlightAnims.of(key)?.takeIf { it.goAt >= 0L }") &&
      flight4.includes("if (f.goAt < 0L) f.goAt = android.os.SystemClock.uptimeMillis()"),
  );

  check(
    'r97-3 (owner r96 #3 "not fixed": neither the chip nor the auto-open ever appeared on the device): the clip description timestamp is now only trusted as epoch MILLIS inside a sane window (some ROMs stamp the clip in seconds or boot-relative garbage, and the 10-minute freshness test then rejected EVERY clip), the uri can hide in the item INTENT data or a plain file-path text, and a provider that reports no MIME at all gets its magic bytes sniffed (sniffClipMime) with the file extension as the last resort. An unreadable stream toasts "Copied image could not be read" instead of vanishing silently',
    chat4.includes("1_500_000_000_000L") &&
      chat4.includes("item.intent?.data") &&
      chat4.includes("sniffClipMime(ctx.contentResolver, uri)") &&
      chat4.includes("private fun sniffClipMime(") &&
      chat4.includes("Copied image could not be read") &&
      chat4.includes("fun maybeAutoPaste()") &&
      chat4.includes("contentResolver.getType(uri)"),
  );

  check(
    "chat entry uses a shorter NavHost-managed fade/quarter-width slide instead of a whole-screen graphics-layer animation; unrelated flight diagnostics stay unchanged",
    kpapp4.includes('"chat/{id}"') &&
      kpapp4.includes("fadeIn(tween(200, easing = FastOutSlowInEasing))") &&
      kpapp4.includes("slideInHorizontally(tween(220, easing = FastOutSlowInEasing)) { it / 4 }") &&
      !kpapp4.includes("ChatRouteEntryMotion(") &&
      kpapp4.includes(
        "popEnterTransition = { fadeIn(tween(240, easing = FastOutSlowInEasing)) }",
      ) &&
      chat4.includes('android.util.Log.d("kpfx", "born key=$fxKey') &&
      flight4.includes('android.util.Log.d("kpfx", "flight key=$key'),
  );

  check(
    'r99-3 (owner r98 #2 "not fixed - ekhono dekhai current application does not supporting image pasting" - the tester judges by the ROM paste menu, which the ROM itself blocks for image clips into a text field before the app ever sees the tap; the only path the app owns is chip/auto-open, and the missing datapoint is what the app REALLY sees on the clipboard): the null/empty-clipboard state now LOGS (kpclip - a privacy ROM returning a null primaryClip was previously indistinguishable from no clipboard work at all), the uri net gains the Intent EXTRA_STREAM shape, and the mystery toast fires only for a NON-TEXT clip with no readable picture (a text clipboard stays quiet - no nag on every chat open)',
    chat4.includes("primaryClip null or empty (blocked or cleared)") &&
      chat4.includes("Intent.EXTRA_STREAM") &&
      chat4.includes(
        'val textOnly = (0 until desc.mimeTypeCount).all { desc.getMimeType(it).startsWith("text/") }',
      ) &&
      chat4.includes('android.util.Log.d("kpclip", "image detected:'),
  );

  check(
    'r100-3 (owner: "je app gula images pasting support kore oi app open korle massage type korte gelei Gboard agei keyboard a screenshot paste option dei ... amar app a pasting option e nai" - the ROOT CAUSE at last, verified against the compose-foundation 1.7.4 sources): the legacy BasicTextField(value, onValueChange) never advertised contentMimeTypes - its RecordingInputConnection.commitContent literally returns false - so every IME (Gboard included) saw a text-only field and hid the image paste chip. The composer field is migrated to the state-based BasicTextField + Modifier.contentReceiver: with a receiver attached the field advertises contentMimeTypes ["*/*","image/*","video/*"] to the IME (Gboard shows the screenshot chip, WhatsApp-parity), and a committed image (chip tap, GIF, sticker, system paste) arrives in the listener with a read-granted uri -> onReceiveImage -> keyboardImagePasted -> the SAME openPastePreview flow. Text clips fall through untouched; the r94-10 toolbar interception and the r95-10 chip stay as the other doors',
    chat4.includes("onReceiveImage: (android.net.Uri) -> Unit = {},") &&
      chat4.includes("val inputState = rememberTextFieldState(input)") &&
      chat4.includes(".contentReceiver(imageReceiver)") &&
      chat4.includes("tc.hasMediaType(MediaType.Image)") &&
      chat4.includes(
        "lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 4),",
      ) &&
      chat4.includes("fun keyboardImagePasted(uri: android.net.Uri)") &&
      chat4.includes('openPastePreview(mime, uri, "kbd|$uri")') &&
      !chat4.includes("onValueChange = onInput"),
  );

  check(
    'r103-2 (owner: "same account theke por por massage ashle alada notification hisabe count hobe na ba new notification asbe ba oi ager notification i add hoye jabe new notification content ta"): consecutive messages from the same account now stack into the conversation is ONE card - each new message UPDATES it (MessagingStyle renders the thread, capped at 6 entries) under a STABLE conversation id (NotifyIds.conversationCard, used by both the poster and the action receiver), instead of a fresh card per message. A lone message keeps the exact old look (big text / big picture); the reminder path (blank convoId) and login alerts keep per-message cards; cancelConversation / reply / like / mark-read reset the thread history',
    nids4.includes("fun conversationCard(convId: String): Int = convId.hashCode()") &&
      notify4.includes("NotificationCompat.MessagingStyle(") &&
      notify4.includes("private val convMsgs = mutableMapOf<String, MutableList<StkMsg>>()") &&
      notify4.includes("while (thread.size > 6) thread.removeAt(0)") &&
      notify4.includes("while (convMsgs.size > 32) convMsgs.remove(convMsgs.keys.first())") &&
      notify4.includes("if (stackable) NotifyIds.conversationCard(convoId)") &&
      notify4.includes("fun resetConv(convoId: String)") &&
      notify4.includes("fun cancelAllCards()") &&
      notify4.includes("convMsgs.remove(convoId)"),
  );

  check(
    "r103-3: only the newest visible message keeps its timestamp and ticks by default; older rows retain kpHideStamp on a copy",
    chat4.includes("val isLatestVisibleMessage =") &&
      chat4.includes("val rowM =") &&
      chat4.includes("val echoM =") &&
      chat4.includes("itemsIndexed(") &&
      chat4.includes("kpHideStamp") &&
      chat4.includes(
        'if (!m.optBoolean("kpHideStamp")) BubbleStamp(m, mine, pendingEcho, otherReadAt, if (kind == "STICKER") 1 else emojiOnly, stampInk)',
      ),
  );

  check(
    'r103-4 (owner: "massage tap hold korle je sheet ta ashe okahne arekta options add Hobe Info - eita click korle massage sent Time delivered time seen time read status oi massage er info dekha jabe"): the long-press sheet gains an Info row (after Copy) opening a message-info sheet: Sent (and Received for their rows) with the full date+time, Delivered and Seen for own rows (deliveredAt / otherReadAt vs createdAt), "Not yet" when pending',
    chat4.includes('KpSheetRow(Icons.Filled.Info, "Info")') &&
      chat4.includes("var infoFor by remember { mutableStateOf<JSONObject?>(null) }") &&
      chat4.includes("private fun infoStamp(iso: String): String {") &&
      chat4.includes('MessageInfoRow("Sent", infoStamp(m.optString("createdAt")))') &&
      chat4.includes(
        'MessageInfoRow("Delivered", m.optIso("deliveredAt")?.let { infoStamp(it) } ?: "Not yet")',
      ),
  );

  check(
    'r103-5 (owner: "jekono chat item a tap hold korlei select Hobe na ekhon hocche user jodi select a click kore tobei click Hobe"): a chat-list long-press no longer enters select mode or ticks the row - it only opens the sheet; selection happens exclusively via the sheet is Select action (which already ticks the row)',
    list4.includes("ListSelect.sheetFor = conv") &&
      !list4.includes("if (id !in ListSelect.ids) ListSelect.ids.add(id)"),
  );

  check(
    'r98-3 (owner r97 #3 "not fixed" - the chip NEVER appeared, screenshot-toolbar Copy): with r97 detection the only remaining code path that shows nothing at all is the permanent-consume bug - a ROM whose clip stamp is unusable builds the key "0|<uri>", and if that ROM also serves a stable uri the very first test consumed it forever. Un-stamped clips are now tracked per uri (fresh 10 minutes from first sight, re-shown per chat entry inside the window, quiet once consumed or dismissed via ScreenStore.pasteDismissed). Diagnostics: a clip on the board that does not read as a picture now toasts what the ROM put there (kpclip log + one toast per chat entry)',
    chat4.includes("val seen = ScreenStore.lastNoStampPaste") &&
      chat4.includes("uriStr !in ScreenStore.pasteDismissed") &&
      chat4.includes("ScreenStore.pasteDismissed.add(it)") &&
      store4.includes("var lastNoStampPaste: Pair<String, Long>? = null") &&
      store4.includes(
        "val pasteDismissed = java.util.Collections.synchronizedSet(HashSet<String>())",
      ) &&
      chat4.includes("Clipboard: ${clip.itemCount} item(s)") &&
      chat4.includes('android.util.Log.d("kpclip", "clip present:'),
  );

  check(
    "r90-1 (owner r90 #1: \"emojis double animate hoi sending a abar chat er emojis a tap korle double animate hoi\"): the tap double was the room echo - the tapper's own /fx frame came back and the phone mirrored its own tap as a SECOND pass. The frame now carries senderId and the handler skips its own; the send double is the same family - the row's dance key is FROZEN at first composition (remember), so a pending->server swap can never mint a second EmojiDance clock and a birth pass never restarts from zero. The r88-1 single driver itself is untouched",
    worker4.includes("senderId: uid,") &&
      chat4.includes('ev.optString("senderId") != Store.myId()') &&
      chat4.includes(
        'val fxKey = remember { m.optString("clientId").ifBlank { m.optString("id") } }',
      ) &&
      anim4.includes("EmojiDance.begin(liveDanceKey)"),
  );

  check(
    'r95-10 (supersedes r91-5; owner r95 #8: "paste korle bole current application not supporting image paste"): the system paste menu CANNOT paste an image into a text field - the ROM literally says so. The app-root auto-open watcher is GONE; the chat screen now runs the detection itself (clip listener + ON_RESUME + chat open) and shows a WhatsApp-style CLIPBOARD CHIP above the message bar while a fresh, unconsumed image clip is on the board: tap = the editor with the picture, X = dismiss. Consumed once per clip (lastPasteClipKey), fresh within 10 minutes',
    !kpapp4.includes("consumeClipboardImage") &&
      !kpapp4.includes("OnPrimaryClipChangedListener") &&
      chat4.includes("fun refreshPastePreview()") &&
      chat4.includes("fun consumePastePreview(key: String) {") &&
      chat4.includes("OnPrimaryClipChangedListener") &&
      chat4.includes("Lifecycle.Event.ON_RESUME") &&
      // r96-3 (owner r96 #3: "not fixed"): the paste now goes STRAIGHT to
      // the editor when the chat is free (maybeAutoPaste), and detection is
      // widened - every clip item is scanned and the MIME is re-resolved
      // from the uri when the clip description carries no image type (some
      // ROMs label a copied picture "*/*").
      chat4.includes("fun maybeAutoPaste()") &&
      chat4.includes("contentResolver.getType(uri)") &&
      store4.includes("var lastPasteClipKey: String? = null") &&
      store4.includes("var lastChatConvId: String? = null") &&
      chat4.includes("ScreenStore.lastChatConvId = convId"),
  );

  check(
    "r92-2 (owner r92 #2: \"ekhono closing position thik nai ektu niche hoye jacche ar agei doublicate thakche\"): the seat rects are SCREEN pixels but the hero's translations were computed in the dialog's local space - any window offset (an OEM dialog placement, an inset) landed the hero a bit low, and the handoff frame (tile shown + hero still up) flashed that offset as a duplicate. The flight now aims at the layer's OWN screen-space centre (heroLayerOrigin / vidLayerOrigin captured at layout), and the handoff never shows two copies: the hero goes invisible the same committed frame the tile returns (landed / vidLanded), the window detaching a frame later. The tile stays flat-hidden for the whole trip (r91-2) and the video close still lands on the live seat",
    media4.includes("val cx = heroLayerOrigin.x + sw / 2f") &&
      media4.includes("val cx = vidLayerOrigin.x + size.width / 2f") &&
      media4.includes("alpha = if (landed) 0f else 1f") &&
      media4.includes(
        "alpha = if (vidLanded) 0f else if (vidHeroSeat != null && !vidHeroLaidOut) 0f else 1f",
      ) &&
      media4
        .slice(media4.indexOf("fun tileAlphaFor"), media4.indexOf("fun tileAlphaFor") + 900)
        .includes("return 0f") &&
      media4.includes("val h = PhotoHero.seatOf(vidHeroId) ?: vidHeroSeat"),
  );

  check(
    'r83-2 (owner r83 #2: back from the video player STILL lands at the very bottom instantly): the r58 tail-follow had no position guard - a viewer return refills the page, the tail id goes "" -> last in one frame, and the follow yanked the freshly-restored spot (r82-2 runs earlier by declaration order) to the newest message; that is also what defeated the LazyListState saver all along. The no-yank rule (r24/r47/r53) now applies: follow only when the reader is actually at the tail (a send / live arrival finds the layout still parked at the old bottom), and an empty layout means unknown - no scroll. The chatmedia gallery exits record the spot too now',
    chat4.includes(
      "LaunchedEffect(currentTailId) {\n        if (currentTailId.isNotBlank() && didInitialScroll) {",
    ) &&
      chat4.includes(
        "val nearBottom = info.visibleItemsInfo.lastOrNull()?.index?.let { it >= total - 2 } ?: false",
      ) &&
      chat4.includes("if (total > 0 && nearBottom) {") &&
      (chat4.match(/markViewerReturn\(\)/g) || []).length >= 6,
  );

  check(
    "r83-3 (owner r83 #3: chat-list unread count \"border er middle a nai\"): Text's default includeFontPadding reserves blank space above the digits, so the count hung below the pill's middle; font padding off + a tight line box centers it (row badge and nav-tab badge both)",
    (list4.match(/PlatformTextStyle\(includeFontPadding = false\)/g) || []).length >= 2 &&
      list4.includes("lineHeight = 11.sp * sizeScale,"),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r70-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
