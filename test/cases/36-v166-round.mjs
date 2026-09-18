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
//    starts first, the HF chain (2 models × 7 s, then Workers AI) starts 1.6 s
//    later and the first answer wins. Gemini is still the primary.
// 7. new#1 voice bubble / 8. new#2 link card: both are compact now.
// 9. new#3 send animation: the clone walks STRAIGHT to the bubble (520 ms) —
//    the arc is gone — and every type rides it with its REAL content/ratio.
// 10. new#4: the bubble stops 5 dp short of the right edge.
// 11. new#5: a long body folds at 10 lines, decided by a measure taken while
//     composing at the bubble's own width (so the fold is right on frame one).
// 12. new#6: the in-app update popup is the owner's own maintenance-crew demo,
//     ported to Compose (KpUpdateScene) and recoloured to the app palette.
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
const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const pkg = readFileSync(
  new URL("../../native-android/app/build.gradle.kts", import.meta.url),
  "utf8",
);

/* the round's own bookkeeping */
check(
  "v166: versionCode 166 / versionName 3.9.90",
  /versionCode\s*=\s*166/.test(pkg) && /versionName\s*=\s*"3\.9\.90"/.test(pkg),
);

/* 1 — fb#2: the clip bake can no longer look frozen or vanish */
check(
  'v166 fb#2: the clip bake reports itself — the Done chip carries the export\'s own progress ("Applying n%", dimmed while busy), the full-frame overlay is recycled in a finally, and a 0-byte / duration-less mp4 is deleted and thrown instead of becoming mediaUri',
  edit.includes("var applyPct by remember { mutableStateOf(-1f) }") &&
    edit.includes("if (busy) return") &&
    edit.includes("applyPct = if (pickedIsVideo) 0f else -1f") &&
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

/* 2 — fb#4: undo LEFT / redo RIGHT, always visible */
check(
  "v166 fb#4: the undo / redo / clear trio is always on the stage (left → right: undo, redo, clear) whenever there is media, dimmed instead of hidden, and the compact 26 dp tools are unchanged",
  edit.includes(
    "if (shot != null || clip != null) {\n                    CompactTool(onClick = { haptics.tap(); undoEdit() }, enabled = canUndo) {",
  ) &&
    edit.includes("tint = Color.White.copy(alpha = if (canUndo) 1f else 0.35f)") &&
    edit.includes("tint = Color.White.copy(alpha = if (canRedo) 1f else 0.35f)") &&
    edit.indexOf("CompactTool(onClick = { haptics.tap(); undoEdit() }") <
      edit.indexOf("CompactTool(onClick = { haptics.tap(); redoEdit() }") &&
    edit.includes("val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()") &&
    edit.includes("val canRedo = redoStack.isNotEmpty()") &&
    (edit.match(/\.size\(26\.dp\)/g) || []).length === 3,
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
    chat.includes(
      "ratio = if (facts.first > 0 && facts.second > 0) facts.first.toFloat() / facts.second else 0f,",
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
  chat.includes('"darkblue" -> Color(0xFFBBD3FF)') &&
    chat.includes("if (KpThemeMode.darkBlue) Color(0xFFA9C4F2) else Color(0xFF5B7FC7)") &&
    !chat.includes("Color(0xFFD7E1F7)") &&
    list.includes(
      "color = if (unread > 0) GoldDeep else if (KpThemeMode.darkBlue) Muted else Color(0xFF5B7FC7),",
    ),
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
    viewer.includes("if (m != null) {\n            Box(") &&
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
  "v166 fb#9: the brain is hedged — AI_HEDGE_MS 1 600, hedge() racing the primary against the gated secondary through Promise.any, hfThenCf capped at 2 HF models × 7 s then Workers AI, aiBrain = Gemini primary (or the HF chain alone without a key); the photo turn hedges Gemini against the HF vision leg and the voice turn against Whisper",
  src.includes("const AI_HEDGE_MS = 1_600;") &&
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
    src.includes(
      "answer = await hedge(\n          () => geminiParts(env, fullPrompt, [{ mime: src.mime, b64 }], 900, 20_000),\n          hfLeg,",
    ) &&
    src.includes("const heard = await hedge(") &&
    src.includes("if (hf) return hf;\n        return aiBrain("),
);

/* 7 — new#1: the voice bubble is smaller again */
check(
  "v166 new#1: the voice card shrank — a 32 dp play circle (19 dp glyphs, 16 dp spinner), a 6 dp gap, a 132 × 18 dp wave and the 10.5 sp time line, with the column's 7 dp top keeping the wave centred on the button",
  chat.includes(".size(32.dp)\n                    .pressScale(interaction)") &&
    chat.includes("modifier = Modifier.size(19.dp).scale(if (pressed) 0.85f else 1f),") &&
    chat.includes("modifier = Modifier.size(16.dp),") &&
    chat.includes("Spacer(Modifier.width(6.dp))") &&
    chat.includes("modifier = Modifier.width(132.dp).height(18.dp),") &&
    chat.includes("Column(Modifier.padding(top = 7.dp)) {") &&
    chat.includes("fontSize = 10.5.sp,") &&
    chat.includes("Spacer(Modifier.height(0.dp))"),
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
  "v166 new#3: the send clone walks STRAIGHT to its bubble for 520 ms (no arc), every type rides the same engine with its real content and its own ratio (launchFly takes the measured ratio; KpFlySend seeds mediaRatio from it)",
  chat.includes(
    'fun launchFly(\n        clientId: String,\n        cloneType: String,\n        body: String = "",\n        media: String = "",\n        ratio: Float = 0f,\n    ) {',
  ) &&
    chat.includes(
      'launchFly(clientId, "PHOTO", media = dataUrl, ratio = if (w > 0 && h > 0) w.toFloat() / h else 0f)',
    ) &&
    chat.includes("t.animateTo(1f, tween(520, easing = LinearEasing))") &&
    chat.includes("var mediaRatio by remember(spec.key) { mutableFloatStateOf(spec.ratio) }") &&
    chat.includes(
      '// v166 (owner: "eita change hoye direct nijer position a chole\n                // jabe kono fly na")',
    ) &&
    !chat.includes("(-56).dp.toPx()") &&
    // the declaration plus the four send paths that ride it: text, photo,
    // voice and the file/clip call
    (chat.match(/launchFly\(\s*clientId/g) || []).length === 5 &&
    chat.includes('launchFly(clientId, "TEXT", body)') &&
    chat.includes('launchFly(clientId, "VOICE")') &&
    chat.includes(
      'launchFly(\n            clientId,\n            if (mime.startsWith("video")) "VIDEO" else "DOC",',
    ),
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

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
