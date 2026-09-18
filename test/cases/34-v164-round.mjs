// v164 — the owner's round after testing v163. Three things, and the "why" of
// each matters more than the pixels:
//
// 1. "sending er somoy thumbnail fake dekhai keno? sending er somoy ratio
//    thumbnail original rakho." While a clip/photo is going out, its bubble is
//    the ONLY picture of it — and it was not the file's own. A send in flight
//    has no fileKey yet, so videoCacheFile() answered the same path for EVERY
//    in-flight clip ("…/kp-video-cache/v"): the second clip's bubble read the
//    FIRST clip's frame + ratio out of that shared slot and skipped decoding its
//    own file (the `if (value != null)` guard), i.e. a thumbnail of a different
//    video for the whole upload. A photo sent as a file had no url at all until
//    the upload finished (no fileKey, no mediaUrl — only the local docPath), so
//    it painted the blank placeholder while its own bytes sat on the phone.
//    The frame slot now follows the file the bubble draws, the image fast-path
//    falls back to the local copy, and the poster's own pixels answer the ratio.
// 2. the editor's tools collapse behind the pencil (rotate / crop / sticker /
//    text unfold on tap) — the bar used to carry all five at once.
// 3. the top bar's clip length is gone: Done sits there, it only APPLIES what
//    the user made (bake the layers into the working file, then forget them) —
//    no send, no gallery write, the editor stays open — and it is not there at
//    all when there is no edit to apply. A profile photo opens this same editor
//    and hands its baked file back for the avatar upload.
//
// There is no Android SDK in this sandbox, so the Android half is pinned as
// source shape (CI's assembleRelease is the compile) — same convention as 32/33.

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
const cache = kt("Cache.kt");
const edit = kt("MediaEditScreen.kt");
const profile = kt("ProfileScreen.kt");
const store = kt("ScreenStore.kt");

{
  /* 1 — the thumbnail while sending */
  check(
    'v164: a clip that is still going out draws ITS OWN frame — the frame slot follows the file the bubble is drawing (source), not the not-yet-existing fileKey (every in-flight clip used to share the same "…/kp-video-cache/v" slot, so the previous clip\'s frame and ratio were shown and the own-file decode was skipped)',
    chat.includes("val cacheKey = source.absolutePath") &&
      chat.includes(
        'val seedMeta = remember(m.optString("id"), cacheKey) { VideoThumbs.readMeta(cacheKey) }',
      ) &&
      !chat.includes('val cacheKey = remember(m.optString("id")) { dest.absolutePath }') &&
      (chat.match(/VideoThumbs\.get\(cacheKey\) \?\: VideoThumbs\.readThumb\(cacheKey\)/g) || [])
        .length === 2,
  );
  check(
    "v164: the frame + meta of the send-in-flight copy (which is unique per send) move to the cache entry the SENT message reads, so the bubble keeps the clip's own picture across the echo → server-row swap instead of flashing the placeholder again",
    chat.includes("fun adopt(from: String, to: String) {") &&
      chat.includes("lru[from]?.let { lru[to] = it }") &&
      chat.includes(
        "metaFile(from).takeIf { it.exists() }?.copyTo(metaFile(to), overwrite = true)",
      ) &&
      chat.includes(
        "thumbFile(from).takeIf { it.exists() }?.copyTo(thumbFile(to), overwrite = true)",
      ) &&
      cache.includes("VideoThumbs.adopt(src.absolutePath, dst.absolutePath)"),
  );
  check(
    "v164: a photo sent as a file draws its local copy while it is going out — the old branch handed the bubble an empty url (no fileKey yet, no mediaUrl — only docPath) and it painted the blank placeholder instead of the photo on this phone; the ✕ stays live too",
    chat.includes(
      'val local = m.optString("docPath").takeIf { it.isNotBlank() }?.let { File(it) }?.takeIf { it.exists() }',
    ) &&
      chat.includes('local != null -> "file://${local.absolutePath}"') &&
      chat.includes(
        '.put("mediaW", m.optInt("mediaW"))\n                .put("mediaH", m.optInt("mediaH")),',
      ) &&
      chat.includes("isPending = pendingEcho,\n            onCancelSend = onCancelSend,") &&
      !chat.includes(
        'val url = if (fileKey.isNotBlank()) "/api/files/$fileKey" else m.optString("mediaUrl")',
      ),
  );
  check(
    "v164: the poster IS the clip's own first frame, so its own pixels answer the bubble's ratio — a message without w/h can no longer leave the far bubble on the hardcoded 16:9 box until the whole clip downloads",
    chat.includes("if (it.width > 0 && it.height > 0) {") &&
      chat.includes("ratio = MediaBox.clamp(it.width.toFloat() / it.height.toFloat())") &&
      chat.includes(
        "if (value != null || posterKey.isBlank() || source.exists()) return@produceState",
      ),
  );
}

