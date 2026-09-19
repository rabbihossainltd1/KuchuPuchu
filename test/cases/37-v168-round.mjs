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
      edit.indexOf('Text("Aa", color = Color.White, fontSize = 15.sp') &&
    edit.indexOf('Text("Aa", color = Color.White, fontSize = 15.sp') <
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
    chat.includes("canSave = !privateChat && !once,") &&
    chat.includes("KpSecure.Guard(privateChat)") &&
    viewer.includes("KpSecure.Guard(secure || !canSave)") &&
    viewer.includes("if (m != null && !privateClip && !saved) {"),
);

/* 5 — the AI reply starts sooner and types word by word */
check(
  "v168 item 5: the typing bubble hedges the model after 800 ms (was 1_600 - the reply starts streaming twice as early) and the LIVE AI bubble reveals WORD BY WORD - a steady 40 ms pen (one word a step while the buffer is small, proportional catch-up when the stream races) - replacing the instant full-body paint and the v168 burst; the completed answer lands whole and the committed-row reveal (r49) is untouched",
  worker.includes("const AI_HEDGE_MS = 800;") &&
    !worker.includes("AI_HEDGE_MS = 1_600") &&
    chat.includes("var liveReveal by remember { mutableStateOf(0) }") &&
    chat.includes("behind > 80 -> 4") &&
    chat.includes("behind > 36 -> 3") &&
    chat.includes("delay(40)") &&
    chat.includes("!aiLiveBody[pos].isWhitespace()") &&
    chat.includes("revealChars = liveReveal.coerceAtMost(aiLiveBody.length),") &&
    !chat.includes("revealChars = aiLiveBody.length,") &&
    // the completed answer still lands whole, and the handover guards stay
    chat.includes("liveReveal = aiLiveBody.length") &&
    chat.includes("if (paintedLive || mid == aiRevealId) return@LaunchedEffect") &&
    chat.includes("pos = body.indexOf(' ', pos + 1).takeIf { it >= 0 } ?: body.length"),
);

/* 6 — the voice card is compact, body included */
check(
  "v168 item 6 (owner: 'voice message ta er bubble ta body shoho onek boro ... choto kore daw'): the voice bubble came in another notch WITH its body - a 28 dp play circle (17 dp glyphs), a 112 x 16 dp wave centred by the 6 dp column pad, a 10 sp time line, and the bubble's own text padding tightened around the card (voiceNote: 8/3/6/3); the r33 scrub-to-seek row and the 16 dp spinner seat are untouched",
  chat.includes(".size(28.dp)\n                    .pressScale(interaction)") &&
    (chat.match(/size\(17\.dp\)\.scale\(if \(pressed\) 0\.85f else 1f\)/g) || []).length === 2 &&
    chat.includes("Column(Modifier.padding(top = 3.dp)) {\n                VoiceWave(") &&
    chat.includes("modifier = Modifier.width(150.dp).height(22.dp),") &&
    chat.includes(
      "fontSize = 10.sp,\n                    lineHeight = 12.sp,\n                    color = if (mine) Color(0x99FFFFFF) else Muted,",
    ) &&
    // v169: the body frame is back to the shared one - the stamp left the
    // bubble instead, which is what actually shrinks the card's footprint.
    !chat.includes("val voiceNote") &&
    chat.includes(
      ".padding(start = 10.dp, top = 4.dp, end = 8.dp, bottom = if (voiceRow) 0.dp else if (fileRow) 4.dp else if (textLike) 0.dp else 15.dp)",
    ) &&
    chat.includes("horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,") &&
    // r33's scrub-to-seek and the spinner survive verbatim
    chat.includes("(active || scrubAt != null) && secs > 0 -> {") &&
    chat.includes("modifier = Modifier.size(16.dp),"),
);

