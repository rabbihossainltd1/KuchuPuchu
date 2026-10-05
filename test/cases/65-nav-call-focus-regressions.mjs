// Latest Android QA: demo icon/indicator, route & call ownership, glass borders,
// prompt modal blur release, and source-matched focus rounding.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${root}/${name}`), "utf8");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const deleteAnim = read("DeleteAnim.kt");
const ui = read("Ui.kt");
const attach = read("AttachSheet.kt");
const kpApp = read("KpApp.kt");
const icon = readFileSync(
  resolve("native-android/app/src/main/res/drawable/ic_nav_chat.xml"),
  "utf8",
);

const navStart = chatList.indexOf("private fun FloatingBottomNav(");
const navEnd = chatList.indexOf("@Composable\nprivate fun NavItem(", navStart);
const nav = chatList.slice(navStart, navEnd);
const peekStart = chatList.indexOf("private fun PeekAction(");
const peekEnd = chatList.indexOf("\n}", peekStart);
const peekAction = chatList.slice(peekStart, peekEnd);
const attachTileStart = attach.indexOf("private fun AttachTile(");
const attachTile = attach.slice(attachTileStart);
const editButtonStart = attach.indexOf("// Edit (pencil) button");
const editButtonEnd = attach.indexOf("// r66: one long caption pill", editButtonStart);
const editButton = attach.slice(editButtonStart, editButtonEnd);
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
  "the tab highlight is one centered shared pill that slides with the demo's 450ms overshoot",
  nav.includes("val indicatorSize = 40.dp") &&
    nav.includes("val indicatorX by animateDpAsState(") &&
    nav.includes("(itemW + gap) * tab.coerceIn(0, 3).toFloat()") &&
    nav.includes("CubicBezierEasing(0.34f, 1.45f, 0.5f, 1f)") &&
    nav.includes("tween(450, easing = indicatorEasing)") &&
    nav.includes(".offset(x = indicatorX, y = indicatorY)"),
);
check(
  "the pill rises from below whenever shown and reverses downward when hidden",
  nav.includes("val slideProgress = remember { Animatable(1f) }") &&
    nav.includes("targetValue = if (windowVisible) 0f else 1f") &&
    nav.includes("tween(if (windowVisible) 450 else 160, easing = slideEasing)") &&
    nav.includes("translationY = hideDistancePx * slideProgress.value"),
);
check(
  "a native nav Dialog is gated to the home route and hidden during a non-minimized CallGate",
  chatList.includes('val homeRouteActive = currentEntry?.destination?.route == "main"') &&
    chatList.includes(
      "val callFullscreen = CallEngine.instance?.let { it.active != null && !it.minimized } == true",
    ) &&
    chatList.includes("visible = navVisible && homeRouteActive && !callFullscreen") &&
    kpApp.includes("CallGate") &&
    kpApp.includes("callEngine.active != null") &&
    kpApp.includes("callEngine.minimized"),
);
check(
  "the capsule and selected-tab highlight have no borders, while the translucent glass and real window blur remain",
  nav.includes(".background(glassFill)") &&
    nav.includes(".background(indicatorColor)") &&
    nav.includes("dialogWindow.setBackgroundBlurRadius((blurRadiusPx * fraction).roundToInt())") &&
    !nav.includes("glassEdge") &&
    !nav.includes("selectedBorder") &&
    !nav.includes(".border(1.25.dp"),
);
check(
  "sheet action buttons are borderless; selection badges, caption fields, shared sheet rows, and confirm actions keep their intended treatment",
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
  "the selected chat/message overlay stores the source Shape and clips the sharp bitmap with it",
  deleteAnim.includes("val bubbleShapes = mutableMapOf<String, Shape>()") &&
    chat.includes("DeleteGeoms.put(m, it.boundsInWindow(), it.boundsInRoot(), bubbleShape)") &&
    chat.includes(
      "DeleteGeoms.put(m, it.boundsInWindow(), it.boundsInRoot(), RoundedCornerShape(12.dp))",
    ) &&
    chat.includes("DeleteGeoms.put(m, it.boundsInWindow(), it.boundsInRoot(), shape)") &&
    ui.includes("val shape: Shape") &&
    ui.includes(".clip(snapshot.shape)"),
);
check(
  "backdrop blur opens smoothly but snaps clear on sheet dismissal",
  kpApp.includes("animationSpec = if (modalActive) tween(220) else snap()"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
