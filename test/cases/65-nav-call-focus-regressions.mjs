// Android QA contracts: demo nav alignment, route/call ownership, modal glass, and live focus movement.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const about = read("AboutScreen.kt");
const settings = read("SettingsScreen.kt");
const status = read("StatusScreens.kt");
const focus = read("KpFocusSheet.kt");
const ui = read("Ui.kt");
const attach = read("AttachSheet.kt");
const kpApp = read("KpApp.kt");
const cache = read("Cache.kt");
const statusScreen = read("StatusScreens.kt");
const api = read("Api.kt");
const theme = readFileSync(resolve("native-android/app/src/main/res/values/themes.xml"), "utf8");
const navEnter = readFileSync(
  resolve("native-android/app/src/main/res/anim/kp_nav_enter.xml"),
  "utf8",
);
const navExit = readFileSync(
  resolve("native-android/app/src/main/res/anim/kp_nav_exit.xml"),
  "utf8",
);
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
const chatRouteStart = kpApp.indexOf('"chat/{id}"', homeEnd);
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
  "Chats tab and every app chat/message action use the supplied tintable outline vector, with metadata stripped",
  nav.includes("painter = painterResource(R.drawable.ic_nav_chat)") &&
    icon.includes('android:fillColor="#00000000"') &&
    icon.includes('android:strokeColor="#FF000000"') &&
    icon.includes('android:strokeWidth="1.6"') &&
    icon.includes('android:strokeLineCap="round"') &&
    icon.includes('android:strokeLineJoin="round"') &&
    icon.includes(
      'android:pathData="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1"',
    ) &&
    !icon.includes("c2pa") &&
    !icon.includes("metadata") &&
    [chatList, chat, about, settings, status].every((source) =>
      source.includes("KpChatMessageVector()"),
    ) &&
    [chatList, chat, about, settings, status].every(
      (source) =>
        !source.includes("Icons.Filled.Chat") && !source.includes("Icons.AutoMirrored.Filled.Chat"),
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
  "WindowManager animates the pill as one surface; Compose no longer relayouts the window every frame",
  nav.includes("if (dialogAttached)") &&
    nav.includes("dialogWindow.setWindowAnimations(R.style.KpNavWindowAnimations)") &&
    nav.includes("dialogWindowRef[0]?.setWindowAnimations(0)") &&
    nav.includes("params.y = bottomOffsetPx") &&
    nav.includes("copy(alpha = 0.92f)") &&
    !nav.includes("setBackgroundBlurRadius(") &&
    nav.includes("WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()") &&
    theme.includes("@anim/kp_nav_enter") &&
    theme.includes("@anim/kp_nav_exit") &&
    navEnter.includes('android:fromYDelta="100%"') &&
    navExit.includes('android:toYDelta="100%"') &&
    !nav.includes("slideProgress") &&
    !nav.includes("params.y = windowYOffsetPx"),
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
  "home stays still; chat entry uses a destination-local slide-and-fade while the nav pill keeps native window motion",
  homeRoute.includes("enterTransition = { EnterTransition.None }") &&
    homeRoute.includes("exitTransition = { ExitTransition.None }") &&
    homeRoute.includes("popEnterTransition = { EnterTransition.None }") &&
    !homeRoute.includes("slideInVertically") &&
    !homeRoute.includes("slideOutVertically") &&
    chatRoute.includes('"chat/{id}"') &&
    chatRoute.includes("enterTransition = { EnterTransition.None }") &&
    chatRoute.includes("fadeOut(tween(180, easing = FastOutSlowInEasing))") &&
    chatRoute.includes(
      "popEnterTransition = { fadeIn(tween(240, easing = FastOutSlowInEasing)) }",
    ) &&
    chatRoute.includes(
      "slideOutHorizontally(tween(250, easing = FastOutSlowInEasing)) { it / 4 }",
    ) &&
    kpApp.includes("private fun ChatRouteEntryMotion(") &&
    kpApp.includes("translationX = size.width * 0.30f * (1f - fraction)") &&
    kpApp.includes("ChatRouteEntryMotion { ChatScreen(nav, id) }") &&
    !nav.includes("windowYOffsetPx") &&
    nav.includes("R.style.KpNavWindowAnimations"),
);
check(
  "the rounded floating pill uses a high-opacity native surface without platform blur",
  nav.includes("val pillFill =") &&
    nav.includes("copy(alpha = 0.92f)") &&
    nav.includes("val backgroundCardWidth = 208.dp") &&
    nav.includes("val backgroundCardHeight = 46.dp") &&
    nav.includes(".background(pillFill)") &&
    nav.includes("ColorDrawable(android.graphics.Color.TRANSPARENT)") &&
    nav.includes("dialogWindow.setBackgroundDrawable(pillWindowBackground)") &&
    !nav.includes("setBackgroundBlurRadius(") &&
    nav.includes(".clip(CircleShape)") &&
    nav.includes(".background(indicatorColor)") &&
    !nav.includes("glassEdge") &&
    !nav.includes("selectedBorder") &&
    !nav.includes(".border(1.25.dp"),
);
check(
  "default-network recovery evicts stale HTTP sockets, retries the outbox, and refreshes visible feeds",
  cache.includes("mgr.registerDefaultNetworkCallback(cb)") &&
    cache.includes("Api.http.connectionPool.evictAll()") &&
    cache.includes("kick(400, force = true)") &&
    cache.includes("ScreenStore.pokeInbox()") &&
    !cache.includes("registerNetworkCallback(req, cb)"),
);
check(
  "a failed status fetch bypasses stale-cache fallback so the retry notice can be shown",
  api.includes("allowCachedFallback: Boolean = true") &&
    api.includes("if (allowCachedFallback) Cache.peek(key)?.let { return it }") &&
    statusScreen.includes("allowCachedFallback = false") &&
    statusScreen.includes("Tap to retry"),
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
  "focused message replays the original-size Compose layer above reactions, without bitmap capture or touch-through",
  chat.includes("DeleteGeoms.put(m, it.boundsInWindow(), it.boundsInRoot(), bubbleShape)") &&
    chat.includes('focusKey = "message:$rowKey"') &&
    chat.includes("targetScale = 1f") &&
    focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    focus.includes("focusLayer?.record") &&
    focus.includes("drawLayer(item.graphicsLayer)") &&
    focus.includes(".size(width, height)") &&
    focus.includes("KpModalFocusState.updateSource(key, currentBounds)") &&
    focus.includes("KpModalFocusState.beginReturn()") &&
    !focus.includes("androidx.compose.runtime.movableContentOf") &&
    !focus.includes("item.content()") &&
    !focus.includes("androidx.compose.ui.window.Dialog(") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("DeleteAnim.capture("),
);
check(
  "root focus replays the sharp source layer above the blurred screen and action sheet, over reactions and options",
  kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
    kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("drawLayer(item.graphicsLayer)") &&
    !focus.includes("movableContentOf") &&
    focus.includes("KpModalFocusState.updateTargetAboveSheet(") &&
    focus.includes("val top = finalSheetTop - source.height - gapPx") &&
    focus.indexOf("KpModalFocusState.updateTargetAboveSheet(") <
      focus.indexOf("request.content(this)") &&
    chat.includes('listOf("👍", "❤️", "😂", "😮", "😢", "🙏")'),
);
check(
  "backdrop blur releases as sheets close and remains correctly registered for normal KpSheet and emoji sheet",
  kpApp.includes("modalBlur.animateTo(30f, tween(260, easing = FastOutSlowInEasing))") &&
    kpApp.includes("modalBlur.animateTo(0f, tween(280, easing = LinearEasing))") &&
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
