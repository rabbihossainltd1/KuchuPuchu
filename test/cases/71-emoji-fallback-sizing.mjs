// Source-contract coverage for the cold Noto fallback's unbounded glyph ink and dp-sized box.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const app = path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android");
const emoji = fs.readFileSync(path.join(app, "EmojiAnim.kt"), "utf8");
const policy = fs.readFileSync(path.join(app, "EmojiFallbackSizingPolicy.kt"), "utf8");
const start = emoji.indexOf("internal fun NotoAnimatedEmoji(");
const end = emoji.indexOf("internal fun EmojiGlyphRow(", start);
const renderer = start >= 0 && end > start ? emoji.slice(start, end) : "";
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "the cold fallback keeps a font-scale-independent physical glyph size and extra line-metric slack",
  policy.includes("LINE_HEIGHT_MULTIPLIER = 1.2f") &&
    policy.includes("boxSizeDp / fontScale") &&
    policy.includes("fontSizeSp * LINE_HEIGHT_MULTIPLIER") &&
    renderer.includes("modifier = modifier.size(sizeSp.dp)") &&
    renderer.includes(
      "EmojiFallbackSizingPolicy.fontSizeSp(sizeSp, LocalDensity.current.fontScale).sp",
    ) &&
    renderer.includes("EmojiFallbackSizingPolicy.lineHeightSp(fallbackFontSize.value).sp") &&
    renderer.includes("fontSize = fallbackFontSize") &&
    renderer.includes("lineHeight = fallbackLineHeight") &&
    !renderer.includes("fontSize = sizeSp.sp"),
);
check(
  "fallback text is centered and measured unbounded so the glyph's bottom/right ink is not clipped by the fixed box",
  renderer.includes("maxLines = 1") &&
    renderer.includes("softWrap = false") &&
    renderer.includes("PlatformTextStyle(includeFontPadding = false)") &&
    renderer.includes("Modifier.align(Alignment.Center).wrapContentSize(unbounded = true)"),
);
check(
  "the loaded Lottie frame still fills the original emoji box; only cold fallback text measurement changes",
  renderer.includes("modifier = Modifier.fillMaxSize()") &&
    renderer.includes("progress = { 1f }") &&
    renderer.includes("LottieAnimation("),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
