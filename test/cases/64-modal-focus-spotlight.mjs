// Long-pressed chat cards and message bubbles remain live Compose content above modal blur.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const focus = read("KpFocusSheet.kt");
const kpApp = read("KpApp.kt");
const rootBuild = readFileSync("native-android/build.gradle.kts", "utf8");
const appBuild = readFileSync("native-android/app/build.gradle.kts", "utf8");
const gradleProperties = readFileSync("native-android/gradle.properties", "utf8");
const gradleWrapper = readFileSync(
  "native-android/gradle/wrapper/gradle-wrapper.properties",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "#1101 toolchain rollback isolates the runtime upgrade; #1100 no longer transfers movable content",
  rootBuild.includes('id("com.android.application") version "8.11.1"') &&
    rootBuild.includes('id("org.jetbrains.kotlin.android") version "2.1.21"') &&
    rootBuild.includes('id("org.jetbrains.kotlin.plugin.compose") version "2.1.21"') &&
    appBuild.includes('id("org.jetbrains.kotlin.plugin.compose")') &&
    appBuild.includes('val kpComposeBomVersion = "2026.06.00"') &&
    appBuild.includes("Compose 1.11.3 baseline") &&
    appBuild.includes("compileSdk = 35") &&
    appBuild.includes("targetSdk = 35") &&
    appBuild.includes('platform("androidx.compose:compose-bom:$kpComposeBomVersion")') &&
    appBuild.includes("navigation-compose:2.9.8") &&
    gradleWrapper.includes("gradle-8.13-all.zip") &&
    !gradleProperties.includes("android.builtInKotlin=false") &&
    !gradleProperties.includes("android.newDsl=false") &&
    !workflow.includes('"platforms;android-37.0"') &&
    focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    !focus.includes("movableContentOf"),
);

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
    liveChatFocus.includes("ConvCard(") &&
    convLongPress.includes("onFocusRequest()") &&
    chatList.includes(
      "requestFocus()\n                            // r103-5: long-press opens the sheet",
    ) &&
    chatList.includes('key = "chat:$convId"'),
);
check(
  "the focused row keeps its measured source slot, pins the Lazy item, and draws above the bottom sheet",
  focus.includes("if (focused) {") &&
    focus.includes("focusLayer?.record") &&
    focus.includes("content(requestFocus)") &&
    focus.includes("LocalPinnableContainer.current") &&
    focus.includes("pinnableContainer?.pin()") &&
    focus.includes("fun updateTargetAboveSheet(") &&
    focus.includes("val finalSheetTop = sheetBoundsOnScreen.top - sheetOffsetYPx.roundToInt()") &&
    focus.includes("val top = finalSheetTop - source.height - gapPx") &&
    focusedHost.includes("KpModalFocusState.updateTargetAboveSheet(") &&
    !focusedHost.includes("KpModalFocusAnchor(") &&
    focusedHost.indexOf("KpModalFocusState.updateTargetAboveSheet(") <
      focusedHost.indexOf("request.content(this)"),
);
check(
  "chat-row enlargement stays slight and centered above the sheet with a deliberate gap",
  liveChatFocus.includes("targetScale = 1.035f") &&
    focus.includes("val left = sheetBoundsOnScreen.center.x - source.width / 2f") &&
    focus.includes("with(density) { 12.dp.toPx() }") &&
    focus.includes("source.width / 2f"),
);
check(
  "message context action receives a stable key for the same live message bubble",
  chat.includes('focusKey = "message:$rowKey"') &&
    messageSlot.includes("KpLiveFocusItem(") &&
    messageSlot.includes("key = focusKey") &&
    messageSlot.includes("Modifier.wrapContentSize(unbounded = true)") &&
    messageSlot.includes("targetScale = 1f") &&
    chat.includes('if (pressed.optString("kind") != "DELETED") requestFocus()'),
);
check(
  "message bubble stays at original size while its pinned, measured source returns smoothly after dismissal",
  messageSlot.includes("targetScale = 1f") &&
    focus.includes("sourceBounds.value = currentBounds") &&
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
    focus.includes("KpModalFocusState.updateTargetAboveSheet(") &&
    focus.includes("val top = finalSheetTop - source.height - gapPx") &&
    focusedHost.indexOf("KpModalFocusState.updateTargetAboveSheet(") <
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
  "one recorded Compose layer is replayed in the root above the blurred screen and sheet, without a second tree or bitmap",
  focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    focus.includes("focusLayer?.record") &&
    focus.includes("drawLayer(item.graphicsLayer)") &&
    kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
      kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpRootFocusOverlayHost()") &&
    !focus.includes("androidx.compose.runtime.movableContentOf") &&
    !focus.includes("item.content()") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("ImageBitmap") &&
    !focus.includes("DeleteAnim.capture("),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
