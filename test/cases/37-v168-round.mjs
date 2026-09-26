// v168 — the owner's round 42 after testing v167 (uploads/kuchupuchu-r42.md):
//
// 1. media editor: the edit options were "elomelo, ek size er na", left to
//    right — they are now one 40 dp vertical rail on the RIGHT side (rotate /
//    crop / sticker / text / pen / clear / save, top to bottom, evenly
//    spaced), and undo / redo are the top bar's two corners ("undo redo
//    button 2ta upore left right ei thakuk").
// 2. video editor: a play / pause control on the stage (the tap-to-pause of
//    StatusTrimPreview never receives the tap — the overlay canvas claims it).
// 3. the clip bake is fast: a trim with no layers is a passthrough remux (no
//    encoder at all) and the encoder itself runs at realtime priority; when
//    the bake lands the stage AUTO-PAUSES on the new clip.
// 4. privacy: a private profile protects its owner FROM OTHERS — it never
//    blocks the owner themself (selfPrivate left every client gate), while a
//    PRIVATE PEER still withholds save / forward / capture exactly as before.
// 5. AI: the hedge starts at 800 ms (was 1600) and the live bubble animates
//    word by word, smoothly, while the stream writes.
// 6. the voice bubble is a notch smaller — body padding, button, wave, line.
//
// There is no Android SDK in this sandbox, so the Android half is pinned as
// source shape (CI's assembleRelease is the compile) — same convention as
// 32/34/35/36.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const root = new URL(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/",
  import.meta.url,
);
const kt = (f) => readFileSync(new URL(f, root), "utf8");
const edit = kt("MediaEditScreen.kt");
const vexport = kt("VideoExport.kt");
const chat = kt("ChatScreen.kt");
const worker = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const viewer = kt("MediaViewer.kt");
const mediaTab = kt("ChatMediaScreen.kt");
const calls = kt("CallScreens.kt");
const profile = kt("ProfileScreen.kt");
const secure = kt("KpSecure.kt");
const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");

/* 1 — the editor chrome v2: plain centred history, checkbox corner, new rail */
check(
  "v169 item 1: undo + redo are plain 32 dp IconButtons SIDE BY SIDE in the top bar CENTRE (no circle, no border), the select checkbox stays the top bar's right-most seat, HD keeps its seat, and the right rail reads pen / sticker / crop / text / rotate / effects / save with every seat live - the trash seat and the swipe-up hint are gone",
  edit.includes("IconButton(onClick = { haptics.tap(); undoEdit() }, enabled = canUndo") &&
    edit.includes("IconButton(onClick = { haptics.tap(); redoEdit() }, enabled = canRedo") &&
    edit.indexOf("Icons.AutoMirrored.Filled.Undo") <
      edit.indexOf("Icons.AutoMirrored.Filled.Redo") &&
    edit.includes(".align(Alignment.TopEnd)") &&
    edit.includes(".padding(top = 52.dp, end = 8.dp),") &&
    edit.includes("verticalArrangement = Arrangement.spacedBy(8.dp),") &&
    // rail order: pen, sticker, crop, text, rotate, effects, save
    edit.indexOf("penMode = !penMode") <
      edit.indexOf('Icon(Icons.Filled.EmojiEmotions, "Stickers"') &&
    edit.indexOf('Icon(Icons.Filled.EmojiEmotions, "Stickers"') <
      edit.indexOf("if (cropping) exitCrop() else enterCrop()") &&
    edit.indexOf("if (cropping) exitCrop() else enterCrop()") <
      // r71-16: the rail glyphs take the adaptive ink (chromeInk) now; the
      // ORDER this pin guards is unchanged.
      edit.indexOf('Text("Aa", color = chromeInk, fontSize = 15.sp') &&
    edit.indexOf('Text("Aa", color = chromeInk, fontSize = 15.sp') <
      edit.indexOf("StageHistory(true, { haptics.tap(); rotateTap() })") &&
    edit.indexOf("StageHistory(true, { haptics.tap(); rotateTap() })") <
      edit.indexOf("Icons.Filled.AutoAwesome") &&
    edit.indexOf("Icons.Filled.AutoAwesome") <
      edit.indexOf("StageHistory(true, { haptics.tap(); saveCurrent() })") &&
    // gone: the trash seat, the swipe hint, the armed-seat bug, v168 corners
    !edit.includes("StageHistory(canClear") &&
    !edit.includes('Icon(Icons.Filled.Delete, "Clear"') &&
    !edit.includes("Swipe up for filters") &&
    !edit.includes("StageHistory(penMode, {") &&
    !edit.includes("StageHistory(cropping, {") &&
    !edit.includes("StageHistory(canUndo") &&
    !edit.includes("StageHistory(canRedo"),
);