{
  /* 2 — the tools fold behind the pencil */
  check(
    "v164: the editor's rotate / crop / sticker / text stay folded away behind the pencil — the pencil unfolds them (and arms the pen, which is its own tool) and folds them back; a crop that is open keeps the row out so crop can still be toggled off",
    edit.includes("if (penMode || cropping) {") &&
      edit.includes("ToolButton(onClick = { rotateTap() }) {") &&
      edit.includes(
        "ToolButton(active = cropping, onClick = { if (cropping) exitCrop() else enterCrop() }) {",
      ) &&
      edit.includes('Icon(Icons.Filled.EmojiEmotions, "Stickers", tint = Color.White') &&
      edit.includes(
        'Text("Aa", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)',
      ) &&
      edit.includes(
        "ToolButton(active = penMode, onClick = {\n                    exitCrop()\n                    penMode = !penMode\n                }) {",
      ) &&
      edit.indexOf("if (penMode || cropping) {") < edit.indexOf("ToolButton(active = penMode"),
  );
}

{
  /* 3 — Done applies, and the profile photo shares the editor */
  check(
    'v164: the clip length is out of the top bar and Done is in its place — the button exists ONLY while there is an edit to apply (same idea as the bakes\' own "edited" test; v166: while the bake runs it stays and counts)',
    !edit.includes("editClipLabel") &&
      edit.includes("val hasEdits =") &&
      edit.includes("strokes.isNotEmpty() || texts.isNotEmpty() || stickers.isNotEmpty() ||") &&
      edit.includes("rotation != 0 || filterIdx != 0 || cropBox != null || hd ||") &&
      edit.includes("(clip != null && (start > 0L || end < clip.durationMs))") &&
      edit.includes("if (hasEdits || busy) {") &&
      // v165 (owner: "done button er size kom koro ar background border
      // intensity gray almost transparent rakho") — same button, smaller and
      // grey; the chip's own round pins the new literals in case 35.
      // v166 (fb#2): the same chip carries the bake's number while a clip is
      // being written — "Applying 42%" replaces "Done", dimmed while busy.
      edit.includes("val pct = applyPct") &&
      edit.includes('if (busy && pct >= 0f) "Applying ${(pct * 100).toInt()}%" else "Done",') &&
      edit.includes("color = Color.White.copy(alpha = if (busy) 0.7f else 0.94f),") &&
      edit.includes("fontSize = 11.5.sp,") &&
      edit.includes("haptics.tap()\n                                applyEdits()"),
  );
  check(
    "v164: Done APPLIES the edit — it bakes the layers (photo: bakeFull at the picture's own size; clip: the export with overlay / filter / turns / box) into a NEW working file, makes it mediaUri, and clears the layers with the undo history so nothing can be baked twice. It never sends, never writes to the gallery and never leaves the screen",
    edit.includes("fun applyEdits() {") &&
      edit.includes("if (cropping) exitCrop()") &&
      edit.includes(
        'val file = java.io.File(ctx.cacheDir, "applied_${System.currentTimeMillis()}.mp4")',
      ) &&
      edit.includes(
        'val f = java.io.File(ctx.cacheDir, "applied_${System.currentTimeMillis()}.jpg")',
      ) &&
      edit.includes("mediaUri = out") &&
      edit.includes(
        "strokes.clear()\n                    texts.clear()\n                    stickers.clear()",
      ) &&
      edit.includes("overlayPast.clear()") &&
      edit.includes("cropBox = null\n                    cropDraft = CropBox.FULL") &&
      edit.includes("hd = false") &&
      // the apply path itself knows nothing about sending / saving / leaving
      // (comments stripped — the prose is allowed to name what it must not do)
      !edit
        .slice(edit.indexOf("fun applyEdits() {"), edit.indexOf("fun useAsAvatar() {"))
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .match(/pendingEdited|FilesUtil\.save|Toast|popBackStack|ScreenStore\.pendingAvatarUri/),
  );
  check(
    "v164: everything the stage loads is keyed on the working media, and an APPLIED clip's window is the whole baked file (restoring the old trim selection on top of it would cut it a second time)",
    edit.includes("var mediaUri by remember(pickedUri, bits) {") &&
      edit.includes(
        "mutableStateOf(bits?.workUri?.let { android.net.Uri.parse(it) } ?: pickedUri)",
      ) &&
      edit.includes("LaunchedEffect(mediaUri) {") &&
      edit.includes("val applied = mediaUri.toString() != pickedUri.toString()") &&
      edit.includes(
        "if (applied) {\n                start = 0L\n                end = src.durationMs",
      ) &&
      edit.includes(
        "workUri = mediaUri.takeIf { it.toString() != pickedUri.toString() }?.toString(),",
      ),
  );
  check(
    "v164: a batch send hands back the file an item was APPLIED into (the pool's snapshot carries workUri), not its raw pick",
    edit.includes("val workUri: String? = null,") &&
      edit.includes("works = works,") &&
      edit.includes("works: Map<String, EditBits> = emptyMap(),") &&
      edit.includes(
        "val applied = works[t.uri.toString()]?.workUri?.let { android.net.Uri.parse(it) }",
      ) &&
      edit.includes(
        "EditedResult(convId, t.once, EditedMedia.Untouched(applied ?: t.uri, t.isVideo), t.caption)",
      ),
  );
  check(
    'v164: a picked profile photo opens this same editor (route convId "avatar") — no caption, no ① view-once, the chip says Profile photo and the circle means "use this photo": the bake rides back on ScreenStore.pendingAvatarUri and ProfileScreen uploads it (the pick used to be PATCHed straight from the picker)',
    profile.includes('"mediaedit/avatar/0/" +') &&
      profile.includes('statusPickArg(MediaItem(uri, false, 0, "", System.currentTimeMillis()))') &&
      profile.includes("ScreenStore.pendingAvatarUri.collect { picked ->") &&
      profile.includes("uploadAvatar(android.net.Uri.parse(picked))") &&
      !profile.includes("onPick = { galleryOpen = false; uploadAvatar(it) }") &&
      store.includes(
        "val pendingAvatarUri = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)",
      ) &&
      edit.includes('val avatarMode = convId == "avatar"') &&
      edit.includes("if (!statusMode && !avatarMode) {") &&
      edit.includes(
        'if (avatarMode) "Profile photo" else ScreenStore.editTitle.ifBlank { "Chat" }',
      ) &&
      edit.includes("fun useAsAvatar() {") &&
      edit.includes("ScreenStore.pendingAvatarUri.value = out.toString()") &&
      edit.includes(
        "if (statusMode || avatarMode) Icons.Filled.Check else Icons.AutoMirrored.Filled.Send",
      ),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
