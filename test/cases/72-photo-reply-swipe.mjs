// Source-contract coverage for one consistent reply swipe across every message row.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const app = path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/");
const chat = fs.readFileSync(path.join(app, "ChatScreen.kt"), "utf8");
const policy = fs.readFileSync(path.join(app, "MessageReplySwipePolicy.kt"), "utf8");
const unit = fs.readFileSync(
  path.join(
    root,
    "native-android/app/src/test/java/app/kuchupuchu/android/MessageReplySwipePolicyTest.kt",
  ),
  "utf8",
);

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  return a >= 0 && b > a ? source.slice(a, b) : "";
}
const swipe = section(
  chat,
  "private fun Modifier.messageReplySwipe(",
  "/** Lift only the visual message content",
);
const focusSlot = section(
  chat,
  "private fun KpMessageFocusSlot(",
  "@OptIn(ExperimentalFoundationApi::class)",
);
const message = section(
  chat,
  "private fun MessageRow(",
  "/** True when a FILE message is really just a photo",
);
const video = section(chat, "private fun VideoMessageRow(", "private fun OnceTextRow(");
const onceText = section(chat, "private fun OnceTextRow(", "private fun VoiceOnceTile(");
const onceMedia = section(chat, "private fun ViewOnceRow(", "private fun sniffClipMime(");
const image = section(chat, "private fun ImageMessageRow(", "/** A photo row:");
const album = section(chat, "private fun AlbumMessageRow(", "/** One square of a grouped bubble");
const rows = [message, image, video, onceText, onceMedia, album];
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "every row shares the same 50.4dp release threshold; only the required direction changes (mine left, incoming right)",
  policy.includes("fun requiredDistance(baseThresholdPx: Float): Float = baseThresholdPx * 1.4f") &&
    policy.includes("if (mine) deltaX < 0f else deltaX > 0f") &&
    policy.includes("abs(deltaX) >= requiredDistance(baseThresholdPx)") &&
    unit.includes("requiredDistance(baseThresholdPx = 36f)") &&
    unit.includes("deltaX = 51f, deltaY = 4f, mine = false") &&
    unit.includes("deltaX = -51f, deltaY = 4f, mine = true"),
);
check(
  "media keeps a bubble-sized focus target but aligns the bounded outer slot to the sender side",
  focusSlot.includes("rowMine: Boolean? = null") &&
    focusSlot.includes("Modifier.wrapContentSize(unbounded = true)") &&
    focusSlot.includes("Modifier.fillMaxWidth()") &&
    focusSlot.includes(
      "horizontalArrangement = if (rowMine) Arrangement.End else Arrangement.Start",
    ) &&
    [
      'if (m.has("kpAlbum")) {\n        KpMessageFocusSlot(focusKey, rowMine = mine)',
      "if (isViewOnce(m)) {\n        KpMessageFocusSlot(focusKey, rowMine = mine)",
      'if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))) {\n        KpMessageFocusSlot(focusKey, rowMine = mine)',
      'if (kind == "FILE" && fileLooksVideo(m) && !sentAsDocument(m)) {\n        KpMessageFocusSlot(focusKey, rowMine = mine)',
    ].every((site) => message.includes(site)) &&
    image.includes("horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start") &&
    image.includes("Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start)"),
);
check(
  "text/sticker/voice/file/document rows use the shared recognizer on a stable parent while the visual bubble moves",
  message.includes("modifier = Modifier.messageReplySwipe(") &&
    message.includes("onOffset = { replyDrag = it }") &&
    message.includes(".offset { IntOffset(replyOffset.roundToInt(), 0) }") &&
    message.includes('"FILE" -> FileBubble(') &&
    message.includes('val noBubble = emojiOnly > 0 || kind == "STICKER"'),
);
check(
  "photo, album, video, view-once text, and view-once media all use the same recognizer and reply callback",
  [image, album].every((row) => row.includes("Modifier.messageReplySwipe(")) &&
    [video, onceText, onceMedia].every(
      (row) => row.includes("modifier = Modifier.messageReplySwipe(") && row.includes("onReply(m)"),
    ) &&
    image.includes("onReply(m)") &&
    album.includes("onReply(m)"),
);
check(
  "the recognizer waits for clear horizontal intent, consumes only that drag, and leaves vertical scroll and long-press available",
  swipe.includes("PointerEventPass.Initial") &&
    swipe.includes("MessageReplySwipePolicy.isHorizontalIntent") &&
    /if \(claimed\) \{\s*change\.consume\(\)/.test(swipe) &&
    swipe.includes("viewConfiguration.longPressTimeoutMillis") &&
    swipe.includes("offset.value(0f)"),
);
check(
  "both sent and received sides have a symmetric capped drag, with unit coverage for direction, threshold, and vertical intent",
  policy.includes("val limit = requiredDistance(baseThresholdPx) * 1.4f") &&
    policy.includes("deltaX.coerceIn(-limit, 0f)") &&
    policy.includes("deltaX.coerceIn(0f, limit)") &&
    unit.includes("same cap on both sides") &&
    unit.includes("dominant vertical movement does not reply"),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
