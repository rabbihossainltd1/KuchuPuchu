// v166 — the owner's round after testing v165. What each item is, and the
// "why" that has to survive future edits:
//
// 1. fb#2 "video edit kore done dile lag kore ar done o hoi na edit uthe jai":
//    a clip bake runs the encoder on a big file; the Done chip used to sit
//    there looking frozen and a failed bake threw the edit away silently. The
//    chip now carries the export's own progress ("Applying 42%"), the
//    full-frame overlay bitmap is recycled the moment the encoder has it, and
//    a bake that produced an unplayable file is deleted and REPORTED instead
//    of being handed to the stage as mediaUri.
// 2. fb#4 "undo redo option pelam e na": the undo / redo trio is chrome now —
//    always drawn on the stage (undo LEFT, redo RIGHT), each dimmed while it
//    has nothing to act on.
// 3. fb#5 the clip's own shape while it is going out: sendFile is suspend and
//    measures the clip (VideoFacts) unless the caller already knows, seeding
//    meta.w/h/durMs, the pending echo's mediaW/H and the persistent thumbnail
//    sidecar — so the sending bubble and the sent row are the same box.
// 4. fb#7 "time colour ta ekhono white cream colour er blue na": the stamp
//    inks are real blues in the blue chat (bubble stamp + ticks + the chat
//    list's own clock), in BOTH app themes.
// 5. fb#8 "video photo … kothaw 3 dot nei … okhane Save, Forward, Delete": the
//    full-screen viewer / player / document viewer all carry the ⋮, its sheet
//    offers Save / Forward (+ Edit where it exists) and Delete, and Delete
//    round-trips to the chat that owns the list through ScreenStore — the
//    identical two functions the in-chat long-press sheet runs.
// 6. fb#9 "ai reply dite onek late korche": the brain is HEDGED — Gemini
//    starts first, the HF chain (2 models × 7 s, then Workers AI) starts mid-hedge
//    later and the first answer wins. Gemini is still the primary.
// 7. new#1 voice bubble / 8. new#2 link card: both are compact now.
// 9. new#3 send animation: v166 straightened the clone\'s walk; v167 (owner:
//    "kono fly effect thakbe na") deleted the engine — a send is simply in its
//    place. What survives from v166 is the ratio contract: the bubble and its
//    thumbnail ride the REAL media ratio while the send is in flight.
// 10. new#4: the bubble stops 5 dp short of the right edge.
// 11. new#5: a long body folds at 10 lines, decided by a measure taken while
//     composing at the bubble's own width (so the fold is right on frame one).
// 12. new#6: the in-app update popup is the owner's own maintenance-crew demo,
//     ported to Compose (KpUpdateScene) and recoloured to the app palette.
//
// v167 — the owner's round after testing v166 (the same file carries it so the
// round's rules cannot drift apart):
//
// 13. video: the rotate button is OUT of the player's top bar and the ⋮ took
//     its exact seat (one dots on the screen, on screen whenever the chrome
//     is); its menu always offers Save (a clip that is not on the phone yet is
//     fetched first), Forward and Delete, plus a Dismiss row (the photo
//     viewer's full-screen dialog had no other way out).
// 14. editor: undo / redo float on the STAGE at the two spots the owner marked
//     — 40 dp seats, one centred set, undo left of redo, hidden while cropping.
// 15. send animation: the fly engine is gone (no clone, no travel, no landing
//     bounce) — a send is simply in its place; what survives is the real ratio
//     of the media while it goes out.
// 16. the chat list's unread time is the app's blue, like every other time
//     (the warm GoldDeep he kept pointing at is gone).
// 17. the AI reply is LIVE: Gemini answers through streamGenerateContent and
//     every chunk is broadcast into the chat's room (throttled to 140 ms) so
//     the bubble is painted while the model writes; the HF legs still answer in
//     one piece and are painted whole when they win. The behavioural half of
//     this lock lives in 32 (a fake SSE stream + a recording room).
//
// There is no Android SDK in this sandbox, so the Android half is pinned as
// source shape (CI's assembleRelease is the compile) — same convention as 32/34/35.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const root = new URL(
  "../../native-android/app/src/main/java/app/kuchupuchu/android/",
  import.meta.url,
);
const kt = (f) => readFileSync(new URL(f, root), "utf8");
const chat = kt("ChatScreen.kt");
const list = kt("ChatListScreen.kt");
const edit = kt("MediaEditScreen.kt");
const viewer = kt("MediaViewer.kt");
const doc = kt("DocViewerScreen.kt");
const store = kt("ScreenStore.kt");
const lp = kt("LinkPreview.kt");
const scene = kt("KpUpdateScene.kt");
const app = kt("KpApp.kt");
const attach = kt("AttachSheet.kt");
const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const pkg = readFileSync(
  new URL("../../native-android/app/build.gradle.kts", import.meta.url),
  "utf8",
);

