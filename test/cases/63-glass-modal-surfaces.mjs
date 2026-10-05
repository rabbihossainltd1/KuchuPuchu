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
const kpApp = read("KpApp.kt");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "modal glass palette uses a light, theme-aware transparent surface and edge",
  theme.includes("val GlassSheetSurface: Color") &&
    theme.includes("Card.copy(alpha = if (KpThemeMode.darkBlue) 0.90f else 0.92f)") &&
    theme.includes("val GlassSheetEdge: Color"),
);
check(
  "native backdrop blur is applied on Android 12+ and reset when the modal closes",
  ui.includes("Build.VERSION.SDK_INT < Build.VERSION_CODES.S") &&
    ui.includes("window.setBackgroundBlurRadius(blurRadiusPx)") &&
    ui.includes("window.setBackgroundBlurRadius(0)"),
);
check(
  "shared KpSheet uses the reusable glass window, tint, and hairline",
  ui.includes("modifier = kpGlassSheetModifier()") &&
    ui.includes("containerColor = GlassSheetSurface") &&
    ui.includes("KpApplyModalWindowBlur()"),
);
check(
  "country picker, status menu, and emoji picker use the same glass treatment",
  login.includes("modifier = kpGlassSheetModifier()") &&
    login.includes("KpApplyModalWindowBlur()") &&
    status.includes("modifier = kpGlassSheetModifier()") &&
    status.includes("KpApplyModalWindowBlur()") &&
    chat.includes("modifier = kpGlassSheetModifier()") &&
    chat.includes("KpApplyModalWindowBlur()"),
);
check(
  "custom status-viewer sheet and centered delete popup share the glass surface",
  status.includes(".background(GlassSheetSurface)") &&
    status.includes(".border(0.75.dp, GlassSheetEdge") &&
    ui.includes(".background(GlassSheetSurface)") &&
    ui.includes(".border(0.75.dp, GlassSheetEdge") &&
    ui.includes("KpApplyModalWindowBlur()"),
);
check(
  "root update popup and forward-picker footer use the same glass treatment",
  kpApp.includes("KpApplyModalWindowBlur()") &&
    kpApp.includes("containerColor = GlassSheetSurface") &&
    chat.includes(".background(GlassSheetSurface)") &&
    chat.includes(".border(0.5.dp, GlassSheetEdge)"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
