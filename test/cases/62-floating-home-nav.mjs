// Android floating home-nav contract against the standalone navigation demo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chatList = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt"),
  "utf8",
);
const statuses = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt"),
  "utf8",
);
const calls = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt"),
  "utf8",
);
const fabSectionStart = statuses.indexOf("/* The reference keeps the text-status");
const fabSectionEnd = statuses.indexOf("if (composeText)", fabSectionStart);
const statusFabStack = statuses.slice(fabSectionStart, fabSectionEnd);

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "chat badge counts unread visible conversations, not unread message totals",
  chatList.includes(
    'val unreadChats = convs.count { !it.optBoolean("hidden") && it.optInt("unread", 0) > 0 }',
  ),
);
check(
  "chat badge is red, caps at 99+, and bumps when its displayed count changes",
  chatList.includes('badge > 99 -> "99+"') &&
    chatList.includes("Color(0xFFE24B4A)") &&
    chatList.includes("LaunchedEffect(badgeLabel)") &&
    chatList.includes("badgeScale.animateTo(1.2f"),
);
check(
  "nav items expose tab roles, selected state, and unread/new-status descriptions",
  chatList.includes("role = Role.Tab") &&
    chatList.includes("this.selected = selected") &&
    chatList.includes('append(", $badge unread chats")') &&
    chatList.includes('append(", new updates")'),
);
check(
  "page swipes use the reference 70dp / 2:1 thresholds and defer to child gestures",
  chatList.includes("activeTab: Int") &&
    chatList.includes("70.dp.toPx()") &&
    chatList.includes("2f * kotlin.math.abs(dy)") &&
    chatList.includes("childConsumedMovement"),
);
check(
  "nav hides only on consumed list scroll and returns at the top edge",
  chatList.includes("override fun onPostScroll(") &&
    chatList.includes("if (available.y > 0f)") &&
    chatList.includes("if (available.y < 0f)") &&
    chatList.includes("if (acc < -navHidePx) navVisible = false") &&
    chatList.includes("if (acc > navShowPx) navVisible = true"),
);
check(
  "nav and chat FAB follow the reference show/hide offsets",
  chatList.includes("if (navVisible) 74.dp else 2.dp") &&
    chatList.includes("if (visible) 0.dp else 90.dp"),
);
check(
  "chat, status, and calls lists leave safe-area-aware space beneath the floating nav",
  chatList.includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()") &&
    statuses.includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()") &&
    calls.includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()"),
);
check(
  "status text action stacks above the lower-right photo action",
  statusFabStack.includes(".align(Alignment.BottomEnd)") &&
    statusFabStack.indexOf("SmallFloatingActionButton(") >= 0 &&
    statusFabStack.indexOf("androidx.compose.material3.FloatingActionButton(") >
      statusFabStack.indexOf("SmallFloatingActionButton(") &&
    statusFabStack.includes("Modifier.padding(end = 8.dp).size(42.dp)") &&
    statusFabStack.includes("Modifier.size(58.dp)"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