/* the round's own bookkeeping */
check(
  "v173: versionCode 173 / versionName 3.9.97",
  /versionCode\s*=\s*173/.test(pkg) && /versionName\s*=\s*"3\.9\.97"/.test(pkg),
);

/* 1 — fb#2: the clip bake can no longer look frozen or vanish */
check(
  'v166 fb#2: the clip bake reports itself — the Done chip carries the export\'s own progress ("Applying n%", dimmed while busy), the full-frame overlay is recycled in a finally, and a 0-byte / duration-less mp4 is deleted and thrown instead of becoming mediaUri',
  edit.includes("var applyPct by remember { mutableStateOf(-1f) }") &&
    edit.includes("if (busy) return") &&
    // v170: a clip's Done no longer walks the encoder - photos bake (-1), clips
    // ride the live preview (the send does the one and only bake).
    edit.includes("applyPct = -1f") &&
    edit.includes(
      "if (pickedIsVideo) {\n            haptics.confirm()\n            return\n        }",
    ) &&
    edit.includes("onProgress = { f -> applyPct = f.coerceIn(0f, 1f) },") &&
    edit.includes("runCatching { overlay?.recycle() }") &&
    edit.includes(
      "val ok = file.length() > 0L && VideoExport.probe(ctx, android.net.Uri.fromFile(file))?.durationMs?.let { it > 0L } == true",
    ) &&
    edit.includes(
      'file.delete()\n                            throw Exception("The clip could not be saved.")',
    ) &&
    edit.includes('"Could not apply that clip edit — try again."') &&
    edit.includes("if (hasEdits || busy) {") &&
    edit.includes('if (busy && pct >= 0f) "Applying ${(pct * 100).toInt()}%" else "Done",') &&
    edit.includes("color = Color.White.copy(alpha = if (busy) 0.7f else 0.94f),"),
);

/* 2 — fb#4: undo / redo plain + centred (v169), trash gone */
check(
  "v166 fb#4 (seats moved by v169): undo / redo are always present whenever there is media - plain 32 dp IconButtons side by side in the top bar centre (v169 owner: middle, pasha pashi, no big circle / border); the trash seat is gone, undo covers it",
  edit.includes("if (shot != null || clip != null) {") &&
    edit.includes("IconButton(onClick = { haptics.tap(); undoEdit() }, enabled = canUndo") &&
    edit.includes("tint = Color.White.copy(alpha = if (canUndo) 1f else 0.35f)") &&
    edit.includes("tint = Color.White.copy(alpha = if (canRedo) 1f else 0.35f)") &&
    !edit.includes("StageHistory(canClear") &&
    edit.indexOf("undoEdit()") < edit.indexOf("redoEdit()") &&
    edit.includes("val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()") &&
    edit.includes("val canRedo = redoStack.isNotEmpty()") &&
    (edit.match(/\.size\(26\.dp\)/g) || []).length === 2,
);

