// v165 — the owner's round after testing v164. Nine items, and the "why" of
// each is the part that has to survive:
//
// 1. the profile-photo editor is not a post editor: no HD toggle (the upload
//    is re-encoded anyway) and no Save button (Done is the only exit).
// 2. Done is smaller and near-transparent grey — it is a chrome chip, not the
//    blue primary action.
// 3. undo + redo in EVERY editor, compact: strokes first, then the overlay
//    history, redo replays exactly what undo took (and any new edit clears it).
// 4. a view-once tile keeps the media's ORIGINAL ratio (payload w/h while the
//    send is in flight, the clip's own frame once it lands), at a smaller size
//    — and it never ships a fetchable poster frame (that is what view-once
//    promises).
// 5. the media's own ratio is kept while it is being sent. v166 kept it on the
//    flying clone; v167 deleted the clone (the owner: "kono fly effect thakbe
//    na"), so the contract that matters is the bubble's own — the sending
//    thumbnail + body ride the payload's measured w/h.
// 6. the chat-list clock is 12-hour Bangladesh time, and the list's own stamp
//    colour is readable on the default theme.
// 7. a received clip's ⋮ (Save / Forward, exactly like a photo) can no longer
//    hide: it sits outside the auto-hiding chrome and survives the saved tick.
// 8. KP AI: Gemini is the brain for messaging and voice messages (text, a
//    photo to be READ, a voice note to be heard); Hugging Face stays the
//    picture CREATE / EDIT engine; both keep honest fallbacks.
// 9. double-tap zoom (photo viewer AND the clip player) walks to the target
//    with a spring instead of teleporting.
//
// There is no Android SDK in this sandbox, so the Android half is pinned as
// source shape (CI's assembleRelease is the compile) — same convention as 32/34.

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
const edit = kt("MediaEditScreen.kt");
const viewer = kt("MediaViewer.kt");
const theme = kt("Theme.kt");
const list = kt("ChatListScreen.kt");
const cache = kt("Cache.kt");
const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
const pkg = readFileSync(
  new URL("../../native-android/app/build.gradle.kts", import.meta.url),
  "utf8",
);

/* 1+2 — the profile-photo editor and the Done chip */
check(
  "v165: the profile-photo editor has no HD pill and no Save button (avatar mode), and Done is the smaller near-transparent grey chip (v166: same chip, now the bake's own progress line) — the stage scrim stays the only strong surface",
  edit.includes("if (clip == null && !statusMode && !avatarMode) {") &&
    edit.includes("if (!avatarMode) {") &&
    edit.includes(".background(Color(0x2EFFFFFF))") &&
    edit.includes("Color(0x4DFFFFFF)") &&
    // v166 (fb#2): the same chip carries the bake's number while a clip is
    // being written — "Applying 42%" replaces "Done", dimmed while busy.
    edit.includes("val pct = applyPct") &&
    edit.includes('if (busy && pct >= 0f) "Applying ${(pct * 100).toInt()}%" else "Done",') &&
    edit.includes("color = Color.White.copy(alpha = if (busy) 0.7f else 0.94f),") &&
    edit.includes("fontSize = 11.5.sp,") &&
    !edit.includes(
      'Text("Done", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)',
    ) &&
    // the HD toggle still exists for real posts — the gate is what changed
    edit.includes("hd = !hd") &&
    // and the gallery write stays for Send (nothing is written for an avatar)
    edit.includes("if (!avatarMode) {"),
);

/* 3 — undo / redo in every editor, compact */
check(
  "v165: undo + redo are in every editor — one 26 dp trio (undo / redo / clear) replaces the two 36 dp buttons, strokes pop before the overlay history, redo replays what undo took and any fresh edit clears the redo lane",
  edit.includes("val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()") &&
    edit.includes("val canRedo = redoStack.isNotEmpty()") &&
    // v166 (owner: "undo redo option pelam e na … left a undo right a redo"):
    // the trio is part of the chrome — drawn whenever there is media on the
    // stage, each control dimmed while it has nothing to act on.
    edit.includes("if (shot != null || clip != null) {") &&
    edit.includes("haptics.tap(); undoEdit()") &&
    edit.includes("haptics.tap(); redoEdit()") &&
    // v168: the CompactTool seat left with the fold — undo / redo / clear are
    // 40 dp StageHistory seats (top-bar corners + the right rail). The 26 dp
    // size stays on the attach checkbox and the pen-width chips.
    !edit.includes("fun CompactTool(") &&
    (edit.match(/\.size\(26\.dp\)/g) || []).length === 2 &&
    (edit.match(/\.size\(36\.dp\)/g) || []).length === 1 &&
    edit.includes("Icons.AutoMirrored.Filled.Undo") &&
    edit.includes("Icons.AutoMirrored.Filled.Redo") &&
    // strokes are the top of the stack; the overlay history is what is left
    edit.includes("val st = strokes.removeAt(strokes.size - 1)") &&
    edit.includes("redoStack.add { strokes.add(st) }") &&
    edit.includes("undoOverlay()\n    }") &&
    // a new edit invalidates the redo lane (both ways of adding one)
    (edit.match(/redoStack\.clear\(\)/g) || []).length >= 2,
);

