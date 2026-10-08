// Source-contract coverage for the first-frame Noto fallback and its fixed dp-sized container.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const emoji = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/EmojiAnim.kt"),
  "utf8",
);
const start = emoji.indexOf("internal fun NotoAnimatedEmoji(");
const end = emoji.indexOf("internal fun EmojiGlyphRow(", start);
const renderer = start >= 0 && end > start ? emoji.slice(start, end) : "";
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "the cold system-emoji fallback is scaled to the same physical size as its dp container, independent of font scale",
  renderer.includes("modifier = modifier.size(sizeSp.dp)") &&
    renderer.includes("val fallbackFontSize = (sizeSp / LocalDensity.current.fontScale).sp") &&
    renderer.includes("fontSize = fallbackFontSize") &&
    renderer.includes("lineHeight = fallbackFontSize") &&
    !renderer.includes("fontSize = sizeSp.sp"),
);
check(
  "fallback text stays on one line without Android font padding, avoiding first-frame crop",
  renderer.includes("maxLines = 1") &&
    renderer.includes("softWrap = false") &&
    renderer.includes("PlatformTextStyle(includeFontPadding = false)") &&
    renderer.includes("modifier = Modifier.align(Alignment.Center)"),
);
check(
  "the loaded Lottie frame still fills the identical emoji box; only fallback text sizing changes",
  renderer.includes("modifier = Modifier.fillMaxSize()") &&
    renderer.includes("progress = { 1f }") &&
    renderer.includes("LottieAnimation("),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