/* 3 — fb#5: the sending clip is the clip's own shape */
check(
  "v166 fb#5: sendFile is suspend and takes the clip's own w / h / durMs, measures it (VideoFacts.probe) when the caller has no numbers, writes the persistent thumbnail sidecar (VideoThumbs.writeMeta) and seeds the pending echo's mediaW / mediaH — the bubble that is still sending has the same box as the sent row, and the worker's echo carries the same meta",
  chat.includes(
    'suspend fun sendFile(\n        name: String,\n        mime: String,\n        file: File,\n        asDocument: Boolean = false,\n        viewOnce: Boolean = false,\n        sendAt: java.time.Instant? = null,\n        caption: String = "",\n        w: Int = 0,\n        h: Int = 0,\n        durMs: Long = 0L,\n    ) {',
  ) &&
    chat.includes("withContext(Dispatchers.IO) { VideoFacts.probe(file) ?: Triple(0, 0, 0L) }") &&
    chat.includes(
      "VideoThumbs.writeMeta(file.absolutePath, facts.first.toFloat(), facts.second.toFloat(), facts.third)",
    ) &&
    chat.includes('clipMeta.put("durMs", facts.third)') &&
    chat.includes(
      '.also { if (facts.first > 0 && facts.second > 0) it.put("mediaW", facts.first).put("mediaH", facts.second) }',
    ) &&
    // v167: the clip's measured box rides the PAYLOAD (and the row), not a
    // clone's flight box any more.
    chat.includes(
      'if (facts.first > 0 && facts.second > 0) clipMeta.put("w", facts.first).put("h", facts.second)',
    ) &&
    kt("VideoFacts.kt").includes("internal object VideoFacts {") &&
    chat.includes("fun writeMeta(key: String, w: Float, h: Float, ms: Long)") &&
    src.includes("mediaW: meta.w") &&
    chat.includes('if (facts.third > 0L) clipMeta.put("durMs", facts.third)') &&
    chat.includes(
      'val ms0 = seedMeta?.durationMs ?: m.optJSONObject("meta")?.optLong("durMs") ?: 0L',
    ),
);

/* 4 — fb#7: the time ink is blue, in both app themes */
check(
  "v166 fb#7: the bubble's time ink is a real blue on the blue chat — mine 0xFFBBD3FF, the received side mode-aware (0xFFA9C4F2 dark / 0xFF5B7FC7 light) — the near-white 0xFFD7E1F7 tint is gone, and the chat list's own clock carries the same blue in the light app",
  // v169: the stamp is under the bubble now - one mode-aware ink.
  chat.includes("val stampInk = when {") &&
    chat.includes("if (KpThemeMode.darkBlue) Color(0xFFA9C4F2) else Color(0xFF5B7FC7)") &&
    !chat.includes("Color(0xFFD7E1F7)") &&
    list.includes("color = if (KpThemeMode.darkBlue) Muted else Color(0xFF5B7FC7)"),
);

/* 5 — fb#8: the ⋮ + Delete everywhere, one route back to the chat */
check(
  'v166 fb#8: every full-screen surface carries the ⋮ — the photo viewer gates it on any action (save / forward / edit / delete), the player and the document viewer on the message alone — and Delete asks the chat\'s own two questions (KpDeleteSheet: "Delete for everyone" only when the sender owns it and it is not an echo, then "Delete for me", both in Red)',
  viewer.includes("internal fun KpDeleteSheet(") &&
    viewer.includes('KpSheetRow(Icons.Filled.DeleteForever, "Delete for everyone", tint = Red)') &&
    viewer.includes('KpSheetRow(Icons.Filled.Delete, "Delete for me", tint = Red)') &&
    viewer.includes(
      'internal fun isEchoMsg(m: JSONObject): Boolean = m.optString("id").startsWith("c_")',
    ) &&
    viewer.includes(
      "if (canSave || onForward != null || onEdit != null || onDeleteForMe != null || onDeleteForEveryone != null) {",
    ) &&
    // v167: the player's ⋮ is the top-bar seat (the rotate button's old place),
    // so it rides the same chrome the rest of the player does.
    viewer.includes(
      'Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))',
    ) &&
    viewer.includes(
      'val canUnsend = m != null && !isEchoMsg(m) && m.optString("senderId") == Store.myId()',
    ) &&
    doc.includes(
      'KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red) { menuOpen = false; confirmDelete = true }',
    ) &&
    doc.includes("canUnsend = canUnsend,") &&
    doc.includes('Icon(Icons.Filled.MoreVert, "More", tint = Ink)') &&
    chat.includes(
      'onDeleteForEveryone =\n                    if (m.optString("senderId") == Store.myId() && !isEchoMsg(m)) {',
    ),
);

