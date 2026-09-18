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
// 5. the send clone ("fly") rides the media's original ratio too — KpFlySend
//    fits the artwork inside the flight box instead of stretching 16:9.
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
    edit.includes(
      "fun CompactTool(onClick: () -> Unit, enabled: Boolean = true, glyph: @Composable () -> Unit)",
    ) &&
    (edit.match(/\.size\(26\.dp\)/g) || []).length === 3 &&
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

/* 5 — the send clone keeps the media's ratio */
check(
  "v165: the flying send clone keeps the media's original ratio — KpFlySend fits the artwork inside the flight box (photo: its bitmap; clip: the retriever's metadata) instead of stretching to the box",
  chat.includes("var mediaRatio by remember(spec.key)") &&
    chat.includes("if (w / h > mr) w = (h * mr) else h = (w / mr)") &&
    chat.includes("mediaRatio = shot.width.toFloat() / shot.height") &&
    chat.includes("MediaMetadataRetriever()") &&
    chat.includes("fun armFly()") &&
    chat.includes(
      "sendFromRect = listOf(actionRect, fieldRect).firstOrNull { !it.isEmpty } ?: Rect.Zero",
    ) &&
    // the view-once door arms the flight too (that was the missing animation)
    (chat.match(/armFly\(\)\n/g) || []).length >= 2,
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
    list.includes(
      "color = if (unread > 0) GoldDeep else if (KpThemeMode.darkBlue) Muted else Color(0xFF5B7FC7),",
    ) &&
    // and MY bubble stamp follows the FILL it sits on: the cream-white on the
    // dark blue bubble that he pointed at is a cool blue-grey now, and the gold
    // bubble takes the muted ink (the other bubbles keep the old white).
    chat.includes('"darkblue" -> Color(0xFFBBD3FF)') &&
    chat.includes('"default" -> Muted') &&
    chat.includes("else -> Color(0xD9FFFFFF)"),
);

/* 7 — the clip player's ⋮ */
check(
  "v165: a received clip keeps its ⋮ for the whole session — the Save / Forward seat is drawn outside the auto-hiding chrome (over the clip, under the top bar) and no longer gives its place to the saving spinner or the saved tick; Save is offered whenever the clip is on this phone",
  // v166: the seat is unconditional — Delete lives in the sheet for every
  // clip, private ones included; Save / Forward stay gated in that sheet.
  viewer.includes("if (m != null) {\n            Box(") &&
    viewer.includes(".clickable { menuOpen = true }") &&
    viewer.includes("onSave =") &&
    viewer.includes("dest.exists() && dest.length() > 0L && !privateClip && !saved") &&
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
    // fallback starts 1.6 s in instead of after Gemini's whole timeout.
    src.includes("const AI_HEDGE_MS = 1_600;") &&
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
