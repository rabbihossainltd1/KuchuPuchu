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
  "shared modal state blurs the entire app background at high strength and releases cleanly",
  ui.includes("internal object KpModalBlurState") &&
    ui.includes("fun register()") &&
    ui.includes("fun unregister()") &&
    ui.includes("KpModalBlurState.unregister()") &&
    kpApp.includes(".blur(modalBlurRadius)") &&
    kpApp.includes("30.dp") &&
    kpApp.includes("animationSpec = if (modalActive) tween(220) else snap()"),
);
check(
  "the pressed chat/message crop stays sharp above the app blur and is raised without a drop shadow",
  ui.includes("internal object KpModalFocusState") &&
    ui.includes("DeleteAnim.capture(") &&
    ui.includes("forceFresh = true") &&
    ui.includes("scaleX = 1f + 0.035f * t") &&
    ui.includes("translationY = -with(density) { 8.dp.toPx() } * t") &&
    kpApp.indexOf("Surface(Modifier.fillMaxSize().blur(modalBlurRadius)") <
      kpApp.indexOf("KpModalFocusOverlay(") &&
    kpApp.includes("KpModalFocusState.clear()") &&
    !ui.includes(".shadow("),
);
check(
  "shared KpSheet uses translucent glass without drawing an outline around the full dialog window",
  ui.includes("containerColor = GlassSheetSurface") &&
    ui.includes("KpRegisterModalBlur()") &&
    !ui.includes("kpGlassSheetModifier") &&
    !ui.includes("modifier = kpGlassSheetModifier()"),
);
check(
  "country picker, status menu, and emoji picker keep the glass fill and modal blur without a window-sized border",
  login.includes("containerColor = GlassSheetSurface") &&
    login.includes("KpRegisterModalBlur()") &&
    status.includes("containerColor = GlassSheetSurface") &&
    status.includes("KpRegisterModalBlur()") &&
    chat.includes("containerColor = GlassSheetSurface") &&
    chat.includes("KpRegisterModalBlur()") &&
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
  "home nav native window is removed while any sheet is open, preventing the extra blur box",
  chatList.includes("val modalOpen = KpModalBlurState.isActive") &&
    chatList.includes(
      "val dialogAttached = !modalOpen && (windowVisible || slideProgress.value < 1f)",
    ) &&
    chatList.includes("if (dialogAttached) {") &&
    chatList.includes("val windowVisible = visible") &&
    chatList.includes(
      "dialogWindow.setBackgroundBlurRadius((blurRadiusPx * fraction).roundToInt())",
    ) &&
    chatList.includes(
      "if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) dialogWindow?.setBackgroundBlurRadius(0)",
    ),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
