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

/* ---------- 16 (r72): the removal stays, a NEW adaptive lift goes in ---------- */
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
  // r71-16's own order stands (owner, r72: "thik ache"): no screen carries its
  // own inline `.shadow(...)` step or the `draw.shadow` import any more.
  const withShadow = srcs.filter((f) => readFileSync(app + f, "utf8").includes(".shadow("));
  check(
    "r71-16 (kept by r72-16): the rejected inline shadow type stays gone from every screen — every lift now routes through one centralised helper",
    withShadow.length === 0 &&
      srcs.every(
        (f) => !readFileSync(app + f, "utf8").includes("import androidx.compose.ui.draw.shadow"),
      ),
    withShadow.join(", "),
  );
  // r72-16 (owner: "shadow o add koro black hole white show white hole black
  // shadow"): the lift is back, and its COLOUR reads the theme it falls on.
  const ui = readFileSync(app + "Ui.kt", "utf8");
  check(
    "r72-16: Modifier.kpLift is the only lift and it is theme-adaptive — a WHITE halo on the dark-blue theme, a BLACK one on the light theme (rim softer than the spot), so the shadow never drowns in the surface behind it",
    ui.includes("fun Modifier.kpLift(elevation: Dp, shape: Shape): Modifier =") &&
      ui.includes(
        "ambientColor = if (KpThemeMode.darkBlue) Color(0x38FFFFFF) else Color(0x38000000)",
      ) &&
      ui.includes(
        "spotColor = if (KpThemeMode.darkBlue) Color(0x70FFFFFF) else Color(0x70000000)",
      ) &&
      ui.includes("import androidx.compose.ui.draw.shadow"),
  );
  check(
    'r72-16: applied app-wide (owner scope: "পুরো app জুড়ে") — every surface r71-16 stripped wears it again: 9 in the chat (bubble / photo / video / view-once / album / owner card / send circle / mic, plus r72-20\'s once-view text bubble), 4 in the editor (rail seat + ✕ / undo / redo), 4 in the call screens, 3 in the chat list, 1 in the calls tab, 1 on the profile — while an emoji-only bubble stays bare',
    [
      ["ChatScreen.kt", 9],
      ["MediaEditScreen.kt", 4],
      ["CallScreens.kt", 4],
      ["ChatListScreen.kt", 3],
      ["CallsTabScreen.kt", 1],
      ["ProfileScreen.kt", 1],
    ].every(([f, n]) => (readFileSync(app + f, "utf8").match(/\.kpLift\(/g) || []).length === n) &&
      readFileSync(app + "ChatScreen.kt", "utf8").includes(
        ".then(if (noBubble) Modifier else Modifier.kpLift(2.dp, bubbleShape))",
      ),
  );
  const edit = main("MediaEditScreen.kt");
  check(
    "r71-16 + r72-16: the editor still reads the MEDIA instead of trusting the shadow — the rail samples its own column and flips the glyphs between white and near-black over bright media",
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
    "r71-16 + r72-16: the top bar keeps white ink on purpose (it sits on the dark top scrim, so it needs no halo) — the ✕ / undo / redo stay white and only take the shared lift",
    edit.includes(
      'Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp))',
    ) &&
      (edit.match(/tint = Color\.White\.copy\(alpha = if \(can(Undo|Redo)\)/g) || []).length ===
        2 &&
      edit.includes("modifier = Modifier.size(36.dp).kpLift(6.dp, CircleShape))") &&
      (edit.match(/modifier = Modifier\.size\(32\.dp\)\.kpLift\(6\.dp, CircleShape\)\)/g) || [])
        .length === 2,
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
  check(
    "r71-19: the mic gesture grows a vertical axis — slide UP past 58 dp arms the lock (badge hollow on the way up, filled on arm) and releasing there LOCKS the recording; a plain tap (< 300 ms, no slide) locks too; slide-left still cancels; any other release sends",
    mic.includes("val lockDist = with(density) { 58.dp.toPx() }") &&
      mic.includes("val tapSlop = with(density) { 12.dp.toPx() }") &&
      mic.includes("var dragY by remember { mutableStateOf(0f) }") &&
      mic.includes("if (dy != 0f) dragY = (dragY + dy).coerceIn(-lockDist * 1.6f, 0f)") &&
      mic.includes("val lockArmed = dragY <= -lockDist") &&
      mic.includes("val tapped =") &&
      mic.includes("android.os.SystemClock.uptimeMillis() - downAt < 300 &&") &&
      /when \{[\s\S]{0,200}?cancelled -> onFinishRecord\(true\)[\s\S]{0,80}?lock \|\| tapped -> onLockRecord\(\)[\s\S]{0,60}?else -> onFinishRecord\(false\)/.test(
        mic,
      ) &&
      // the badge is a SIBLING of the mic (the mic circle clips its children)
      mic.includes("if (lockAlpha > 0.01f) {") &&
      mic.includes('if (lockArmed) "Release to lock" else "Slide up to lock"') &&
      // the import is at the top of the FILE, not inside the slice
      chat.includes("import androidx.compose.material.icons.filled.Lock"),
  );
  check(
    "r71-19: the locked strip is a different animal — the mic seat becomes Send (a locked recording has no finger on the mic), ✕ drops the note, the lock glyph says why the strip is up, and the unlocked strip keeps its slide-to-cancel hint",
    comp.includes("if (!input.isBlank() || selectCount > 0 || locked) {") &&
      comp.includes("locked -> onSendVoice()") &&
      comp.includes("if (locked) {") &&
      // r73-19: the ✕ + "Locked" label became Telegram's transport — a bin on
      // the left and a Pause / Resume pill beside the Send circle.
      comp.includes('"Delete recording",') &&
      comp.includes("if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause,") &&
      comp.includes('if (paused) "Resume" else "Pause",') &&
      comp.includes('Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)') &&
      comp.includes("locked: Boolean = false,") &&
      comp.includes("onLockRecord: () -> Unit = {},"),
  );
  check(
    "r71-19: the chat owns the locked state — set by lockRecording (with its confirm buzz), cleared the moment the take starts and the moment it ends, and a locked note that the user then SENDS is never swallowed by the sub-second slip rule in silence",
    chat.includes("var voiceLocked by remember { mutableStateOf(false) }") &&
      chat.includes("fun lockRecording() {") &&
      // r72-19: the early return became a QUEUE (the tap can land before the
      // take exists — the permission sheet on first use).
      chat.includes("if (recStarting) lockPending = true") &&
      chat.includes("voiceLocked = true") &&
      (chat.match(/voiceLocked = false/g) || []).length === 1 &&
      chat.includes("voiceLocked = lockPending") &&
      chat.includes("val wasLocked = voiceLocked") &&
      chat.includes('if (wasLocked) error = "That voice note is too short."') &&
      chat.includes("locked = voiceLocked,") &&
      chat.includes("onLockRecord = { lockRecording() },") &&
      chat.includes("onSendVoice = { finishRecording(cancelled = false) },") &&
      chat.includes("onCancelVoice = { finishRecording(cancelled = true) },"),
  );
  /* ---- the r72 redo of 19 (owner: the lock "thik moto implement hoini") ---- */
  const app = "native-android/app/src/main/java/app/kuchupuchu/android/";
  const ui = readFileSync(app + "Ui.kt", "utf8");
  check(
    'r72-19 + r73-19: the lock goal sits ABOVE the mic (owner: "lock icon ta upore thakbe side a na") as the dark pill of his screenshots — lock over an up-arrow — a SIBLING of the mic circle (that circle clips its children), up from the moment the recording starts',
    mic.includes(".offset { IntOffset(0, -(58.dp.toPx()).roundToInt()) }") &&
      mic.includes(".size(width = 30.dp, height = 54.dp)") &&
      mic.includes("Icons.Filled.KeyboardArrowUp,") &&
      mic.includes("val lockShowing = recording || dragY <= -12f") &&
      mic.includes("if (lockAlpha > 0.01f) {") &&
      mic.includes('if (lockArmed) "Release to lock" else "Slide up to lock"'),
  );
  check(
    'r72-19: a tap that lands before the recorder exists is not lost — while the start is in flight the lock is QUEUED and the take comes up LOCKED, so the mic seat is the Send circle from its first frame (owner: "voice a tap lock korle send button hoye jabe tokhono voice button na")',
    chat.includes("var lockPending by remember { mutableStateOf(false) }") &&
      chat.includes("var recStarting by remember { mutableStateOf(false) }") &&
      chat.includes("recStarting = true") &&
      chat.includes("recStarting = false") &&
      chat.includes("lockPending = false") &&
      /gateMicCamera\(video = false\) \{[\s\S]{0,300}?recStarting = false[\s\S]{0,500}?voiceLocked = lockPending[\s\S]{0,120}?lockPending = false/.test(
        chat,
      ) &&
      // and the queue never survives a failed start or an ended take
      chat.includes(
        'lockPending = false\n                    error = "Mic is not available. Check the mic permission."',
      ) &&
      /val wasLocked = voiceLocked\n        voiceLocked = false\n        lockPending = false/.test(
        chat,
      ),
  );
  /* ---- r73-19: the owner's screenshots — the locked row is a transport ---- */
  const vn = main("VoiceNote.kt");
  check(
    'r73-19 (owner: "dekho tap hol korle kemom hobe ar lock korle kemon kore record korbe"): the locked strip is Telegram\'s transport — a red bin on the left, the clock and the live wave in the middle, Pause / Resume beside the Send circle — while the unlocked strip keeps the pulsing dot and "‹ Slide to cancel"',
    comp.includes("IconButton(onClick = { onCancelVoice() }, Modifier.size(30.dp))") &&
      comp.includes('"Delete recording",') &&
      comp.includes(".clickable { onTogglePause() }") &&
      comp.includes("if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause,") &&
      comp.includes("color = if (locked && paused) Muted else Ink,") &&
      comp.includes("comp_pulse_placeholder") === false &&
      comp.includes("PulsingDot()") &&
      comp.includes('Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)') &&
      // the composer's new contract + the chat's state
      comp.includes("paused: Boolean = false,") &&
      comp.includes("onTogglePause: () -> Unit = {},") &&
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
      chat.includes("KpDoubleTapSeat {\n                Box("),
  );
}

/* ------------- 19b. the once-view voice note (r71) ------------- */
{
  const chat = main("ChatScreen.kt");
  const list = main("ChatListScreen.kt");
  check(
    "r71-19b: the locked seat's SECOND tap is the view-once send — combinedClickable's own double-tap window holds the plain tap, so one tap still sends a normal note and two send it once",
    chat.includes("onSendVoiceOnce: () -> Unit = {},") &&
      // r71-20 branches the seat's double tap with a `when` (text first).
      /onDoubleClick =\n\s+when \{[\s\S]{0,240}?locked && selectCount == 0 -> onSendVoiceOnce[\s\S]{0,80}?else -> null/.test(
        chat,
      ) &&
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
      /onDoubleClick =\n\s+when \{[\s\S]{0,220}?input\.isNotBlank\(\) -> onSendTextOnce[\s\S]{0,160}?locked && selectCount == 0 -> onSendVoiceOnce[\s\S]{0,80}?else -> null/.test(
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
    "r71-20: the veil is real on every device — a Compose blur where the platform has one (API 31+), the same shape in placeholder marks where it does not — and the far side's tap starts the visible five seconds",
    chat.includes("internal const val ONCE_TEXT_REVEAL_MS = 5_000L") &&
      chat.includes("internal fun veiledText(body: String): String =") &&
      chat.includes(
        "if (veil && android.os.Build.VERSION.SDK_INT < 31) veiledText(body) else body",
      ) &&
      chat.includes("Modifier.blur(7.dp, edgeTreatment = BlurredEdgeTreatment.Unbounded)") &&
      chat.includes("val veil = !mine && !revealed") &&
      chat.includes("!mine && !revealed -> {") &&
      chat.includes(
        'Text("Tap to view", color = Ink, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)',
      ) &&
      chat.includes('Text("${((leftMs + 999) / 1000)}s", color = Red, fontSize = 10.sp)'),
  );
  check(
    "r71-20: the fifth second spends the opening (ViewOnce.spend → the row is deleted for BOTH sides), and my own copy is never veiled from me",
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
    "r72-20: the once-view text bubble IS the app's own text bubble — the same width rule as every message, the same wrap, the same lift, and the stamp riding UNDER it (never a private 260 dp box with the stamp crammed inside)",
    chat.includes("val bubbleMax =") &&
      chat.includes(".widthIn(max = bubbleMax)") &&
      chat.includes(".wrapContentWidth()") &&
      chat.includes(".kpLift(2.dp, shape)") &&
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
    "r71-18: the switches are the server's (read from the conversation, written back one at a time) and a capture alert lands as a red chip with one buzz",
    chat.includes('c?.optJSONObject("privacy")') &&
      chat.includes(
        "fun setChatPrivacy(shot: Boolean? = null, rec: Boolean? = null, save: Boolean? = null)",
      ) &&
      chat.includes('"/api/conversations/$convId/privacy"') &&
      chat.includes("internal fun captureAlertOf(m: JSONObject): String?") &&
      chat.includes('b.endsWith("took a screenshot of this chat") -> "shot"') &&
      chat.includes('b.endsWith("started a screen recording of this chat") -> "rec"') &&
      chat.includes("Icons.Filled.Videocam else Icons.Filled.VisibilityOff") &&
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