check(
  "v166 fb#8 routing: a viewer's Delete names the message (ScreenStore.ViewerDelete + the viewerDelete flow) and the CHAT runs it — the row is found in msgs or pending, an album expands (albumPhotos), and the same unsendSelected / deleteForMe the long-press sheet calls does the work",
  store.includes("class ViewerDelete(val msgId: String, val everyone: Boolean)") &&
    store.includes(
      "val viewerDelete = kotlinx.coroutines.flow.MutableStateFlow<ViewerDelete?>(null)",
    ) &&
    chat.includes("ScreenStore.viewerDelete.collect { req ->") &&
    chat.includes('msgs.firstOrNull { it.optString("id") == req.msgId }') &&
    chat.includes('?: pending.firstOrNull { it.optString("clientId") == req.msgId }') &&
    chat.includes(
      'val ids = albumPhotos(row).map { it.optString("id") }.filter { it.isNotBlank() }',
    ) &&
    chat.includes("if (req.everyone && !pendingEchoOf(row)) unsendSelected() else deleteForMe()") &&
    viewer.includes("ScreenStore.viewerDelete.value = ScreenStore.ViewerDelete(id, everyone)") &&
    viewer.includes("nav.popBackStack()") &&
    doc.includes("ScreenStore.viewerDelete.value = ScreenStore.ViewerDelete(id, everyone)") &&
    chat.includes("val delMsg = viewerPhotos.getOrNull(viewerAt.coerceIn(viewerPhotos.indices))"),
);

/* 6 — fb#9: the hedged brain */
check(
  "v166 fb#9: the brain is hedged — AI_HEDGE_MS 800 since v168 (was 1 600), hedge() racing the primary against the gated secondary through Promise.any, hfThenCf capped at 2 HF models × 7 s then Workers AI, aiBrain = Gemini primary (or the HF chain alone without a key); the photo turn hedges Gemini against the HF vision leg and the voice turn against Whisper",
  src.includes("const AI_HEDGE_MS = 800;") &&
    src.includes("async function hedge(") &&
    src.includes(
      "return await Promise.any([answered(primary()), answered(gate.then(secondary))]);",
    ) &&
    src.includes(
      "function hfThenCf(env: Env, messages: HfChatMessage[], maxTokens: number): Promise<string | null> {",
    ) &&
    src.includes("hfChat(env, messages, maxTokens, HF_CHAT_MODELS.slice(0, 2), 7_000)") &&
    src.includes("if (!env.GEMINI_API_KEY) return hfThenCf(env, messages, maxTokens);") &&
    src.includes(
      "() => geminiChat(env, messages, maxTokens),\n    () => hfThenCf(env, messages, maxTokens),",
    ) &&
    // v167 (owner: "ai reply live Hobe … word by word"): the SAME hedge and the
    // same hedge (800 ms since v168), but the primary now paints through the stream — the photo
    // turn's Gemini leg streams and its HF leg is painted whole when it wins.
    src.includes(
      "answer = await hedgeStream(\n          (live) => geminiStream(env, fullPrompt, [{ mime: src.mime, b64 }], 900, live, 20_000),\n          hfLeg,",
    ) &&
    src.includes("const heard = await hedge(") &&
    src.includes("if (hf) return hf;\n        return aiBrain("),
);

