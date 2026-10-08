// Source-contract coverage for reliable swipe-to-reply on single photos and grouped albums.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const app = path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/");
const chat = fs.readFileSync(path.join(app, "ChatScreen.kt"), "utf8");
const policy = fs.readFileSync(path.join(app, "MessageReplySwipePolicy.kt"), "utf8");

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  return a >= 0 && b > a ? source.slice(a, b) : "";
}
const swipe = section(
  chat,
  "private fun Modifier.photoReplySwipe(",
  "/** Lift only the visual message content",
);
const image = section(chat, "private fun ImageMessageRow(", "/** A photo row:");
const album = section(chat, "private fun AlbumMessageRow(", "/** One square of a grouped bubble");
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "incoming media replies by swiping right; own media replies left with the same threshold as text",
  policy.includes("baseThresholdPx * if (mine) 1.5f else 1f") &&
    policy.includes("if (mine) deltaX < 0f else deltaX > 0f") &&
    policy.includes("abs(deltaX) >= requiredDistance(baseThresholdPx, mine)"),
);
check(
  "single-photo swipe is recognized on a stable wrapper before its moving image child and calls the reply callback once",
  /Box\(\s*Modifier\.photoReplySwipe\([\s\S]{0,700}?\)\s*,\s*\)\s*\{\s*Box\(\s*Modifier\s*\.offset/.test(
    image,
  ) &&
    image.includes("onReply(m)") &&
    image.includes("baseThresholdPx = replyThreshold"),
);
check(
  "each album tile shares the album wrapper's swipe-to-reply recognizer, including the photo's visible tiles",
  /Box\(\s*Modifier\.photoReplySwipe\([\s\S]{0,700}?\)\s*,\s*\)\s*\{\s*Box\(\s*Modifier\s*\.offset/.test(
    album,
  ) &&
    album.includes("AlbumTile(") &&
    album.includes("onReply(m)"),
);
check(
  "the recognizer waits for horizontal intent, claims the gesture before child clicks, preserves vertical scrolling and ignores long-press",
  swipe.includes("PointerEventPass.Initial") &&
    swipe.includes("change.consume()") &&
    swipe.includes("MessageReplySwipePolicy.isHorizontalIntent") &&
    swipe.includes("viewConfiguration.longPressTimeoutMillis") &&
    swipe.includes("MessageReplySwipePolicy.shouldReply") &&
    swipe.includes("offset.value(0f)"),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
