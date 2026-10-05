// Long-pressed chat cards and message bubbles stay crisp above the modal blur.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const ui = read("Ui.kt");
const kpApp = read("KpApp.kt");
const deleteAnim = read("DeleteAnim.kt");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const convCardStart = chatList.indexOf("private fun ConvCard(");
const convLongPressStart = chatList.indexOf("val longPress = {", convCardStart);
const convLongPressEnd = chatList.indexOf("\n    Row(", convLongPressStart);
const convLongPress = chatList.slice(convLongPressStart, convLongPressEnd);
const messageLongPressStart = chat.indexOf(
  "onLongPress = { msg ->",
  chat.indexOf("itemsIndexed(", chat.indexOf("LazyColumn(")),
);
const messageLongPressEnd = chat.indexOf("quoteFor =", messageLongPressStart);
const messageLongPress = chat.slice(messageLongPressStart, messageLongPressEnd);
const focusStart = ui.indexOf("internal fun KpModalFocusOverlay(");
const focusEnd = ui.indexOf("/**\n * Shared image helpers", focusStart);
const focusOverlay = ui.slice(focusStart, focusEnd);

check(
  "chat-list long-press captures the actual card bounds and snapshot before opening its sheet",
  chatList.includes("spotlightWindowBounds = coordinates.boundsInWindow()") &&
    chatList.includes("spotlightRootBounds = coordinates.boundsInRoot()") &&
    convLongPress.includes(
      "KpModalFocusState.capture(windowBounds, rootBounds, RoundedCornerShape(16.dp))",
    ) &&
    convLongPress.indexOf(
      "KpModalFocusState.capture(windowBounds, rootBounds, RoundedCornerShape(16.dp))",
    ) < convLongPress.indexOf("ListSelect.sheetFor = conv"),
);
check(
  "message long-press captures that message's own bubble before showing its actions",
  messageLongPress.includes("DeleteGeoms.bubbles[focusKey]") &&
    messageLongPress.includes("DeleteGeoms.bubblesInRoot[focusKey]") &&
    messageLongPress.includes("DeleteGeoms.bubbleShapes[focusKey]") &&
    messageLongPress.includes(
      "KpModalFocusState.capture(focusBounds, focusRootBounds ?: focusBounds, focusShape)",
    ) &&
    chat.includes("it.boundsInRoot()") &&
    messageLongPress.indexOf(
      "KpModalFocusState.capture(focusBounds, focusRootBounds ?: focusBounds, focusShape)",
    ) < messageLongPress.indexOf("actionFor = msg"),
);
check(
  "spotlight capture forces a fresh PixelCopy and keeps the source at device resolution",
  ui.includes("forceFresh = true") &&
    deleteAnim.includes("maxWidthPx: Int = MAX_W") &&
    deleteAnim.includes("if (forceFresh || full == null") &&
    deleteAnim.includes("val targetWidth = maxWidthPx.coerceAtLeast(1)"),
);
check(
  "spotlight bitmap overlays the source at exact bounds, clips to its stored shape, and is not scaled into a crop",
  kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
    kpApp.indexOf("KpModalFocusOverlay(") &&
    focusOverlay.includes("snapshot.boundsInRoot.left.roundToInt()") &&
    focusOverlay.includes("snapshot.boundsInRoot.top.roundToInt()") &&
    focusOverlay.includes(".size(width, height)") &&
    focusOverlay.includes(".clip(snapshot.shape)") &&
    focusOverlay.includes(".graphicsLayer { alpha = t }") &&
    !focusOverlay.includes("scaleX") &&
    !focusOverlay.includes("translationY") &&
    ui.includes("val shape: Shape") &&
    deleteAnim.includes("val bubbleShapes = mutableMapOf<String, Shape>()") &&
    !focusOverlay.includes(".shadow("),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