/* 7 — new#1: the voice bubble is smaller again */
check(
  "v166 new#1: the voice card shrank — and v168 shrank it again: a 28 dp play circle (17 dp glyphs, 16 dp spinner), a 6 dp gap, a 112 × 16 dp wave and the 10 sp time line, with the column's 6 dp top keeping the wave centred on the button (and the bubble's own padding tightened via voiceNote)",
  chat.includes(".size(28.dp)\n                    .pressScale(interaction)") &&
    chat.includes("modifier = Modifier.size(17.dp).scale(if (pressed) 0.85f else 1f),") &&
    chat.includes("modifier = Modifier.size(16.dp),") &&
    chat.includes("Spacer(Modifier.width(6.dp))") &&
    chat.includes("modifier = Modifier.width(150.dp).height(16.dp),") &&
    chat.includes("Column {\n                VoiceWave(") &&
    chat.includes("fontSize = 10.sp,") &&
    chat.includes("modifier = Modifier.align(Alignment.End),"),
);

/* 8 — new#2: the link card is a thumbnail card */
check(
  "v166 new#2: LinkPreviewCard is a 96 dp picture band over tighter type — title 12.5 sp ×2, description 11.5 sp ×1, host 10.5 sp, 7/5 padding, a 3 dp bottom and a 9 dp radius (the full-width 1.91:1 banner is gone)",
  lp.includes("private val LINK_THUMB_H = 96.dp") &&
    lp.includes("modifier = Modifier.fillMaxWidth().height(LINK_THUMB_H),") &&
    lp.includes("fontSize = 12.5.sp,") &&
    lp.includes("lineHeight = 16.sp,") &&
    lp.includes("fontSize = 11.5.sp,") &&
    lp.includes("lineHeight = 15.sp,") &&
    lp.includes("fontSize = 10.5.sp, color = ink.copy(alpha = 0.65f), maxLines = 1") &&
    lp.includes("Column(Modifier.padding(horizontal = 7.dp, vertical = 5.dp)) {") &&
    lp.includes(".padding(bottom = 3.dp)") &&
    !lp.includes("aspectRatio(1.91f)"),
);

/* 9 — new#3: the send animation */
check(
  "v166 new#3 + v167: the send animation is a JUMP, not a flight — the owner\'s rule (\"massage jump korbe direct position a kono fly effect thakbe na\") holds because there is no clone, no travel and no landing bounce left to do it with; the media still keeps its real ratio while it goes out (the bubble\'s own w/h)",
  !chat.includes("KpFlySend(") &&
    !chat.includes("fun launchFly(") &&
    !chat.includes("flyHidden") &&
    !chat.includes("flyLanded") &&
    !chat.includes("sendFromRect") &&
    chat.includes(
      'if (facts.first > 0 && facts.second > 0) clipMeta.put("w", facts.first).put("h", facts.second)',
    ) &&
    chat.includes('.also { row -> if (w > 0 && h > 0) row.put("mediaW", w).put("mediaH", h) }') &&
    chat.includes('if (facts.third > 0L) clipMeta.put("durMs", facts.third)'),
);

/* 10 — new#4: 5 px of air on the right */
check(
  "v166 new#4: the bubble's ceiling is 5 dp smaller than the screen gives it (82 % / 280–420 dp minus 5), so no bubble runs flush into the right edge",
  chat.includes(
    "minOf(420.dp, (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.82f).dp) - 5.dp,",
  ) && chat.includes("maxOf(\n                    280.dp,"),
);

