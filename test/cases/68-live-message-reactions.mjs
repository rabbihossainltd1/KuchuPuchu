import { readFileSync } from "node:fs";

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const chat = readFileSync(`${ANDROID}/ChatScreen.kt`, "utf8");
const emoji = readFileSync(`${ANDROID}/EmojiAnim.kt`, "utf8");
const focus = readFileSync(`${ANDROID}/KpFocusSheet.kt`, "utf8");
const worker = readFileSync("src/worker/index.ts", "utf8");
const quickBarStart = chat.indexOf("private fun MessageQuickReactionBar(");
const quickBarEnd = chat.indexOf("/** Owner round 16: reaction chips", quickBarStart);
const quickBar = chat.slice(quickBarStart, quickBarEnd);
const messageActionStart = chat.indexOf("/* ---------------- message action sheet");
const actionBodyStart = chat.indexOf("val body: @Composable", messageActionStart);
const actionBodyEnd = chat.indexOf("val latestBody", actionBodyStart);
const actionSheetBody = chat.slice(actionBodyStart, actionBodyEnd);
const chipsStart = chat.indexOf("private fun MessageReactions(");
const chipsEnd = chat.indexOf("/** Owner round 16/17: the full reaction sheet", chipsStart);
const chips = chat.slice(chipsStart, chipsEnd);
const lines = [];
const check = (name, condition) => lines.push(`  ${condition ? "OK     " : "BROKEN "} ${name}`);

check(
  "emoji glyphs still replay on every tap, but rapid-tap bursts only apply one heart reaction",
  emoji.includes("val doubleTapConsumed = remember { booleanArrayOf(false) }") &&
    emoji.includes("val isDoubleTap = lastTapAt[0] > 0L && gap in 1..DOUBLE_TAP_HEART_MS") &&
    emoji.includes("if (isDoubleTap && !doubleTapConsumed[0] && onDoubleTap != null)") &&
    emoji.includes("if (isSingle) replay(local = true)") &&
    chat.includes("now - previous < HEART_REACTION_COOLDOWN_MS"),
);
check(
  "the quick reaction strip is hosted above the selected live item, outside the action sheet",
  chat.includes("floatingContent = hostedFloating") &&
    focus.includes("val floatingContent =") &&
    focus.includes("val barTopPx =") &&
    focus.includes("floatingContent()") &&
    !actionSheetBody.includes("MessageQuickReactionBar("),
);
check(
  "all six quick reactions use flexible slots and the '+' button retains a fixed-width visible seat",
  quickBar.includes('val quickEmojis = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")') &&
    quickBar.includes(".weight(1f)") &&
    quickBar.includes(".width(38.dp)") &&
    quickBar.includes("More emojis"),
);
check(
  "new or changed reactions are detected by user and animate with a spring pop into their chip",
  chips.includes("previous[userId] != emoji") &&
    chips.includes("animationNonces[emoji]") &&
    chips.includes("popScale.snapTo(0.38f)") &&
    chips.includes("popScale.animateTo(1.18f, spring") &&
    chips.includes("popScale.animateTo(1f, spring"),
);
check(
  "the effect is live on both phones: local reaction paints immediately and the worker broadcasts the updated message row",
  chat.includes("msgs[idx] = copy") &&
    chat.includes('Api.post("/api/messages/$mid/react"') &&
    chat.includes("idxExisting >= 0 -> msgs[idxExisting] = liveMsg") &&
    worker.includes('type: "message"') &&
    worker.includes("message: updated"),
);

for (const line of lines) console.log(line);
const failures = lines.filter((line) => line.startsWith("  BROKEN")).length;
console.log(`live message reactions: ${lines.length - failures} ok / ${failures} broken`);
process.exitCode = failures ? 1 : 0;
