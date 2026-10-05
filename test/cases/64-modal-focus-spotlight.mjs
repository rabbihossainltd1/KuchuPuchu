// Long-pressed chat cards and message bubbles remain live Compose content above modal blur.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const focus = read("KpFocusSheet.kt");
const kpApp = read("KpApp.kt");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const convCardStart = chatList.indexOf("private fun ConvCard(");
const longPressStart = chatList.indexOf("val longPress = {", convCardStart);
const longPressEnd = chatList.indexOf("\n    Row(", longPressStart);
const convLongPress = chatList.slice(longPressStart, longPressEnd);
const liveFocusStart = chatList.indexOf('key = "chat:$convId"');
const liveFocusEnd = chatList.indexOf("\n            }\n        }\n    }\n}", liveFocusStart);
const liveChatFocus = chatList.slice(liveFocusStart, liveFocusEnd);
const messageSlotStart = chat.indexOf("private fun KpMessageFocusSlot(");
const messageSlotEnd = chat.indexOf("@OptIn(ExperimentalFoundationApi::class)", messageSlotStart);
const messageSlot = chat.slice(messageSlotStart, messageSlotEnd);
const messageActionStart = chat.indexOf("/* ---------------- message action sheet");
const messageActionEnd = chat.indexOf("// r103-4: the message-info sheet", messageActionStart);
const messageActions = chat.slice(messageActionStart, messageActionEnd);
const hostStart = focus.indexOf("internal fun KpFocusedSheetHost()");
const focusedHost = focus.slice(hostStart);
const closeStart = focusedHost.indexOf("} else {\n            blurRegistration.release()");
const closeEnd = focusedHost.indexOf("\n    }\n\n    BoxWithConstraints", closeStart);
const closeFlow = focusedHost.slice(closeStart, closeEnd);

check(
  "chat-list long-press focuses the same live card and opens its action sheet",
  liveFocusStart >= 0 &&
    liveChatFocus.includes("targetScale = 1.035f") &&
    liveChatFocus.includes("slotExtra = 10.dp") &&
    liveChatFocus.includes("ConvCard(") &&
    convLongPress.includes("onFocusRequest()") &&
    chatList.includes(
      "requestFocus()\n                            // r103-5: long-press opens the sheet",
    ) &&
    chatList.includes('key = "chat:$convId"'),
);
check(
  "the lifted chat row keeps its measured source slot and reserves extra room before sheet actions",
  focus.includes("if (focused) {") &&
    focus.includes("Spacer(") &&
    focus.includes("sourceWidthPx.intValue.toDp()") &&
    focus.includes("sourceHeightPx.intValue.toDp()") &&
    focus.includes(".height(item.height + item.slotExtra)") &&
    focusedHost.indexOf("KpModalFocusAnchor(request.focusKey, sheetOffsetYPx)") <
      focusedHost.indexOf("request.content(this)"),
);
check(
  "chat-row enlargement is slight and its focus target is positioned from its reserved action-sheet anchor",
  liveChatFocus.includes("targetScale = 1.035f") &&
    liveChatFocus.includes("slotExtra = 10.dp") &&
    focus.includes("val finalAnchorTop = anchorBoundsOnScreen.top - sheetOffsetYPx.roundToInt()") &&
    focus.includes("val left = anchorBoundsOnScreen.center.x - source.width / 2f") &&
    focus.includes("source.width / 2f"),
);
check(
  "message context action receives a stable key for the same live message bubble",
  chat.includes('focusKey = "message:$rowKey"') &&
    messageSlot.includes("KpLiveFocusItem(") &&
    messageSlot.includes("key = focusKey") &&
    messageSlot.includes("targetScale = 1f") &&
    messageSlot.includes("slotExtra = 8.dp") &&
    chat.includes('if (pressed.optString("kind") != "DELETED") requestFocus()'),
);
check(
  "message bubble stays at original size while its measured live source returns smoothly after dismissal",
  messageSlot.includes("targetScale = 1f") &&
    focus.includes("sourceHeightPx.intValue = coordinates.size.height") &&
    focus.includes("KpModalFocusState.updateSource(key, currentBounds)") &&
    focus.includes("val source = if (KpModalFocusState.isReturning) item.returnBoundsOnScreen") &&
    focus.includes("val left = source.left + (target.left - source.left) * t") &&
    focus.includes("val top = source.top + (target.top - source.top) * t") &&
    focus.includes("focusProgress.animateTo(\n                        0f,") &&
    focus.includes("KpModalFocusState.clear()"),
);
check(
  "message bubble's context sheet places the live bubble above quick reactions and action options without overlap",
  messageActions.includes('listOf("👍", "❤️", "😂", "😮", "😢", "🙏")') &&
    messageActions.indexOf("Row(") < messageActions.indexOf('listOf("👍"') &&
    messageActions.indexOf('KpSheetRow(Icons.AutoMirrored.Filled.Reply, "Reply")') >
      messageActions.indexOf('listOf("👍"') &&
    messageActions.includes(
      "focusKey = focusKey.takeIf { KpModalFocusState.focusedItem?.key == it }",
    ) &&
    focusedHost.indexOf("KpModalFocusAnchor(request.focusKey, sheetOffsetYPx)") <
      focusedHost.indexOf("request.content(this)"),
);
check(
  "dismissal animates the focus target back before restoring the source and completing the action",
  closeStart >= 0 &&
    closeEnd > closeStart &&
    closeFlow.includes("KpModalFocusState.beginReturn()") &&
    closeFlow.includes("focusProgress.animateTo(") &&
    closeFlow.includes("sheetProgress.animateTo(") &&
    closeFlow.indexOf("focusProgress.animateTo(") <
      closeFlow.indexOf("KpModalFocusState.clear()") &&
    closeFlow.indexOf("sheetProgress.animateTo(") <
      closeFlow.indexOf("KpFocusSheetState.finishClose()"),
);
check(
  "focus overlay is one movable live composition in the root above the blurred screen and sheet",
  focus.includes("androidx.compose.runtime.movableContentOf") &&
    kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
      kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpRootFocusOverlayHost()") &&
    focus.includes("item.content()") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("ImageBitmap") &&
    !focus.includes("DeleteAnim.capture("),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
