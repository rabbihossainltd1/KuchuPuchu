// Shared Android glass treatment for modal sheets and popup cards.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (name) =>
  readFileSync(resolve(`native-android/app/src/main/java/app/kuchupuchu/android/${name}`), "utf8");
const ui = read("Ui.kt");
const theme = read("Theme.kt");
const login = read("LoginScreen.kt");
const status = read("StatusScreens.kt");
const chat = read("ChatScreen.kt");
const chatList = read("ChatListScreen.kt");
const kpApp = read("KpApp.kt");
const focus = read("KpFocusSheet.kt");
const navStart = chatList.indexOf("internal fun HomeBottomNavigation(");
const navEnd = chatList.indexOf("@Composable\nprivate fun NavItem(", navStart);
const nav = navStart >= 0 && navEnd > navStart ? chatList.slice(navStart, navEnd) : "";
const sharedSheetStart = ui.indexOf("fun KpSheet(");
const sharedSheetEnd = ui.indexOf("fun KpSheetRow(", sharedSheetStart);
const sharedSheet = ui.slice(sharedSheetStart, sharedSheetEnd);
const countryStart = login.indexOf("fun CountryPickerSheet(");
const statusMenuStart = status.indexOf("private fun StatusMenuSheet(");
const emojiStart = chat.indexOf("private fun EmojiSheetDialog(");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "modal glass palette uses a light, theme-aware transparent surface and edge",
  theme.includes("val GlassSheetSurface: Color") &&
    theme.includes("Card.copy(alpha = if (KpThemeMode.darkBlue) 0.76f else 0.80f)") &&
    theme.includes("val GlassSheetEdge: Color"),
);
check(
  "modal blur is reference-counted, releases as a sheet targets Hidden, and reacquires if a swipe reverses",
  ui.includes("internal object KpModalBlurState") &&
    ui.includes("internal class KpModalBlurRegistration") &&
    ui.includes("visibleWindowCount") &&
    ui.includes("hasVisibleWindow") &&
    ui.includes("fun register()") &&
    ui.includes("fun unregister()") &&
    ui.includes("fun unregisterWindow()") &&
    ui.includes("fun acquire()") &&
    ui.includes("fun release()") &&
    ui.includes("fun retain()") &&
    ui.includes("fun dispose()") &&
    ui.includes("DisposableEffect(registration)") &&
    ui.includes("target == androidx.compose.material3.SheetValue.Hidden") &&
    ui.includes("KpModalBlurState.unregister()") &&
    ui.includes("internal fun KpRememberModalBottomSheetState(") &&
    kpApp.includes(".blur(modalBlurRadius)") &&
    kpApp.includes("modalBlur.animateTo(30f, tween(220))") &&
    kpApp.includes("else modalBlur.snapTo(0f)"),
);
check(
  "focus sheet lifts the same live Compose item, leaves its source slot, and returns without bitmap or duplicate capture",
  focus.includes("androidx.compose.runtime.movableContentOf") &&
    focus.includes("internal object KpModalFocusState") &&
    focus.includes("if (focused) {") &&
    focus.includes("Spacer(") &&
    focus.includes("else {\n            movable()\n        }") &&
    focus.includes("KpModalFocusState.updateSource(key, currentBounds)") &&
    focus.includes("KpModalFocusState.beginReturn()") &&
    focus.includes("KpModalFocusState.clear()") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("ImageBitmap") &&
    !focus.includes("DeleteAnim.capture(") &&
    !focus.includes("androidx.compose.ui.window.Dialog("),
);
check(
  "root overlay remains sharp above the blurred app and above the focused action sheet",
  kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
    kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpModalFocusOverlay(progress: Float)"),
);
check(
  "focused live row is measured to the sheet top and rests above the surface without an in-sheet spacer",
  focus.includes("fun updateTargetAboveSheet(") &&
    focus.includes("val finalSheetTop = sheetBoundsOnScreen.top - sheetOffsetYPx.roundToInt()") &&
    focus.includes("val top = finalSheetTop - source.height - gapPx") &&
    focus.includes("KpModalFocusState.updateTargetAboveSheet(") &&
    !focus.includes("KpModalFocusAnchor") &&
    !focus.includes("slotExtra"),
);
check(
  "shared KpSheet registers blur outside ModalBottomSheet content for immediate release on dismissal",
  sharedSheet.includes("containerColor = GlassSheetSurface") &&
    sharedSheet.indexOf("KpRegisterModalBlur()") >= 0 &&
    sharedSheet.indexOf("KpRegisterModalBlur()") < sharedSheet.indexOf("ModalBottomSheet(") &&
    sharedSheet.slice(sharedSheet.indexOf("ModalBottomSheet(")).indexOf("KpRegisterModalBlur()") <
      0 &&
    !sharedSheet.includes("kpGlassSheetModifier") &&
    !sharedSheet.includes("modifier = kpGlassSheetModifier()"),
);
check(
  "country picker, status menu, and emoji picker keep the glass fill and modal blur without a window-sized border",
  login.includes("containerColor = GlassSheetSurface") &&
    login.indexOf("KpRegisterModalBlur()", countryStart) <
      login.indexOf("ModalBottomSheet(", countryStart) &&
    status.includes("containerColor = GlassSheetSurface") &&
    status.indexOf("KpRegisterModalBlur()", statusMenuStart) <
      status.indexOf("ModalBottomSheet(", statusMenuStart) &&
    chat.includes("containerColor = GlassSheetSurface") &&
    chat.indexOf("KpRegisterModalBlur()", emojiStart) <
      chat.indexOf("ModalBottomSheet(", emojiStart) &&
    !login.includes("kpGlassSheetModifier") &&
    !status.includes("kpGlassSheetModifier") &&
    !chat.includes("kpGlassSheetModifier"),
);
check(
  "sheets keep a light dismissal scrim so the strongly blurred backdrop remains visible",
  ui.includes("scrimColor = Color.Black.copy(alpha = 0.10f)") &&
    login.includes("scrimColor = Color.Black.copy(alpha = 0.10f)") &&
    status.includes("scrimColor = Color.Black.copy(alpha = 0.10f)") &&
    chat.includes("scrimColor = Color.Black.copy(alpha = 0.10f)") &&
    status.includes(".background(Color(0x1F000000))") &&
    status.includes(
      "dialogWindow?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)",
    ),
);
check(
  "custom status-viewer sheet and centered delete popup share the glass surface",
  status.includes(".background(GlassSheetSurface)") &&
    status.includes(".border(1.dp, GlassSheetEdge") &&
    ui.includes(".background(GlassSheetSurface)") &&
    ui.includes(".border(1.dp, GlassSheetEdge") &&
    ui.includes("KpRegisterModalBlur()"),
);
check(
  "root update popup and forward-picker footer use the same glass treatment",
  kpApp.includes("KpRegisterModalBlur()") &&
    kpApp.includes("containerColor = GlassSheetSurface") &&
    chat.includes(".background(GlassSheetSurface)") &&
    chat.includes(".border(0.5.dp, GlassSheetEdge)"),
);
check(
  "home nav keeps modal suppression and sets a static real-blur radius on its floating window",
  nav.includes("if (dialogAttached)") &&
    nav.includes("dialogWindowRef[0]?.setWindowAnimations(0)") &&
    !nav.includes("slideProgress") &&
    nav.includes("Dialog(") &&
    nav.includes("WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE") &&
    nav.includes("dialogWindow.setBackgroundBlurRadius(if (blurEnabled) blurRadiusPx else 0)") &&
    kpApp.includes("modalOpen = modalWindowVisible"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
