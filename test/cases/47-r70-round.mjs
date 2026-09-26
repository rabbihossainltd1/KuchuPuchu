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
    (attach.match(/Color\(0x66000000\)/g) || []).length === 1 &&
      attach.includes(".background(Color(0x66000000), RoundedCornerShape(barH / 2 + 8.dp))") &&
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
      chat.includes(
        'if (m.optString("id").startsWith("c_") || m.optString("id").isBlank()) return',
      ) &&
      chat.includes('applyReaction(m, "❤️")') &&
      // exactly one heart call into applyReaction beyond the sheet's own
      (chat.match(/applyReaction\(m, "❤️"\)/g) || []).length === 1 &&
      (chat.match(/applyReaction\(it, e\)/g) || []).length === 1,
  );
  check(
    "r71-21: EVERY bubble kind hearts on a double tap — the text/emoji bubble, the image, video, album, view-once, once-text (r71-20) and call/status rows all carry `onDoubleClick`, and MessageRow hands them the callback",
    // r71-20 added the once-text bubble to the family — six rows now.
    (chat.match(/onDoubleClick = \{ if \(!pendingEcho\) onDoubleTapHeart\(m\) \}/g) || [])
      .length === 6 &&
      chat.includes("onDoubleTapHeart: (JSONObject) -> Unit = {},") &&
      // five tiles + the r71-20 once-text bubble
      (chat.match(/onDoubleTapHeart: \(JSONObject\) -> Unit = \{\},/g) || []).length === 6 &&
      (chat.match(/onDoubleTapHeart = ::heartReact,/g) || []).length === 3,
  );
  check(
    "r71-21: an emoji-only bubble keeps its INSTANT tap (the r67-4 replay is never delayed) and still hearts on the second tap — its own 320 ms counter, no combinedClickable deferral",
    emo.includes("internal const val DOUBLE_TAP_HEART_MS = 320L") &&
      emo.includes("val lastTapAt = remember { longArrayOf(0L) }") &&
      emo.includes(
        "if (onDoubleTap != null && now - lastTapAt[0] in 1..DOUBLE_TAP_HEART_MS) onDoubleTap.invoke()",
      ) &&
      emo.includes("onDoubleTap: (() -> Unit)? = null,") &&
      (chat.match(/onDoubleTap = \{ if \(!pendingEcho\) onDoubleTapHeart\(m\) \}\)/g) || [])
        .length === 3,
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
        "CenteredOnceIcon(40.dp, tint = if (voiceOnce) accent else Color.White, fillBounds = true)",
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
      chat.includes("FlightAnchors.micBounds"),
  );
  check(
    "r76-1: the recorder wears the APP'S palette on the preview's geometry — accent circles, DarkCard bar/panel/column, 8% white once circle + Pause pill, Red bin; the old DoubleArrow chevron send is gone with the rebuild (import included)",
    comp.includes(".background(accent)") &&
      comp.includes("Icons.AutoMirrored.Filled.Send,") &&
      (comp.match(/\.background\(DarkCard\)/g) || []).length === 3 &&
      (comp.match(/Color\.White\.copy\(alpha = 0\.08f\)/g) || []).length === 2 &&
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
    ui.includes("const val KP_DOUBLE_TAP_MS = 450L") &&
      ui.includes("object : ViewConfiguration by base {") &&
      ui.includes("override val doubleTapTimeoutMillis: Long get() = ms") &&
      ui.includes("fun KpDoubleTapSeat(content: @Composable () -> Unit)") &&
      chat.includes("KpDoubleTapSeat {") &&
      (chat.match(/KpDoubleTapSeat \{/g) || []).length === 2,
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
    "r71-19b: a view-once VOICE renders as its own card — ViewOnceRow takes the voice player, routes a voice row to VoiceOnceTile instead of the blurred photo tile, and sizes it wide and short",
    chat.includes("player: VoicePlayer,") &&
      chat.includes("val voice = !sentAsDocument(m) && fileLooksVoice(m)") &&
      chat.includes(
        'VoiceOnceTile(m = m, mine = mine, pendingEcho = pendingEcho, player = player, playing = player.playingId == m.optString("id"), onSpent = { if (!mine) ViewOnce.spend(m.optString("id")) })',
      ) &&
      chat.includes(".widthIn(max = if (voice) 196.dp else 138.dp)") &&
      chat.includes("Modifier.height(74.dp)") &&
      chat.includes(
        "ViewOnceRow(m, mine, pendingEcho, otherReadAt, player, selectedIds, onToggleSelect, onOpenImage, onOpenVideo, onReply, onLongPress, theme, onDoubleTapHeart)",
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
  check(
    "r71-20: text typed + a second tap on Send = the message goes out view-once — the seat's double tap branches on what is being sent, and `sendText` takes the flag through the meta, the payload and the optimistic echo",
    chat.includes("onSendTextOnce: () -> Unit = {},") &&
      /onDoubleClick =\n\s+when \{[\s\S]{0,220}?input\.isNotBlank\(\) -> onSendTextOnce[\s\S]{0,80}?else -> null/.test(
        chat,
      ) &&
      chat.includes("onSendTextOnce = { requestAttachExit {") &&
      chat.includes("sendText(input, once = true)") &&
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
      chat.includes(
        "OnceTextRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onReply, onLongPress, theme, onDoubleTapHeart)",
      ) &&
      chat.includes(
        "@Composable\n@OptIn(ExperimentalFoundationApi::class)\nprivate fun OnceTextRow(",
      ) &&
      chat.includes("detectHorizontalDragGestures(") &&
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
      chat.includes("!mine && !revealed -> {") &&
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
      // and the bubble + its stamp share one column, so the stamp sits below it
      chat.includes("Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {"),
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
      seal.includes("return Plan(sealed, env ?: bodyEnv, isOnceLabel(body))") &&
      seal.includes("if (!plan.sealed || plan.once) return null") &&
      seal.includes('if (plan.once || isOnceLabel(raw)) return raw.ifBlank { "New message" }') &&
      push.includes('PushSeal.cardText(plan, opened, data["body"])') &&
      push.includes('PushSeal.plan(data["kp_e2ee"], data["kp_env"], data["body"])'),
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
      chat.includes('label = "Media Save permission"') &&
      chat.includes("Alert me when they screenshot this chat") &&
      chat.includes("Alert me when they record this chat") &&
      chat.includes("They may save the media I send here") &&
      chat.includes("They cannot save the media I send here") &&
      // r72-18: the screenshot row is no longer "Android 14 or newer" — the
      // 12/13 folder watch covers the versions below it, so the row is live
      // everywhere; the screen-recording row keeps its honest floor.
      chat.includes('else "Android 15 or newer"') &&
      chat.includes("folderWatch = KpCapture.folderPermission() != null,") &&
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
      cap.includes("watermark = newest.first") &&
      cap.includes("val age = System.currentTimeMillis() / 1000 - addedSec") &&
      cap.includes('if (age in 0..120) report("shot")') &&
      cap.includes("registerContentObserver(") &&
      cap.includes("h.postDelayed(this, 5_000)") &&
      cap.includes("stopFolder()") &&
      // armed only where the callback is missing, and only with the permission
      cap.includes(
        "if (folderPermission() != null && folderGranted(activity)) startFolder(activity)",
      ) &&
      // the switch asks for it (owner Q&A: on the switch, not at launch)
      chat.includes("act.ensurePermissions(listOf(perm)) { capturePermNonce++ }") &&
      chat.includes("DisposableEffect(convId, capturePermNonce) {") &&
      chat.includes("var capturePermNonce by remember { mutableStateOf(0) }") &&
      chat.includes("Alert me when they screenshot this chat (via your Screenshots folder)") &&
      chat.includes("Allow Photos so screenshots can be spotted"),
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
      cap.includes("watermark = newest.first") &&
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
      chat.includes("color = Red.copy(alpha = 0.9f),") &&
      chat.includes("textAlign = TextAlign.Center,"),
  );
  check(
    "r71-18: the switches are the server's (read from the conversation, written back one at a time) and a capture alert lands as a red chip with one buzz",
    chat.includes('c?.optJSONObject("privacy")') &&
      chat.includes(
        "fun setChatPrivacy(shot: Boolean? = null, rec: Boolean? = null, save: Boolean? = null)",
      ) &&
      chat.includes('"/api/conversations/$convId/privacy"') &&
      chat.includes("internal fun captureAlertOf(m: JSONObject): String?") &&
      chat.includes('b.endsWith("took a screenshot of this chat") -> "shot"') &&
      chat.includes('b.endsWith("started a screen recording of this chat") -> "rec"') &&
      // r73-18c: the alert is a single small line of red text on the wallpaper.
      !chat.includes("Icons.Filled.Videocam else Icons.Filled.VisibilityOff") &&
      chat.includes("if (fresh) h.reject()"),
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
      worker.includes(
        "UPDATE members SET priv_shot = ?, priv_rec = ?, priv_save = ? WHERE conv_id = ? AND user_id = ?",
      ) &&
      worker.includes("privacy: { shot: meShot, rec: meRec, save: meSave },") &&
      worker.includes("peerSave: solo ? (otherSave ?? true) : true,"),
  );
  check(
    "r71-18: worker — the capture route alerts only the members whose OWN switch is on, folds a burst into one row per 20 s, writes a real SYSTEM chip and pushes it message-shaped (so a closed app still hears)",
    worker.includes("path.match(/^\\/api\\/conversations\\/([^/]+)\\/capture$/)") &&
      worker.includes(
        'kind === "rec" ? Number(m.priv_rec ?? 0) === 1 : Number(m.priv_shot ?? 0) === 1',
      ) &&
      worker.includes("Date.now() - Date.parse(last.created_at) < 20_000") &&
      // the two phrases, separately: prettier may re-wrap the ternary line.
      worker.includes('"started a screen recording of this chat"') &&
      worker.includes('"took a screenshot of this chat"') &&
      worker.includes('kind === "rec" ? "Screen recording alert" : "Screenshot alert"') &&
      worker.includes('channel: "kp_messages_v2",'),
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

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r70-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
