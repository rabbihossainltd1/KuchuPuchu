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

/* ---------- 16 (r71): the owner rejected the shadow type outright ---------- */
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
      comp.includes(
        'Icon(Icons.Filled.Close, "Cancel recording", tint = Red, modifier = Modifier.size(16.dp))',
      ) &&
      comp.includes(
        'Icon(Icons.Filled.Lock, "Locked", tint = accent, modifier = Modifier.size(14.dp))',
      ) &&
      comp.includes('Text("Locked", color = accent, fontSize = 12.5.sp, maxLines = 1)') &&
      comp.includes('Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)') &&
      comp.includes("locked: Boolean = false,") &&
      comp.includes("onLockRecord: () -> Unit = {},"),
  );
  check(
    "r71-19: the chat owns the locked state — set by lockRecording (with its confirm buzz), cleared the moment the take starts and the moment it ends, and a locked note that the user then SENDS is never swallowed by the sub-second slip rule in silence",
    chat.includes("var voiceLocked by remember { mutableStateOf(false) }") &&
      chat.includes("fun lockRecording() {") &&
      chat.includes("if (!recording) return") &&
      chat.includes("voiceLocked = true") &&
      (chat.match(/voiceLocked = false/g) || []).length === 2 &&
      chat.includes("val wasLocked = voiceLocked") &&
      chat.includes('if (wasLocked) error = "That voice note is too short."') &&
      chat.includes("locked = voiceLocked,") &&
      chat.includes("onLockRecord = { lockRecording() },") &&
      chat.includes("onSendVoice = { finishRecording(cancelled = false) },") &&
      chat.includes("onCancelVoice = { finishRecording(cancelled = true) },"),
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
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r70-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