/* 2 — the video editor: tap-to-pause, paused-only glyph, live player */
check(
  "v169 item 2: a plain tap on the stage toggles play/pause (the overlay loop hands clean taps to onStageTap), the 56 dp play glyph shows ONLY while paused and hides on resume, and the preview's TextureView + player are re-keyed by uri so the clip still plays after a bake swaps the file (v168's always-on 48 dp seat is gone)",
  edit.includes("fun StageCanvas(onStageTap: () -> Unit = {}) {") &&
    edit.includes("onStageTap()") &&
    edit.includes("StageCanvas(onStageTap = {") &&
    edit.includes("vidPaused = !vidPaused") &&
    edit.includes("if (vidPaused && !cropping && !penMode && !busy) {") &&
    edit.includes(
      'Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(32.dp))',
    ) &&
    !edit.includes("Icons.Filled.Pause") &&
    readFileSync(
      new URL(
        "../../native-android/app/src/main/java/app/kuchupuchu/android/CropTrimKit.kt",
        import.meta.url,
      ),
      "utf8",
    ).includes("androidx.compose.runtime.key(uri) {"),
);

/* 3 — the clip bake is fast and lands paused */
check(
  "v168 item 3: a Done whose only edit is the trim is a passthrough remux (no encoder at all - instant, the WhatsApp/Telegram feel), a bake with real layers still walks the encoder but at realtime priority (KEY_PRIORITY 0), and when a bake lands the stage AUTO-PAUSES on the fresh clip",
  edit.includes(
    "if (!layers) {\n                                VideoExport.passthrough(ctx, srcUri, s, e, file)",
  ) &&
    edit.includes("if (pickedIsVideo) vidPaused = true") &&
    vexport.includes("setInteger(MediaFormat.KEY_PRIORITY, 0)") &&
    // the degraded trim path and the never-vanish-a-layer guard survive
    edit.includes("if (layers) throw err") &&
    edit.includes("VideoExport.passthrough(ctx, srcUri, s, e, file)"),
);

/* 4 — a private profile protects against others, never against yourself */
check(
  "v168 item 4 (owner: 'private profile onnoder jonno hobe nijer jonno na'): selfPrivate is GONE from every client gate and from KpSecure - my own private profile no longer hides save / forward / capture on my side (chat, media tab, calls, my own profile page); a PRIVATE PEER or private group still flips privateChat and withholds all of it exactly as r31-21 built",
  !chat.includes("KpSecure.selfPrivate") &&
    !mediaTab.includes("KpSecure.selfPrivate") &&
    !calls.includes("KpSecure.selfPrivate") &&
    !profile.includes("KpSecure.selfPrivate") &&
    !secure.includes("fun selfPrivate") &&
    chat.includes("val privateChat = KpSecure.privatePeer(c) || privateGroup") &&
    calls.includes("KpSecure.Guard(call.otherPrivate)") &&
    profile.includes("val privatePerson = !isMe && KpSecure.privateUser(u)") &&
    // the peer rule survives untouched
    // r71-18: the viewer's Save gate grew the peer's switch; the peer rule
    // itself is the same one r31-21 built.
    // r71-17/18: the owner's rule is first, then the once/peer gate.
    chat.includes("canSave = KpSecure.amOwner() ||") &&
    chat.includes("KpSecure.Guard(privateChat)") &&
    viewer.includes("KpSecure.Guard(secure || !canSave)") &&
    viewer.includes(
      "if (m != null && !saved && (KpSecure.amOwner() || (!privateClip && !noSaveClip))) {",
    ),
);

