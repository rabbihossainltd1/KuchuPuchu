// Regression contracts for per-chat receipts, animated message reactions,
// smooth home-tab reordering, and background launcher unread counts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(resolve(`${base}/${name}`), "utf8");
const chat = read("ChatScreen.kt");
const focus = read("KpFocusSheet.kt");
const nav = read("ChatListScreen.kt");
const store = read("ScreenStore.kt");
const push = read("KpPush.kt");
const notify = read("KpNotify.kt");
const worker = readFileSync(resolve("src/worker/index.ts"), "utf8");
const androidSettings = read("SettingsScreen.kt");
const webSettings = readFileSync(resolve("web/src/auth/AccountSettingsPage.tsx"), "utf8");

const privacyStart = chat.indexOf("private fun ChatPrivacySheet(");
const privacyEnd = chat.indexOf("@Composable\nprivate fun PrivacyToggle(", privacyStart);
const privacy =
  privacyStart >= 0 && privacyEnd > privacyStart ? chat.slice(privacyStart, privacyEnd) : "";
const quickStart = chat.indexOf("private fun MessageQuickReactionBar(");
const quickEnd = chat.indexOf("/** Owner round 16: reaction chips under a bubble.", quickStart);
const quickBar = quickStart >= 0 && quickEnd > quickStart ? chat.slice(quickStart, quickEnd) : "";
const reactionStart = chat.indexOf("private fun MessageReactions(");
const reactionEnd = chat.indexOf("/** Owner round 16/17: the full reaction sheet", reactionStart);
const reactions =
  reactionStart >= 0 && reactionEnd > reactionStart ? chat.slice(reactionStart, reactionEnd) : "";
const navStart = nav.indexOf("internal fun HomeBottomNavigation(");
const navEnd = nav.indexOf("@Composable\nprivate fun NavItem(", navStart);
const navPill = navStart >= 0 && navEnd > navStart ? nav.slice(navStart, navEnd) : "";
const privacyRouteStart = worker.indexOf("const privacyMatch");
const privacyRouteEnd = worker.indexOf("const captureMatch", privacyRouteStart);
const privacyRoute =
  privacyRouteStart >= 0 && privacyRouteEnd > privacyRouteStart
    ? worker.slice(privacyRouteStart, privacyRouteEnd)
    : "";
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "Chat privacy offers exactly one ON/OFF Read receipts switch with no global or three-choice UI",
  privacy.includes('label = "Read receipts"') &&
    privacy.includes("checked = readReceipts") &&
    privacy.includes("onChange = onReadReceipts") &&
    !privacy.includes("ReadReceiptsChoice") &&
    !chat.includes("Use global") &&
    !chat.includes("globalReadReceipts") &&
    !chat.includes("readReceiptsOverride"),
);
check(
  "a receipt toggle writes one boolean to the selected conversation only; unset rows ignore the legacy account value",
  chat.includes('"/api/conversations/$convId/privacy"') &&
    chat.includes('readReceipts?.let { put("readReceipts", it) }') &&
    worker.includes(
      "return member?.priv_read_receipts == null || Number(member.priv_read_receipts) !== 0;",
    ) &&
    privacyRoute.includes('if (typeof body.readReceipts !== "boolean")') &&
    privacyRoute.includes("readReceipts ? 1 : 0") &&
    !worker.includes("readReceipts: Number(row.read_receipts"),
);
check(
  "long-press lifts text messages through an interpolated scale and returns them with the closing focus animation",
  chat.includes('targetScale = if (kind == "TEXT") 1.05f else 1f') &&
    focus.includes("scale = 1f + (item.targetScale - 1f) * t") &&
    focus.includes("focusProgress.animateTo(\n                            1f") &&
    focus.includes("focusProgress.animateTo(\n                        0f") &&
    focus.includes("KpModalFocusState.beginReturn()"),
);
check(
  "the quick-reaction bar is compact and applied reactions have no separate chip surface",
  focus.includes("val floatingBarHeight = 44.dp") &&
    focus.includes("coerceAtMost(292.dp)") &&
    quickBar.includes("fontSize = 20.sp") &&
    reactions.includes("Modifier.offset(y = (-5).dp)") &&
    !reactions.includes(".background(") &&
    !reactions.includes(".border("),
);
check(
  "bottom-nav hold enlarges only the held item; stable-key siblings animate into actual reordered slots",
  navPill.includes("items(items = navOrder, key = { it })") &&
    navPill.includes("val isMoving = draggingId == itemId || settlingId == itemId") &&
    navPill.includes("Modifier.animateItem(") &&
    navPill.includes("reorderOffsetPx = itemOffsetPx") &&
    navPill.includes("settlingOffset.animateTo(") &&
    nav.includes("targetValue = if (isDragging) 1.06f else 1f") &&
    nav.includes('label = "navHoldScale"') &&
    nav.includes("translationX = reorderOffsetPx"),
);
check(
  "Chats nav unread badge has no outline",
  nav.includes(".background(Color(0xFFE24B4A))") && !nav.includes(".border(1.5.dp * sizeScale"),
);
check(
  "background pushes carry the total unread-message count to app and system-drawn notifications",
  worker.includes(
    "SELECT COALESCE(SUM(unread), 0) AS unread_total FROM members WHERE user_id = ?",
  ) &&
    worker.includes("unreadTotal: String(unreadTotal)") &&
    worker.includes("notification_count: notificationCount") &&
    push.includes('data["unreadTotal"]?.toIntOrNull()') &&
    push.includes("unreadMessages = unreadMessages") &&
    notify.includes(".setNumber(unreadMessages.coerceAtLeast(0))") &&
    notify.includes("unreadMessages: Int = ScreenStore.totalUnreadMessages()") &&
    notify.includes("setShowBadge(true)") &&
    store.includes("fun totalUnreadMessages(): Int") &&
    store.includes('.sumOf { it.optInt("unread", 0).coerceAtLeast(0) }') &&
    !store.includes('filterNot { it.optBoolean("hidden", false) }'),
);
check(
  "the old account-wide receipt controls are absent from Android and web settings",
  !androidSettings.includes('"Read receipts"') &&
    !webSettings.includes("Read receipts") &&
    !worker.includes("readReceipts: Number(row.read_receipts"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