/* 4 — the view-once tile: own ratio, smaller, and no poster */
check(
  "v165: the view-once tile is smaller and rides the media's OWN ratio (payload w/h while the send is in flight, the clip's own frame after), and a view-once clip never ships a fetchable poster frame",
  chat.includes("else -> MediaBox.payloadRatio(m).takeIf { it > 0f } ?: 0f") &&
    chat.includes("val boxRatio =") &&
    chat.includes(".widthIn(max = 168.dp)") &&
    chat.includes(".heightIn(max = 220.dp)") &&
    chat.includes(".aspectRatio(boxRatio)") &&
    chat.includes(".widthIn(min = 132.dp)") &&
    !chat.includes("heightIn(max = 220.dp).fillMaxWidth()") &&
    cache.includes('val once = meta.optBoolean("viewOnce") == true') &&
    cache.includes("if (clip && !once) {") &&
    cache.includes('(meta.optString("thumbKey").isNotBlank() || once)'),
);

/* 5 — the media keeps its real ratio while it is going out (v167: no clone) */
check(
  "v165 + v167: the media's own ratio is kept while it is being sent — v167 removed the flying clone entirely, so the ratio now lives only where the owner asked to see it: the bubble itself (the sending thumbnail + body ride the payload's w/h, photo and clip alike). The clone, its flight box and every launch hint for it are gone.",
  !chat.includes("KpFlySend(") &&
    !chat.includes("fun launchFly(") &&
    !chat.includes("fun armFly()") &&
    !chat.includes("flyHidden") &&
    // the clip's box, measured at the send and handed to the pending row
    chat.includes(
      'if (facts.first > 0 && facts.second > 0) clipMeta.put("w", facts.first).put("h", facts.second)',
    ) &&
    chat.includes(
      '.also { if (facts.first > 0 && facts.second > 0) it.put("mediaW", facts.first).put("mediaH", facts.second) }',
    ) &&
    // the photo's box, measured on pick and stamped on the echo row
    chat.includes('.also { row -> if (w > 0 && h > 0) row.put("mediaW", w).put("mediaH", h) }') &&
    chat.includes(
      'pending.find { it.optString("clientId") == clientId }?.put("mediaW", shotW)?.put("mediaH", shotH)',
    ) &&
    chat.includes('val w = m.optInt("mediaW")'),
);

/* 6 — 12-hour Bangladesh time in the chat list, and its ink */
check(
  "v165: the chat-list clock is 12-hour Bangladesh time (the only 24-hour stamp left in the app — every other surface was already 12h) and the row stamp stays readable on the default theme",
  theme.includes('"%d:%02d %s"') &&
    theme.includes('if (z.hour >= 12) "PM" else "AM"') &&
    !theme.includes('String.format("%02d:%02d", z.hour, z.minute)') &&
    theme.includes("fun listStamp(") &&
    theme.includes("fun atDhaka(") &&
    list.includes("val stamp = listStamp(") &&
    list.includes("color = if (KpThemeMode.darkBlue) Muted else Color(0xFF5B7FC7)") &&
    // v169: the stamp left the bubble - it rides under it on the wallpaper,
    // so the mode-aware stampInk (blue on the blue chat) is the only ink.
    chat.includes("val stampInk = when {") &&
    chat.includes("if (KpThemeMode.darkBlue) Color(0xFFA9C4F2) else Color(0xFF5B7FC7)"),
);