/* 11 — new#5: ten lines, then See more */
check(
  "v166 new#5: a long body folds at 10 lines — the count comes from a TextMeasurer pass made while composing at the bubble's own width (foldProbe / probeLines / longBody) with the onTextLayout high-water count as the second witness, typing replies exempt, and the See more / See less toggle is untouched",
  chat.includes("private const val BODY_COLLAPSE_LINES = 10") &&
    chat.includes("val foldProbe = rememberTextMeasurer()") &&
    chat.includes(
      "val foldWidth = with(LocalDensity.current) { (bubbleMax - 18.dp).roundToPx() }",
    ) &&
    chat.includes("val probeLines =") &&
    chat.includes(
      "val longBody = bodyLines > BODY_COLLAPSE_LINES || probeLines > BODY_COLLAPSE_LINES",
    ) &&
    chat.includes("val capped = !msgExpanded && !typing && longBody") &&
    chat.includes("if (longBody && !typing && selectedIds.isEmpty()) {") &&
    chat.includes('"See less"') &&
    chat.includes('"See more"') &&
    (chat.match(/maxLines = if \(capped\) BODY_COLLAPSE_LINES else Int\.MAX_VALUE,/g) || [])
      .length === 4,
);

/* 12 — new#6: the update animation */
check(
  "v166 new#6: the in-app update popup is the owner's maintenance-crew scene (KpUpdateScene), recoloured to the app — two gears ±360° at 3.2 s / 2.1 s on cubic-bezier(.45,0,.55,1), a 2.4 s glow, the 900 ms keyframed hammer (0 → −32° → +10° → −3° → 0), sparks every 880 ms, the 1.1 s status cycle, a real-progress bar in the ActionBlue family with a shimmer and a walking figure that becomes a green check with a ring burst",
  scene.includes("enum class KpUpdatePhase { AVAILABLE, DOWNLOADING, DONE }") &&
    scene.includes("tween(3_200, easing = GearEase)") &&
    scene.includes("tween(2_100, easing = GearEase)") &&
    scene.includes("tween(2_400, easing = GearEase)") &&
    scene.includes("CubicBezierEasing(0.45f, 0f, 0.55f, 1f)") &&
    scene.includes("-32f at 288") &&
    scene.includes("10f at 432") &&
    scene.includes("-3f at 558") &&
    scene.includes("nextSpawn = now + 880") &&
    scene.includes('"Fixing bugs…",') &&
    scene.includes('"Finishing touches…",') &&
    scene.includes("delay(1_100)") &&
    scene.includes("val accent = ActionBlue") &&
    scene.includes("listOf(accent, ActionBlueDeep, accent)") &&
    scene.includes("val track = Line") &&
    scene.includes("private val KpUpdateGreen = Color(0xFF35C471)") &&
    scene.includes("scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy))") &&
    app.includes("KpUpdateScene(KpUpdatePhase.AVAILABLE, 0f") &&
    app.includes("KpUpdateScene(KpUpdatePhase.DOWNLOADING, KpUpdate.progress") &&
    app.includes("KpUpdateScene(KpUpdatePhase.DONE, 1f"),
);

/* 13 — v167: the player's ⋮ took the rotate button's seat */
check(
  "v167 item 1: the rotate button and its landscape machinery are out of the player, and the ⋮ sits in that exact seat (one dots on the whole screen, in the top bar beside the title) with Save / Forward / Delete — Save fetches a clip that is not on this phone yet instead of hiding its own row",
  !viewer.includes("Icons.Filled.ScreenRotation") &&
    !viewer.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE") &&
    !viewer.includes("fun setLandscape(") &&
    viewer.includes("IconButton(onClick = { haptics.tap(); menuOpen = true })") &&
    viewer.includes(
      'Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))',
    ) &&
    (viewer.match(/Icons\.Filled\.MoreVert, "More"/g) || []).length === 2 &&
    viewer.includes("if (m != null && !privateClip && !saved) {") &&
    viewer.includes("if (dest.exists() && dest.length() > 0L) {") &&
    viewer.includes('KpSheetRow(Icons.Filled.Close, "Dismiss") { onDismiss() }'),
);