/* 5 — the AI reply starts sooner and types word by word */
check(
  "v168 item 5 (r55 update): the typing bubble hedges the model after 800 ms (was 1_600) and the LIVE AI bubble reveals through a FRAME-SMOOTH fractional-char pen (dt-timed 26/55/90 cps, 16/30 ms frames - the r55 realtime fix; the word staircase is gone by design); the completed answer lands whole and the handover guards stay",
  worker.includes("const AI_HEDGE_MS = 800;") &&
    !worker.includes("AI_HEDGE_MS = 1_600") &&
    chat.includes("var liveReveal by remember { mutableStateOf(0) }") &&
    chat.includes("behind > 120 -> 90f") &&
    chat.includes("behind > 40 -> 55f") &&
    chat.includes("frac = minOf(target, frac + cps * dt)") &&
    chat.includes("if (frac >= target) delay(30) else delay(16)") &&
    chat.includes("revealChars = liveReveal.coerceAtMost(aiLiveBody.length),") &&
    !chat.includes("revealChars = aiLiveBody.length,") &&
    // the completed answer still lands whole, and the handover guards stay
    chat.includes("liveReveal = aiLiveBody.length") &&
    chat.includes("if (paintedLive || mid == aiRevealId) return@LaunchedEffect"),
);

/* 6 — the voice card is compact, body included */
check(
  "v168 item 6 (owner: 'voice message ta er bubble ta body shoho onek boro ... choto kore daw'): the voice bubble came in another notch WITH its body - a 28 dp play circle (17 dp glyphs), a 112 x 16 dp wave centred by the 6 dp column pad, a 10 sp time line, and the bubble's own text padding tightened around the card (voiceNote: 8/3/6/3); the r33 scrub-to-seek row and the 16 dp spinner seat are untouched",
  chat.includes(".size(32.dp)\n                    .pressScale(interaction)") &&
    (chat.match(/size\(18\.dp\)\.scale\(if \(pressed\) 0\.85f else 1f\)/g) || []).length === 2 &&
    chat.includes("Spacer(Modifier.width(8.dp))\n            VoiceWave(") &&
    chat.includes("modifier = Modifier.weight(1f).height(20.dp),") &&
    chat.includes(
      "fontSize = 10.sp,\n                lineHeight = 12.sp,\n                color = if (mine) Color(0x99FFFFFF) else Muted,",
    ) &&
    // v169: the body frame is back to the shared one - the stamp left the
    // bubble instead, which is what actually shrinks the card's footprint.
    !chat.includes("val voiceNote") &&
    chat.includes(
      ".padding(start = if (voiceRow) 0.dp else 10.dp, top = if (voiceRow) 0.dp else 4.dp, end = if (voiceRow) 0.dp else 8.dp, bottom = if (voiceRow) 0.dp else if (fileRow) 4.dp else if (textLike) 0.dp else 15.dp)",
    ) &&
    chat.includes("horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,") &&
    // r33's scrub-to-seek and the spinner survive verbatim
    chat.includes("(active || scrubAt != null) && secs > 0 -> {") &&
    chat.includes("modifier = Modifier.size(16.dp),"),
);