/* 7 — the owner's animation pack (ChatAnimationsComplete): receive side */
const fx7 = kt("ChatFx.kt");
check(
  "v169 item 7 (r44): the receive animation pack is in - a shared Compose-only ChatFx.kt (emoji registry with entry/idle/fx, slot open, letter-by-letter reveal, de-blur media reveal, landing squash, shine + ripple) that respects the animator duration scale; arrivals are marked synchronously at the row's FIRST composition (FxArrivals) so nothing ever lands-then-replays, history composes before the screen arms, and the AI bot's rows never animate here",
  fx7.includes("object EmojiAnimationRegistry") &&
    fx7.includes('"\ud83d\ude02" to EmojiAnim("shake-in", "shake", EmojiFx.TEARS)') &&
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
    fx7.includes("fun AnimatedEmoji") &&
    chat.includes("val fxFresh =") &&
    chat.includes(
      'liveBorn && FxArrivals.mark(m.optString("id")) != null && m.optString("senderId") != "kp_ai_bot"',
    ) &&
    chat.includes("FxArrivals.armed = false") &&
    chat.includes("if (msgs.isNotEmpty()) FxArrivals.armed = true") &&
    chat.includes(".fxSlotOpen(fxFresh)") &&
    chat.includes("fxLetterSpans(full, fxFresh)") &&
    chat.includes('AnimatedEmoji(m.optText("body").trim(), 44f, fxFresh)') &&
    chat.includes(".fxBlurIn(fxFresh)") &&
    chat.includes("grow = fxGrow,") &&
    chat.includes(".fxPopIn(fxGrow)") &&
    chat.includes(".fxProgressLine(fxGrow, docInk)"),
);

/* 7b - r52: the Claude pack's measured send flight (SendFlight.kt) */
const fx8 = kt("SendFlight.kt");
check(
  "v169 item 7b (r52): the send/receive flight rides the PENDING row from the MEASURED composer pill - the pill exports its window bounds (fxComposerAnchor), the bubble flies at its original size along a quadratic arc (translation/alpha only, no scaleX/scaleY), the follow-scroll waits for the landing (pendingScrollAfterLand) so the seat never moves mid-flight, and paintSent pre-marks the real id so the painted row replaces it silently",
  fx8.includes("object FlightAnchors") &&
    fx8.includes("fun Modifier.fxComposerAnchor()") &&
    fx8.includes("fun Modifier.fxFlyIn(") &&
    fx8.includes("val startX = if (isSent) pill.right - s.width else pill.left") &&
    fx8.includes("val lift = sin(e * PI.toFloat()) * 8f * density") &&
    !fx8.includes("scaleX =") &&
    chat.includes(".fxComposerAnchor()") &&
    chat.includes("val wasFlying = FxArrivals.mark(id) != null") &&
    chat.includes(
      '.fxFlyIn(fxFresh, if (kind == "TEXT") 680 else if (voiceRow) 720 else 700, isSent = mine)',
    ) &&
    chat.includes("var pendingScrollAfterLand by remember { mutableStateOf(false) }") &&
    chat.includes("LaunchedEffect(flightLandedNonce)") &&
    chat.includes("onFlightLanded = { flightLandedNonce++ }") &&
    // r46 item 6: the landing + shine + ripple ride the BUBBLE box, never
    // the full-width row (the light swept the whole chat before).
    chat.includes(".fxLanding(fxLanded)") &&
    chat.includes(".fxShineRipple(fxLanded)") &&
    chat.includes(".fxLanding(fxLanded)\n                    .fxShineRipple(fxLanded),"),
);
check(
  "r52: history stays smooth - older pages prefetch before row 0 (idx <= 2) and land on the exact row+offset the fling was on; the See more/See less toggle lives OUTSIDE the bubble so the bubble's combinedClickable can never eat the second tap",
  chat.includes("if (idx <= 2 && scrolling) loadOlder()") &&
    chat.includes("listState.scrollToItem(freshOld.size + fi, fo)") &&
    chat.includes('r52 (owner: "see more work korleo see less working na")') &&
    chat.indexOf('"See less"') > chat.indexOf(".fxShineRipple(fxLanded)"),
);

console.log(lines.join("\n"));
console.log(
  `v168 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