/* 14 — v167's pair: corners in v168, plain + centred in v169 */
check(
  'v167 item 2 (moved by v169 — owner: "middle a thakbe pasha pashi, eto boro background border keno"): undo / redo are plain 32 dp IconButtons side by side in the top bar CENTRE, dimmed when idle; the floating pair and the corner seats are both gone',
  edit.includes(
    "fun StageHistory(can: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit)",
  ) &&
    !edit.includes("horizontalArrangement = Arrangement.spacedBy(46.dp),") &&
    !edit.includes(".padding(top = 50.dp),") &&
    edit.includes("IconButton(onClick = { haptics.tap(); undoEdit() }, enabled = canUndo") &&
    edit.includes("IconButton(onClick = { haptics.tap(); redoEdit() }, enabled = canRedo") &&
    edit.indexOf("undoEdit()") < edit.indexOf("redoEdit()") &&
    edit.includes("val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()") &&
    edit.includes("val canRedo = redoStack.isNotEmpty()"),
);

/* 15 — v167: the send animation is a jump (no engine left) */
check(
  "v167 item 3: no fly — the clone, its launch hints, the hide/landing state and the engine itself are gone from the chat (a send is in its place at once, every type the same), while the media's own ratio still rides the sending bubble",
  !chat.includes("KpFlySend(") &&
    !chat.includes("KpFlyLandFlash(") &&
    !chat.includes("private object KpFlyTarget") &&
    !chat.includes("private class FlySpec(") &&
    !chat.includes("fun launchFly(") &&
    !chat.includes("flyHidden") &&
    !chat.includes("flyLanded") &&
    !chat.includes("sendFromRect") &&
    !chat.includes("onFieldRect") &&
    !chat.includes("onActionRect") &&
    !attach.includes("onSendRect") &&
    chat.includes(
      'pending.find { it.optString("clientId") == clientId }?.put("mediaW", shotW)?.put("mediaH", shotH)',
    ),
);

/* 16 — v167: the unread row's time is blue too */
check(
  "v167 item 4: the chat list's unread time is the app's blue — the warm GoldDeep the owner kept pointing at is gone from that row (the unread state still reads through the bold name, the tick and the badge)",
  !list.includes("if (unread > 0) GoldDeep") &&
    list.includes("color = if (KpThemeMode.darkBlue) Muted else Color(0xFF5B7FC7)") &&
    !list.includes("Color(0xFFD7E1F7)"),
);

/* 17 — v167: the live AI reply */
check(
  "v167 item 5: the AI answer is LIVE — Gemini's streamGenerateContent feeds a throttled (140 ms) `ai_delta` frame into the chat's room with the text SO FAR, the streaming brain keeps the hedge (800 ms since v168) and the same 900-token legs, and the app renders the growing text in the reply's own bubble (caret at the end, cleared and never re-typed when the finished row lands)",
  src.includes(":streamGenerateContent?alt=sse") &&
    src.includes("async function geminiStream(") &&
    src.includes("async function hedgeStream(") &&
    src.includes("async function aiBrainStream(") &&
    src.includes("const AI_DELTA_MS = 140;") &&
    src.includes('{ type: "ai_delta", conversationId: convId, text }') &&
    src.includes(
      'answer = await aiBrainStream(env, [{ role: "user", content: fullPrompt }], 900, push);',
    ) &&
    src.includes("900,\n        push,\n      );") &&
    chat.includes('"ai_delta" ->') &&
    chat.includes('aiLiveBody = ev.optString("text")') &&
    chat.includes("if (aiTyping && aiLiveBody.isNotBlank()) {") &&
    chat.includes('.put("id", "ai_live")') &&
    // v168: the live bubble reads the word-by-word chaser, not the whole body.
    chat.includes("revealChars = liveReveal.coerceAtMost(aiLiveBody.length),") &&
    chat.includes(
      'val paintedLive = aiLiveBody.isNotBlank() && aiLiveBody.trim() == last.optText("body").trim()',
    ) &&
    chat.includes("if (paintedLive || mid == aiRevealId) return@LaunchedEffect") &&
    chat.includes('LaunchedEffect(aiTyping) { if (aiTyping) aiLiveBody = "" }'),
);

console.log(lines.join("\n"));
console.log(
  `v166-v167 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