/* 7 — the owner's animation pack (now Noto per v200 item 2) */
const fx7 = kt("ChatFx.kt");
const emo = kt("EmojiAnim.kt");
check(
  "v200 item 2 (Noto): ChatFx keeps slot/letter/blur/landing/shine/pop/progress + FxArrivals, but old custom emoji registry is gone (now Noto Lottie). EmojiAnim.kt hosts NotoAnimatedEmoji + emojiToCodepoint + Lottie asset",
  !fx7.includes("object EmojiAnimationRegistry") &&
    !fx7.includes("enum class EmojiFx") &&
    !fx7.includes("data class EmojiAnim(") &&
    !fx7.includes("fun AnimatedEmoji") &&
    fx7.includes("Noto animated emoji") &&
    fx7.includes("object FxArrivals") &&
    fx7.includes("fun Modifier.fxSlotOpen") &&
    fx7.includes("fun fxLetterSpans") &&
    fx7.includes("fun fxAnimatorScale") &&
    fx7.includes("fun fxScaleOf") &&
    fx7.includes("ANIMATOR_DURATION_SCALE") &&
    fx7.includes("fun Modifier.fxLanding") &&
    fx7.includes("fun Modifier.fxShineRipple") &&
    fx7.includes("fun Modifier.fxBlurIn") &&
    fx7.includes("fun Modifier.fxPopIn") &&
    fx7.includes("fun Modifier.fxProgressLine") &&
    emo.includes("fun emojiToCodepoint") &&
    emo.includes("fun NotoAnimatedEmoji") &&
    emo.includes("rememberLottieComposition") &&
    emo.includes("LottieCompositionSpec.Asset") &&
    emo.includes("noto-emoji") &&
    emo.includes("emojiFxReplays") &&
    chat.includes("val fxFresh =") &&
    // r67-3: the arrival stamp is still taken ONCE, at first composition, and
    // the AI bot still never animates here. What changed is that the FLIGHT is
    // claimed once per stable key (FxFlights) instead of being re-decided per
    // composition, so the sending echo and the row that replaces it are one
    // animation; the emoji glyph keeps its own live-birth predicate (fxEmoji).
    fx7.includes("object FxFlights") &&
    fx7.includes("fun claim(key: String): Boolean") &&
    chat.includes("val fxFresh = remember { fxBorn && FxFlights.claim(fxKey) }") &&
    (chat.includes('m.optString("senderId") == "kp_ai_bot" -> false') ||
      chat.includes('if (m.optString("senderId") == "kp_ai_bot") false')) &&
    chat.includes("FxArrivals.armed = false") &&
    chat.includes("if (msgs.isNotEmpty()) FxArrivals.armed = true") &&
    chat.includes(".fxSlotOpen(fxFresh)") &&
    chat.includes("fxLetterSpans(full, fxFresh)") &&
    (chat.includes('EmojiGlyphRow(m.optText("body").trim(), 66f, fxEmoji, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 66f, fxEmoji, m.optString("id"),') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 66f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 66f, fxFresh, m.optString("id"),') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 52f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 44f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 52f, fxFresh, m.optString("id"),')) &&
    (chat.includes('EmojiGlyphRow(m.optText("body").trim(), 40f, fxEmoji, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 40f, fxEmoji, m.optString("id"),') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 40f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 34f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(m.optText("body").trim(), 40f, fxFresh, m.optString("id"),')) &&
    (chat.includes('EmojiGlyphRow(st, 56f, fxEmoji, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(st, 56f, fxEmoji, m.optString("id"),') ||
      chat.includes('EmojiGlyphRow(st, 56f, fxFresh, m.optString("id"))') ||
      chat.includes('EmojiGlyphRow(st, 56f, fxFresh, m.optString("id"),')) &&
    chat.includes(".fxBlurIn(fxFresh)") &&
    chat.includes(".fxPopIn(fxGrow)") &&
    chat.includes(".fxProgressLine(fxGrow, docInk)"),
);

/* 7b - r52: the Claude pack's measured send flight (SendFlight.kt) */
const fx8 = kt("SendFlight.kt");
check(
  "v169 item 7b (r53): the send/receive flight rides the PENDING row from the MEASURED composer pill - the pill exports its window bounds (fxComposerAnchor), the bubble flies at its original size along a quadratic arc (translation/alpha only, no scaleX/scaleY), the seat is tracked LIVE so the send-time scroll can move it mid-flight and the bubble still lands exactly on it, and paintSent pre-marks the real id so the painted row replaces it silently",
  fx8.includes("object FlightAnchors") &&
    fx8.includes("fun Modifier.fxComposerAnchor()") &&
    fx8.includes("fun Modifier.fxFlyIn(") &&
    fx8.includes("startAbs = Offset(s.left, startY)") &&
    fx8.includes("translationX = 0f") &&
    fx8.includes("val lift = sin(v * PI.toFloat()) * 8f * density") &&
    fx8.includes("snapshotFlow { seat }.filterNotNull().first()") &&
    fx8.includes("val p0 = Offset(0f, startAbs.y - s.top)") &&
    !fx8.includes("scaleX =") &&
    chat.includes(".fxComposerAnchor()") &&
    chat.includes("FxArrivals.markSeen(id)") &&
    chat.includes(
      '.fxFlyIn(fxFresh, if (kind == "TEXT") 680 else if (kind == "FILE" && fileLooksVoice(m)) 720 else 700, isSent = mine)',
    ) &&
    // r46 item 6: the landing + shine + ripple ride the BUBBLE box, never
    // the full-width row (the light swept the whole chat before).
    chat.includes(".fxLanding(fxLanded)") &&
    chat.includes(".fxShineRipple(fxLanded)") &&
    chat.includes(".fxLanding(fxLanded)\n                    .fxShineRipple(fxLanded),"),
);
check(
  "r53: the send never hides - the send paths scroll to the bottom right away (no deferred-flight flag anywhere), the flight chases the moving seat instead; paintSent sweeps pending/msgs without iterators (the voice-send ConcurrentModificationException), the See more / See less toggle speaks the stamp's wallpaper ink outside the bubble, and the 2.5 s open-pin never drags back a reader who is scrolling away",
  !chat.includes("pendingScrollAfterLand") &&
    !chat.includes("onFlightLanded") &&
    chat.includes(
      "scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }",
    ) &&
    chat.includes("var donor: JSONObject? = null") &&
    chat.includes('r54 (owner: "see more ekhono removed ache")') &&
    chat.includes("color = Color.White,") &&
    chat.includes("(pinned && nearBottom && !listState.isScrollInProgress)"),
);
check(
  "r52/r54: history stays smooth - older pages prefetch before row 0 (idx <= 2) and land on the exact row+offset the fling was on; the See more/See less toggle rides INSIDE the bubble under the body (the v177 layout that renders), folding at ten lines",
  chat.includes("if (idx <= 2 && scrolling) loadOlder()") &&
    chat.includes("listState.scrollToItem(freshOld.size + fi, fo)") &&
    chat.includes('r54 (owner: "see more ekhono removed ache")') &&
    chat.indexOf('"See less"') > chat.indexOf("when (kind) {"),
);

/* r55 — the owner's round 55 after testing v180 */
check(
  "r55 item 1: See less works both ways - the fold toggle collapses an expanded long body, the bubble animates its size change (animateContentSize before combinedClickable), and the state write happens before the haptic",
  chat.includes(
    ".pointerInput(Unit) {\n                                    detectTapGestures {\n                                        msgExpanded = !msgExpanded\n                                        runCatching { haptics.tap() }",
  ) &&
    chat.includes(".animateContentSize(") &&
    chat.includes(".combinedClickable("),
);
/* r56 — the owner's round 56 */
check(
  "r56 item 3: stage zoom pointerInput uses Unit key so first pinch attempt zooms freely without cancelling mid-gesture",
  edit.includes(
    ".pointerInput(Unit) {\n                                    detectTransformGestures {",
  ) &&
    edit.includes(".pointerInput(Unit) {\n                                    detectTapGestures("),
);
check(
  "r56 item 2: live typing/voice indicator clears on send/message arrival, pings voice on record start, deletes typing in batch on send",
  src.includes('db.prepare("DELETE FROM typing WHERE conv_id = ? AND user_id = ?")') &&
    src.includes('rawKind === "clear"') &&
    chat.includes("otherTypingAt = 0L") &&
    chat.includes(
      'Api.post("/api/conversations/$convId/typing", JSONObject().put("kind", "clear"))',
    ),
);
check(
  "r56 item 1: See more/See less uses Color.White, collapses on exact toggle click (not body tap), and has smooth spring animation",
  chat.includes("color = Color.White,") &&
    chat.includes(
      ".pointerInput(Unit) {\n                                    detectTapGestures {\n                                        msgExpanded = !msgExpanded\n                                        runCatching { haptics.tap() }",
    ) &&
    chat.includes(
      ".animateContentSize(animationSpec = spring(dampingRatio = 0.85f, stiffness = 400f))",
    ),
);
check(
  "r55 item 3: the flight seat stays live for the WHOLE flight (gate is !done, set only after animateTo) - the stale-seat freeze that made v179/v180 fly invisible is gone",
  fx8.includes("if (active && !done) seat = c.boundsInWindow()") &&
    fx8.includes("done = true") &&
    !fx8.includes("if (active && !fired) seat"),
);
check(
  "r55 item 4: the ringing avatar no longer zooms - PulseRing and its scale import are gone, IncomingCallScreen shows the plain CallAvatar",
  !calls.includes("PulseRing") &&
    !calls.includes("import androidx.compose.ui.draw.scale") &&
    calls.includes("CallAvatar(call, 108.dp)"),
);
check(
  "r55 item 5: the media editor stage pinch-zooms (1x-4x) + pans + double-taps, gated off while pen/crop/overlay own the screen, browse swipe stands down while zoomed",
  edit.includes("var stageZoom by remember(pickedUri) { mutableStateOf(1f) }") &&
    edit.includes("scaleX = stageZoom") &&
    edit.includes("detectTransformGestures") &&
    edit.includes("(stageZoom * zoom).coerceIn(1f, 4f)") &&
    edit.includes("&& stageZoom <= 1f"),
);
check(
  "r55 item 6: the typing reveal is a frame-smooth fractional-char pen (dt-timed, no word steps) on both the live-AI and committed rows",
  chat.includes("frac + 26f * dt") &&
    chat.includes("android.os.SystemClock.uptimeMillis()") &&
    chat.includes("aiRevealChars = pos"),
);
check(
  "r55 item 7: recording shows a pulsing microphone in the receiver's typing seat - the client pings kind=voice while recording, the worker persists + broadcasts kind, and RecordingBubble renders in the typing row",
  chat.includes(
    'Api.post("/api/conversations/$convId/typing", JSONObject().put("kind", "voice"))',
  ) &&
    chat.includes("private fun RecordingBubble(mic: Color)") &&
    chat.includes('otherTypingKind == "voice"') &&
    worker.includes("kind = excluded.kind") &&
    worker.includes("        kind,\n      }),"),
);
check(
  "r55 item 8: media deleted for this phone never shows in the profile media panel - every list drops hiddenMsgIds owners",
  mediaTab.includes("ScreenStore.hiddenMsgIds.contains(mid)") &&
    mediaTab.includes('images = data.arr("images").objects().visible()'),
);
check(
  "r55 item 9: the chat only marks read while the app is actually foreground - the poll-tick read POST is gated on Store.foreground",
  chat.includes("if (Store.foreground && (markRead || (newMessage && prevTop.isNotBlank())))"),
);

console.log(lines.join("\n"));
console.log(
  `v168 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
