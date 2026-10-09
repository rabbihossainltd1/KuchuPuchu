// Borderless modal surfaces: popup/sheet edges are removed without removing
// outlines from controls inside those surfaces.
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
const viewersSheetStart = status.indexOf("private fun ViewersSheet(");
const viewersSheetEnd = status.indexOf("/**\n * Status clip player", viewersSheetStart);
const viewersSheet = status.slice(viewersSheetStart, viewersSheetEnd);
const quickReactionStart = chat.indexOf("private fun MessageQuickReactionBar(");
const quickReactionEnd = chat.indexOf("/** Owner round 16: reaction chips", quickReactionStart);
const quickReaction = chat.slice(quickReactionStart, quickReactionEnd);
const deleteDialogStart = ui.indexOf("fun KpDeleteDialog(");
const deleteDialogEnd = ui.indexOf("\n@Composable", deleteDialogStart);
const deleteDialog = ui.slice(deleteDialogStart, deleteDialogEnd);

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "shared modal fill remains translucent and theme-aware, with no shared edge color",
  theme.includes("val GlassSheetSurface: Color") &&
    theme.includes("Card.copy(alpha = if (KpThemeMode.darkBlue) 0.76f else 0.80f)") &&
    !theme.includes("GlassSheetEdge"),
);
check(
  "modal blur is reference-counted and releases on Hidden target observation or confirmation, then reacquires if a swipe reverses",
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
    ui.includes("snapshotFlow { sheetState.targetValue }.collect") &&
    ui.includes("if (hasOpened) registration.release()") &&
    ui.includes("KpModalBlurState.unregister()") &&
    ui.includes("internal fun KpRememberModalBottomSheetState(") &&
    kpApp.includes(".blur(modalBlurRadius)") &&
    kpApp.includes("modalBlur.animateTo(30f, tween(260, easing = FastOutSlowInEasing))") &&
    kpApp.includes("modalBlur.animateTo(0f, tween(160, easing = LinearEasing))"),
);
check(
  "focus keeps one Compose subtree in the source slot and replays its recorded layer without bitmap or duplicate content",
  focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    focus.includes("releaseGraphicsLayer(layer)") &&
    focus.includes("layer.record {") &&
    focus.includes("capturePending && layer != null") &&
    focus.includes("drawLayer(item.graphicsLayer)") &&
    focus.includes("content(requestFocus)") &&
    focus.includes("LocalPinnableContainer.current") &&
    focus.includes("pinnableContainer?.pin()") &&
    focus.includes("releasePendingCleanup()") &&
    focus.includes("if (item == null) KpModalFocusState.releasePendingCleanup()") &&
    focus.includes("onDispose") &&
    focus.includes("focusLayer ?: graphicsContext.createGraphicsLayer()") &&
    !focus.includes("Spacer(") &&
    focus.includes("KpModalFocusState.updateSource(key, currentBounds)") &&
    focus.includes("KpModalFocusState.beginReturn()") &&
    focus.includes("KpModalFocusState.clear()") &&
    !focus.includes("movableContentOf") &&
    !focus.includes("item.content()") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("ImageBitmap") &&
    !focus.includes("DeleteAnim.capture(") &&
    !focus.includes("androidx.compose.ui.window.Dialog("),
);
check(
  "root overlay remains sharp and explicitly above the blurred app and focused action sheet",
  kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
    kpApp.indexOf("KpFocusedSheetHost()") &&
    kpApp.indexOf("KpFocusedSheetHost()") < kpApp.indexOf("KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpRootFocusOverlayHost()") &&
    focus.includes("internal fun KpModalFocusOverlay(progress: Float)") &&
    focus.includes("BoxWithConstraints(Modifier.fillMaxSize().zIndex(1f))"),
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
  "shared KpSheet keeps its glass fill and blur registration without adding an outer outline",
  sharedSheet.includes("containerColor = GlassSheetSurface") &&
    sharedSheet.indexOf("KpRegisterModalBlur()") >= 0 &&
    sharedSheet.indexOf("KpRegisterModalBlur()") < sharedSheet.indexOf("ModalBottomSheet(") &&
    !sharedSheet.includes(".border(") &&
    !sharedSheet.includes("kpGlassSheetModifier"),
);
check(
  "country picker, status menu, and emoji picker use the shared borderless sheet surface and blur",
  login.includes("containerColor = GlassSheetSurface") &&
    login.indexOf("KpRegisterModalBlur()", countryStart) <
      login.indexOf("ModalBottomSheet(", countryStart) &&
    status.includes("containerColor = GlassSheetSurface") &&
    status.indexOf("KpRegisterModalBlur()", statusMenuStart) <
      status.indexOf("ModalBottomSheet(", statusMenuStart) &&
    chat.includes("containerColor = GlassSheetSurface") &&
    chat.indexOf("KpRegisterModalBlur()", emojiStart) <
      chat.indexOf("ModalBottomSheet(", emojiStart) &&
    !login.includes("GlassSheetEdge") &&
    !status.includes("GlassSheetEdge") &&
    !chat.includes("GlassSheetEdge"),
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
  "custom status-viewer bottom sheet and centered delete popup retain the fill without an outside stroke",
  viewersSheet.includes(".background(GlassSheetSurface)") &&
    !viewersSheet.includes(".border(") &&
    deleteDialog.includes(".background(GlassSheetSurface)") &&
    !deleteDialog.includes("GlassSheetEdge") &&
    !deleteDialog.includes("BorderStroke(1.dp") &&
    ui.includes("KpRegisterModalBlur()"),
);
check(
  "root update popup and forward-picker footer have no outline while internal choice controls keep theirs",
  kpApp.includes("KpRegisterModalBlur()") &&
    kpApp.includes("containerColor = GlassSheetSurface") &&
    !kpApp.includes("GlassSheetEdge") &&
    chat.includes(
      ".background(GlassSheetSurface)\n                        .padding(horizontal = 16.dp, vertical = 10.dp)",
    ) &&
    !chat.includes("GlassSheetEdge") &&
    chat.includes(".border(1.dp, if (selected) ActionBlue else Line, RoundedCornerShape(11.dp)"),
);
check(
  "floating reaction popup, search results card, and all modal surfaces are borderless without removing inner control outlines",
  !quickReaction.includes(".border(") &&
    chat.includes(
      ".background(GlassSheetSurface)\n                .padding(horizontal = 14.dp, vertical = 6.dp)",
    ) &&
    !chat.includes("GlassSheetEdge") &&
    ui.includes(".border(2.dp, if (also) ActionBlue else Muted") &&
    ui.includes(".border(1.dp, borderColor ?: if (focused) ActionBlue"),
);
check(
  "home nav keeps modal suppression and a translucent floating fill with native background blur",
  nav.includes("if (dialogAttached)") &&
    nav.includes("dialogWindowRef[0]?.setWindowAnimations(0)") &&
    !nav.includes("slideProgress") &&
    nav.includes("Dialog(") &&
    nav.includes("WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE") &&
    nav.includes("copy(alpha = 0.82f)") &&
    chatList.includes("setBackgroundBlurRadius(") &&
    kpApp.includes("modalOpen = modalWindowVisible"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
