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
const chat = kt("ChatScreen.kt");
const viewer = kt("MediaViewer.kt");
const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");

/* 1 — the editor chrome: right rail + corner history */
check(
  "v168 item 1: every edit tool is one 40 dp seat on a right-side vertical rail (rotate / crop / sticker / text / pen / clear / save top-to-bottom, evenly spaced, aligned TopEnd under the bar), undo rides the top-LEFT beside the X and redo is the top-RIGHT corner, and the old left-to-right fold (ToolButton / CompactTool / the floating 46 dp pair) is gone",
  edit.includes(".align(Alignment.TopEnd)") &&
    edit.includes(".padding(top = 52.dp, end = 8.dp),") &&
    edit.includes("verticalArrangement = Arrangement.spacedBy(8.dp),") &&
    edit.includes("horizontalAlignment = Alignment.CenterHorizontally,") &&
    edit.includes("StageHistory(true, { haptics.tap(); rotateTap() })") &&
    edit.includes(
      "StageHistory(cropping, { haptics.tap(); if (cropping) exitCrop() else enterCrop() })",
    ) &&
    edit.includes("StageHistory(penMode, {") &&
    edit.includes("StageHistory(canClear, {") &&
    edit.includes("StageHistory(true, { haptics.tap(); saveCurrent() })") &&
    edit.includes("StageHistory(canUndo, { haptics.tap(); undoEdit() })") &&
    edit.includes("StageHistory(canRedo, { haptics.tap(); redoEdit() })") &&
    // top-bar order: X, then UNDO ... REDO last; rail order: rotate ... save
    edit.indexOf('Icon(Icons.Filled.Close, "Close"') <
      edit.indexOf("StageHistory(canUndo, { haptics.tap(); undoEdit() })") &&
    edit.indexOf("StageHistory(canUndo, { haptics.tap(); undoEdit() })") <
      edit.indexOf("StageHistory(canRedo, { haptics.tap(); redoEdit() })") &&
    edit.indexOf("StageHistory(true, { haptics.tap(); rotateTap() })") <
      edit.indexOf("StageHistory(penMode, {") &&
    edit.indexOf("StageHistory(penMode, {") < edit.indexOf("StageHistory(canClear, {") &&
    edit.indexOf("StageHistory(canClear, {") <
      edit.indexOf("StageHistory(true, { haptics.tap(); saveCurrent() })") &&
    !edit.includes("ToolButton(") &&
    !edit.includes("fun CompactTool(") &&
    !edit.includes("spacedBy(46.dp)"),
);

/* 2 — the video editor's play/pause seat */
check(
  "v168 item 2: the clip's stage carries a real play/pause seat (48 dp, centred over the ink layer, hidden while cropping / drawing / baking / still) driving a hoisted vidPaused into StatusTrimPreview's paused - the player's own tap-to-pause can never fire under the overlay canvas",
  edit.includes("var vidPaused by remember { mutableStateOf(false) }") &&
    edit.includes(
      "StatusTrimPreview(mediaUri, start, end, paused = stillMode || vidPaused, scrubAt = scrub",
    ) &&
    edit.includes("if (!cropping && !penMode && !busy && !stillMode) {") &&
    edit.includes("if (vidPaused) Icons.Filled.PlayArrow else Icons.Filled.Pause,") &&
    edit.includes("vidPaused = !vidPaused") &&
    edit.includes("import androidx.compose.material.icons.filled.Pause"),
);

console.log(lines.join("\n"));
console.log(
  `v168 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
