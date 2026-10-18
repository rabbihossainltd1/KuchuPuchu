// Owner round 35 — the four things the owner named on 2026-10-18:
//
//   1. The message bar's caret did not sit at the END of the typed text —
//      it drifted left as the message grew, until it sat ON a word.
//   2. A link inside a message wore the chat accent, so on my own blue
//      bubble it wore the bubble's own blue and could not be read.
//   3. The QR screen's scan pane had a box border around it.
//   4. The QR screen's My code / Scan switch had no switching animation,
//      and the tabs wore the stock Material glyphs with a text label.
//
// This file pins the source of every one of them, so a later round cannot
// quietly undo the fix. It reads the sources; it does not run the UI.

import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

const kt = (name) => read(`native-android/app/src/main/java/app/kuchupuchu/android/${name}`);
const CHAT = kt("ChatScreen.kt");
const QR = kt("QrScreen.kt");
const ICONS = kt("QrIcons.kt");

/* ------------------------------------------- 1. the composer's caret ---- */
{
  // The bar painted the text twice: a visible Text() and a BasicTextField
  // with a transparent colour, so only the field drew the caret. The two
  // layers measured differently because Text() merges LocalTextStyle (the
  // Material body style, 0.5sp letter-spacing) and the field does not, so
  // the visible line grew ~0.5sp per character and the caret walked left.
  check(
    "the composer paints one shared text style for BOTH layers",
    CHAT.includes("val composerTextStyle =") &&
      CHAT.includes("letterSpacing = 0.sp,") &&
      CHAT.includes("fontFamily = FontFamily.Default,") &&
      CHAT.includes("style = composerTextStyle,") &&
      CHAT.includes("textStyle = composerTextStyle.copy(color = Color.Transparent),"),
  );
  check(
    "the visible composer text no longer inherits LocalTextStyle on its own",
    !/Text\(\s*\n\s*text = MessageMarkup\.formatted\([^)]*\),\s*\n\s*color = Ink,\s*\n\s*fontSize = 14\.sp/.test(
      CHAT,
    ),
  );
  // The field and the visible text must agree on the wrapping too, or the
  // caret still lands in the wrong place once the message wraps.
  check(
    "the visible composer text and the field share the size, the line height and the cap",
    CHAT.includes("maxLines = 4,") &&
      CHAT.includes(
        "lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 4),",
      ),
  );
}

/* ---------------------------------------------- 2. a link on its bubble --- */
{
  check(
    "a link and a mention take the bubble-aware colour, not the chat accent",
    CHAT.includes("linkInk = linkInkFor(theme, mine),") &&
      CHAT.includes("mentionInk = linkInkFor(theme, mine),") &&
      !CHAT.includes("linkInk = chatAccent(theme),"),
  );
  check(
    "the link colour is picked against the bubble it sits on",
    CHAT.includes("internal fun linkInkFor(theme: String, mine: Boolean): Color {") &&
      CHAT.includes("val onBubble = bubble.luminance() + 0.05f") &&
      CHAT.includes("val asWhite = 1.05f / onBubble") &&
      CHAT.includes("val asDeepBlue = onBubble / (deepBlue.luminance() + 0.05f)") &&
      CHAT.includes("Color(0xFFFFFFFF)") &&
      CHAT.includes("Color(0xFF17409B)"),
  );
  // The blue chat is the one that broke: my bubble IS the accent's blue.
  check(
    "the blue chat's own bubble colours are the ones the link is judged against",
    CHAT.includes("else -> if (mine) Color(0xFF2F6FED) else Color(0xFF16213A)"),
  );
}

/* --------------------------------------- 3 + 4. the QR screen's own look -- */
{
  check(
    "the scan pane's box border is gone",
    !QR.includes(".border(2.dp, ActionBlueDeep, RoundedCornerShape(20.dp))"),
  );
  // The code panel keeps its frame: the white quiet zone around the QR is
  // what lets a scanner read it.
  check(
    "the QR code panel keeps its frame (the quiet zone is what a scanner reads)",
    QR.includes(".border(2.dp, ActionBlueDeep, RoundedCornerShape(18.dp))"),
  );
  check(
    "the two panes swap with an animation, not a jump cut",
    QR.includes("AnimatedContent(") &&
      QR.includes("slideInHorizontally") &&
      QR.includes("slideOutHorizontally") &&
      QR.includes("fadeIn()") &&
      QR.includes("fadeOut()") &&
      QR.includes("togetherWith"),
  );
  check(
    "the switch is icon-only and animated",
    QR.includes("val fill by animateColorAsState(") &&
      QR.includes("val scale by animateFloatAsState(") &&
      QR.includes("Icon(icon, contentDescription = label, tint = tint"),
  );
  check(
    "the tabs wear the owner's own glyphs, drawn as ImageVectors",
    ICONS.includes("val QrMyCodeIcon: ImageVector by lazy") &&
      ICONS.includes("val QrScanIcon: ImageVector by lazy") &&
      QR.includes('QrTabButton(QrMyCodeIcon, "My code", tab == 0)') &&
      QR.includes('QrTabButton(QrScanIcon, "Scan", tab == 1)'),
  );
  // The glyphs must actually be drawn: three code cells, a head, shoulders
  // and the four viewfinder corners with a scanner line.
  check(
    "the My code glyph carries the code cells, the head and the shoulders",
    ICONS.includes("fun cell(x: Float, y: Float)") &&
      ICONS.includes("cell(3f, 3f)") &&
      ICONS.includes("cell(14f, 3f)") &&
      ICONS.includes("cell(3f, 14f)") &&
      ICONS.includes("curveTo(19.2f, 18f, 20.5f, 19.2f, 20.5f, 21f)"),
  );
  check(
    "the Scan glyph carries the four corners and the scanner line",
    (ICONS.match(/arcTo\(2f, 2f, 0f, false, true,/g) || []).length === 4 &&
      ICONS.includes("moveTo(7f, 12f)") &&
      ICONS.includes("lineTo(17f, 12f)"),
  );
}

console.log(lines.join("\n"));
if (lines.some((line) => line.startsWith("  BROKEN "))) {
  console.error("BROKEN");
  process.exit(1);
}
console.log("OK");
