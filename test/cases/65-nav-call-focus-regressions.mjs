// Android QA contracts: demo nav alignment, route/call ownership, modal glass, and live focus movement.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const focus = read("KpFocusSheet.kt");
const ui = read("Ui.kt");
const attach = read("AttachSheet.kt");
const kpApp = read("KpApp.kt");
const icon = readFileSync(
  resolve("native-android/app/src/main/res/drawable/ic_nav_chat.xml"),
  "utf8",
);

const navStart = chatList.indexOf("internal fun HomeBottomNavigation(");
const navEnd = chatList.indexOf("@Composable\nprivate fun NavItem(", navStart);
const nav = navStart >= 0 && navEnd > navStart ? chatList.slice(navStart, navEnd) : "";
const peekStart = chatList.indexOf("private fun PeekAction(");
const peekEnd = chatList.indexOf("\n}", peekStart);
const peekAction = chatList.slice(peekStart, peekEnd);
const attachTileStart = attach.indexOf("private fun AttachTile(");
const attachTile = attach.slice(attachTileStart);
const editButtonStart = attach.indexOf("// Edit (pencil) button");
const editButtonEnd = attach.indexOf("// r66: one long caption pill", editButtonStart);
const editButton = attach.slice(editButtonStart, editButtonEnd);
const homeStart = kpApp.indexOf('composable(\n                    "main",');
const homeEnd = kpApp.indexOf('composable("newchat")', homeStart);
const homeRoute = kpApp.slice(homeStart, homeEnd);
const chatRouteStart = kpApp.indexOf('composable("chat/{id}")', homeEnd);
const chatRouteEnd = kpApp.indexOf('composable("settings")', chatRouteStart);
const chatRoute = kpApp.slice(chatRouteStart, chatRouteEnd);
const sharedSheetStart = ui.indexOf("fun KpSheet(");
const sharedSheetEnd = ui.indexOf("fun KpSheetRow(", sharedSheetStart);
const sharedSheet = ui.slice(sharedSheetStart, sharedSheetEnd);
const emojiStart = chat.indexOf("private fun EmojiSheetDialog(");
const emojiEnd = chat.indexOf("/** True when a FILE message", emojiStart);
const emojiSheet = chat.slice(emojiStart, emojiEnd);
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "Chats tab uses the exact filled message/chat glyph from the supplied demo",
  nav.includes("painter = painterResource(R.drawable.ic_nav_chat)") &&
    icon.includes(
      'android:pathData="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"',
    ),
);
check(
  "four equally sized tab slots share a centered indicator with the demo's 450ms easing",
  (nav.match(/Modifier\.weight\(1f\)/g) ?? []).length >= 4 &&
    nav.includes("val slotWidth = (maxWidth - capsulePadding * 2 - gap * 3) / 4") &&
    nav.includes("val indicatorSize = 40.dp") &&
    nav.includes("capsulePadding + (slotWidth - indicatorSize) * 0.5f") &&
    nav.includes("(slotWidth + gap) * tab.coerceIn(0, 3).toFloat()") &&
    nav.includes("CubicBezierEasing(0.34f, 1.45f, 0.5f, 1f)") &&
    nav.includes("tween(450, easing = indicatorEasing)") &&
    nav.includes(".offset(x = indicatorX, y = indicatorY)"),
);
check(
  "the pill animates its floating window down/up and fades the real platform backdrop blur",
  nav.includes("val slideProgress = remember { Animatable(1f) }") &&
    nav.includes("targetValue = if (visible) 0f else 1f") &&
    nav.includes("tween(420, easing = slideEasing)") &&
    nav.includes("params.y = windowYOffsetPx") &&
    nav.includes("pillWindowBackground.setColor(") &&
    nav.includes("dialogWindow.setBackgroundBlurRadius(") &&
    nav.includes("WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE") &&
    nav.includes("val dialogAttached = !modalOpen && (visible || slideProgress.value < 0.999f)"),
);
check(
  "home route and full-screen call gate own nav visibility; pushed chat routes hide it",
  kpApp.includes('visible = authed && actualRoute == "main"') &&
    kpApp.includes("!callFullscreen && !modalWindowVisible") &&
    kpApp.includes('currentDestination == "chat/{id}"') &&
    kpApp.includes("CallGate") &&
    kpApp.includes("callEngine.active != null") &&
    kpApp.includes("callEngine.minimized"),
);
check(
  "home content stays stationary on return while only the independently hosted pill rises from below",
  homeRoute.includes("enterTransition = { fadeIn(tween(180)) }") &&
    homeRoute.includes("exitTransition = { fadeOut(tween(160)) }") &&
    homeRoute.includes("popEnterTransition = { fadeIn(tween(180)) }") &&
    !homeRoute.includes("slideInVertically") &&
    !homeRoute.includes("slideOutVertically") &&
    chatRoute.includes('composable("chat/{id}") { entry ->') &&
    nav.includes(
      "windowYOffsetPx = bottomOffsetPx - (exitTravelPx * slideProgress.value).roundToInt()",
    ),
);
check(
  "the pill's translucent rounded native background reveals platform blur rather than transparent Compose fill",
  nav.includes("val glassFill =") &&
    nav.includes("val fallbackFill =") &&
    nav.includes("GradientDrawable()") &&
    nav.includes("dialogWindow.setBackgroundDrawable(pillWindowBackground)") &&
    nav.includes("setBackgroundBlurRadius(") &&
    nav.includes(".clip(CircleShape)") &&
    nav.includes(".background(indicatorColor)") &&
    !nav.includes(".background(glassFill)") &&
    !nav.includes("glassEdge") &&
    !nav.includes("selectedBorder") &&
    !nav.includes(".border(1.25.dp"),
);
check(
  "sheet action buttons remain borderless while selection, caption, and confirmation controls keep their treatment",
  !peekAction.includes(".border(") &&
    editButtonStart >= 0 &&
    editButtonEnd > editButtonStart &&
    !editButton.includes(".border(") &&
    !attachTile.includes(".border(") &&
    attach.includes(".border(1.dp, Color(0x44FFFFFF), RoundedCornerShape(barH / 2))") &&
    attach.includes(".border(1.dp, Color.White, CircleShape)") &&
    ui.includes("fun KpSheetRow(") &&
    !ui
      .slice(ui.indexOf("fun KpSheetRow("), ui.indexOf("fun KpConfirmSheet("))
      .includes(".border(") &&
    !ui
      .slice(
        ui.indexOf("fun KpConfirmSheet("),
        ui.indexOf("/**", ui.indexOf("fun KpConfirmSheet(")),
      )
      .includes(".border("),
);
check(
  "focused message is the original-size live bubble above reactions and sheet options, not a bitmap or touch-through window",
  chat.includes("DeleteGeoms.put(m, it.boundsInWindow(), it.boundsInRoot(), bubbleShape)") &&
    chat.includes('focusKey = "message:$rowKey"') &&
    chat.includes("targetScale = 1f") &&
    focus.includes("androidx.compose.runtime.movableContentOf") &&
    focus.includes("item.content()") &&
    focus.includes(".size(width, height)") &&
    focus.includes("KpModalFocusState.updateSource(key, currentBounds)") &&
    focus.includes("KpModalFocusState.beginReturn()") &&
    !focus.includes("androidx.compose.ui.window.Dialog(") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("DeleteAnim.capture("),
);
check(
  "root focus is drawn above the blurred screen and action sheet; the live bubble rests above reactions and options",
  kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
    kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("KpModalFocusState.updateTargetAboveSheet(") &&
    focus.includes("val top = finalSheetTop - source.height - gapPx") &&
    focus.indexOf("KpModalFocusState.updateTargetAboveSheet(") <
      focus.indexOf("request.content(this)") &&
    chat.includes('listOf("👍", "❤️", "😂", "😮", "😢", "🙏")'),
);
check(
  "backdrop blur releases as sheets close and remains correctly registered for normal KpSheet and emoji sheet",
  kpApp.includes("modalBlur.animateTo(30f, tween(220))") &&
    kpApp.includes("else modalBlur.snapTo(0f)") &&
    sharedSheet.includes("KpRememberModalBottomSheetState(blurRegistration)") &&
    sharedSheet.indexOf("KpRegisterModalBlur()") >= 0 &&
    sharedSheet.indexOf("KpRegisterModalBlur()") < sharedSheet.indexOf("ModalBottomSheet(") &&
    sharedSheet.slice(sharedSheet.indexOf("ModalBottomSheet(")).indexOf("KpRegisterModalBlur()") <
      0 &&
    emojiSheet.includes("KpRememberModalBottomSheetState(blurRegistration)") &&
    emojiSheet.indexOf("KpRegisterModalBlur()") >= 0 &&
    emojiSheet.indexOf("KpRegisterModalBlur()") < emojiSheet.indexOf("ModalBottomSheet(") &&
    ui.includes("target == androidx.compose.material3.SheetValue.Hidden") &&
    ui.includes("registration.release()") &&
    ui.includes("registration.retain()"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
