// Source-contract coverage for the Android tap-to-reveal message timestamp/tick behavior.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const app = path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/");
const chat = fs.readFileSync(path.join(app, "ChatScreen.kt"), "utf8");
const emoji = fs.readFileSync(path.join(app, "EmojiAnim.kt"), "utf8");
const policy = fs.readFileSync(path.join(app, "MessageStampPolicy.kt"), "utf8");

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  return a >= 0 && b > a ? source.slice(a, b) : "";
}
const messageRow = section(
  chat,
  "private fun MessageRow(",
  "/** True when a FILE message is really just a photo",
);
const videoRow = section(chat, "private fun VideoMessageRow(", "private fun OnceTextRow(");
const onceTextRow = section(chat, "private fun OnceTextRow(", "private fun VoiceOnceTile(");
const onceRow = section(chat, "private fun ViewOnceRow(", "internal fun sentAsDocument(");
const imageRow = section(chat, "private fun ImageMessageRow(", "private fun AlbumMessageRow(");
const albumRow = section(chat, "private fun AlbumMessageRow(", "private fun AlbumTile(");
const fileBubble = section(chat, "private fun FileBubble(", "private fun compactFileName(");
const voiceOnce = section(chat, "private fun VoiceOnceTile(", "private fun ViewOnceRow(");
const voiceWave = section(chat, "internal fun VoiceWave(", "private fun LiveVoiceWave(");
const tick = section(chat, "private fun TickIcon(", "private fun infoStamp(");
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "the newest row remains visible by default, while one explicitly tapped older row is revealed without mutating message JSON",
  policy.includes("isLatestVisible || (rowKey.isNotBlank() && rowKey == revealedKey)") &&
    chat.includes('var revealedStampKey by remember(convId) { mutableStateOf("") }') &&
    chat.includes("MessageStampPolicy.isVisible(") &&
    chat.includes('if (stampVisible) m else JSONObject(m.toString()).put("kpHideStamp", true)') &&
    chat.includes(
      'if (echoStampVisible) m else JSONObject(m.toString()).put("kpHideStamp", true)',
    ) &&
    (chat.match(/onRevealStamp = \{ revealedStampKey = rowKey \}/g) || []).length === 2,
);
check(
  "a regular message tap reveals its stamp while selection and expanded-message collapse remain wired",
  messageRow.includes("onRevealStamp: () -> Unit = {},") &&
    messageRow.includes("val revealStamp = rememberUpdatedState(onRevealStamp)") &&
    messageRow.includes("revealStamp.value()") &&
    messageRow.includes("onToggleSelect(m)") &&
    messageRow.includes("msgExpanded = false"),
);
check(
  "link text, link-preview, and See more/less taps reveal the same message before opening or expanding",
  /Links\.annotate\(full, bodyInk\)\s*\{\s*u ->\s*revealStamp\.value\(\)\s*Links\.open\(ctx, u\)\s*\}/.test(
    messageRow,
  ) &&
    /onOpen\s*=\s*if \(selecting\)\s*\{\s*null\s*\}\s*else\s*\{\s*\{\s*revealStamp\.value\(\)\s*Links\.open\(ctx, firstLink\)\s*\}\s*\}/.test(
      messageRow,
    ) &&
    /detectTapGestures\s*\{\s*revealStamp\.value\(\)\s*msgExpanded = !msgExpanded/.test(messageRow),
);
check(
  "photo, album, video and view-once rows reveal status from their own tap targets",
  videoRow.includes("onRevealStamp()") &&
    videoRow.includes("onOpen(m)") &&
    imageRow.includes("onRevealStamp()") &&
    imageRow.includes("onOpenImage(m)") &&
    albumRow.includes("onRevealStamp()") &&
    albumRow.includes("onTap()") &&
    onceTextRow.includes("onRevealStamp()") &&
    onceRow.includes("onRevealStamp()"),
);
check(
  "nested voice/document gestures reveal too, including waveform taps that are consumed for seeking",
  fileBubble.includes("onRevealStamp()") &&
    fileBubble.includes("onTap = onRevealStamp") &&
    voiceOnce.includes("onRevealStamp()") &&
    voiceOnce.includes("onTap = onRevealStamp") &&
    voiceWave.includes("onTap: (() -> Unit)? = null") &&
    voiceWave.includes("rememberUpdatedState(onTap)") &&
    voiceWave.includes("revealStamp?.invoke()"),
);
check(
  "emoji taps reveal the message status without removing the existing replay gesture",
  emoji.includes("onTap: (() -> Unit)? = null") &&
    emoji.includes("active && shouldAnimate") &&
    emoji.includes("danceKey,") &&
    emoji.includes("onTap,") &&
    emoji.includes("onTap?.invoke()") &&
    emoji.includes("if (isSingle) replay(local = true) else haptics.tap()"),
);
check(
  "hidden rows still suppress BubbleStamp, and tapping exposes the existing sent/delivered/seen tick mapping",
  chat.includes('if (!m.optBoolean("kpHideStamp")) BubbleStamp') &&
    tick.includes('seen -> Icon(Icons.Filled.DoneAll, "Seen"') &&
    tick.includes('delivered -> Icon(Icons.Filled.DoneAll, "Delivered"') &&
    tick.includes('else -> Icon(Icons.Filled.Done, "Sent"'),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