/* 7 — the clip player's ⋮ */
check(
  "v165: a received clip keeps its ⋮ (the sheet it opens never gives its place to the saving spinner or the saved tick) and Save is offered whenever the clip can be put on this phone",
  // v166: the sheet is unconditional — Delete lives in it for every clip,
  // private ones included; Save / Forward stay gated in that sheet.
  // v167 (owner: "video 3 dot ta upore rotate button ta remove kore okhane
  // thakbe"): the owner could not reach that ⋮ — it was a floating twin over
  // the clip while the rotate button held the top bar. The dots TOOK rotate's
  // seat; Save / Forward / Delete are all in its sheet, and Save now fetches a
  // clip that is not on the phone yet instead of hiding its own row.
  viewer.includes(
    'Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))',
  ) &&
    viewer.includes("if (dest.exists() && dest.length() > 0L) {") &&
    viewer.includes("onSave =") &&
    // r71-18: a clip the sender withheld saving for keeps its ⋮ and loses
    // only the Save row.
    // r71-17: the owner's own rule sits in front of it.
    viewer.includes("(KpSecure.amOwner() || (!privateClip && !noSaveClip))") &&
    !viewer.includes(
      "} else if (m != null && !privateClip) {\n                    IconButton(onClick = { menuOpen = true })",
    ) &&
    viewer.includes('Icon(Icons.Filled.MoreVert, "More", tint = Color.White') &&
    viewer.includes("MediaMenuSheet(") &&
    viewer.includes("canForward"),
);

/* 8 — KP AI routing */
check(
  "v165: KP AI — Gemini is the brain (chat text, the welcome line, a photo the user sends to be READ, a voice note to be HEARD) and Hugging Face keeps the picture CREATE / EDIT path; Whisper, the HF chain and Workers AI stay behind Gemini as honest fallbacks",
  src.includes("async function geminiParts(") &&
    src.includes('inline_data: { mime_type: m.mime || "application/octet-stream", data: m.b64 }') &&
    src.includes(
      "generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    ) &&
    // v166 (owner: "ai reply dite onek late korche"): Gemini still LEADS the
    // text / photo / voice turns, but it is raced against the HF chain — the
    // fallback starts mid-hedge instead of after Gemini's whole timeout.
    // v168: that hedge is 800 ms now (was 1.6 s).
    src.includes("const AI_HEDGE_MS = 800;") &&
    src.includes(
      "() => geminiChat(env, messages, maxTokens),\n    () => hfThenCf(env, messages, maxTokens),",
    ) &&
    src.includes("async function aiTranscribe(") &&
    src.includes("const heard = await aiTranscribe(") &&
    src.includes("const fb = await hfTranscribe(env, bytes, mime);") &&
    src.includes("async function aiWelcomeText(") &&
    src.includes("const gem = await geminiParts(env, prompt, [], 120);") &&
    src.includes("const seen = readPhoto;") &&
    src.includes(
      "seen && seen.media ? await aiPhotoBytes(env, seen.media, photoMime(seen as never)) : null;",
    ) &&
    src.includes("const drawn = await hfImage(env, parts, scene, clean);") &&
    src.includes('const HF_IMAGE_MODEL = "stabilityai/stable-diffusion-3-medium-diffusers";') &&
    src.includes(
      "answer ?? (!env.GEMINI_API_KEY && !env.HF_TOKEN ? AI_REPLY_FALLBACK : AI_REPLY_DOWN);",
    ),
);

/* 9 — smooth double-tap zoom */
check(
  "v165: double-tap zoom animates — the photo viewer and the clip player both spring to 2.5x (and back) instead of teleporting, a second double-tap takes the running animation over, and pinch keeps writing the same state",
  viewer.includes("var zoomJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }") &&
    viewer.includes("var vZoomJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }") &&
    (viewer.match(/animationSpec = spring\(/g) || []).length >= 2 &&
    // both springs land on the same feel — the photo's is written across lines,
    // the clip's on one, so the pin is the shared damping ratio itself.
    (viewer.match(/dampingRatio = 0\.86f/g) || []).length === 2 &&
    viewer.includes("val target = if (scale > 1f) 1f else 2.5f") &&
    viewer.includes("val target = if (vScale > 1f) 1f else 2.5f") &&
    viewer.includes("zoomJob?.cancel()") &&
    viewer.includes("vZoomJob?.cancel()") &&
    viewer.includes("import androidx.compose.animation.core.Spring") &&
    viewer.includes("scaleX = vScale") &&
    viewer.includes("translationY = vOffY") &&
    // the old instant snap is gone
    !viewer.includes(
      "                                    scale = 2.5f\n                                    val maxX",
    ),
);

/* the round's own bookkeeping */
// The version bump itself is pinned by the newest round's own case (36); this
// one keeps the dependency the round added.
check(
  "v165: material-icons-extended is present (undo / redo glyphs)",
  pkg.includes("material-icons-extended"),
);

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
