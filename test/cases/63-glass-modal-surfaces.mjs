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
    kpApp.includes("30.dp"),
);
check(
  "shared KpSheet uses the translucent glass surface, visible border, and modal blur registration",
  ui.includes("modifier = kpGlassSheetModifier()") &&
    ui.includes("containerColor = GlassSheetSurface") &&
    ui.includes("KpRegisterModalBlur()") &&
    ui.includes("1.dp,\n        GlassSheetEdge"),
);
check(
  "country picker, status menu, and emoji picker use the same glass treatment",
  login.includes("modifier = kpGlassSheetModifier()") &&
    login.includes("KpRegisterModalBlur()") &&
    status.includes("modifier = kpGlassSheetModifier()") &&
    status.includes("KpRegisterModalBlur()") &&
    chat.includes("modifier = kpGlassSheetModifier()") &&
    chat.includes("KpRegisterModalBlur()"),
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
  "home nav is a wider four-button capsule with native backdrop blur that vanishes beneath modal sheets",
  chatList.includes("val itemW = 56.dp") &&
    chatList.includes("val itemH = 44.dp") &&
    chatList.includes('label = "Profile"') &&
    chatList.includes("Icons.Filled.Person") &&
    chatList.includes(
      "dialogWindow.setBackgroundBlurRadius(if (windowVisible) blurRadiusPx else 0)",
    ) &&
    chatList.includes("val windowVisible = visible && !modalOpen") &&
    chatList.includes("alpha = if (modalOpen) 0f else 1f"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
