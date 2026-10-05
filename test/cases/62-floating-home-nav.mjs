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
const profile = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt"),
  "utf8",
);
const kpApp = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt"),
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
  "wider, slightly thicker four-button nav has stable four-way spacing and FAB clearance",
  chatList.includes("val itemW = 56.dp") &&
    chatList.includes("val itemH = 44.dp") &&
    chatList.includes("val gap = 4.dp") &&
    chatList.includes("val capsulePadding = 6.dp") &&
    chatList.includes("if (navVisible) 84.dp else 2.dp") &&
    chatList.includes("(capsuleHeight + 18.dp).toPx()"),
);
check(
  "profile stays inside the home shell, remains selected there, and returns to Chats without losing the bar",
  chatList.includes('label = "Profile"') &&
    chatList.includes("selected = tab == 3") &&
    chatList.includes("userId = Store.myId()") &&
    chatList.includes("onBack = { tab = 0 }") &&
    chatList.includes("showHomeNav = true") &&
    profile.includes("if (onBack != null) onBack() else nav.popBackStack()") &&
    profile.includes("if (showHomeNav) Modifier.padding(bottom = 72.dp)"),
);
check(
  "unread badge can overhang its tab hit target without being clipped",
  chatList.includes(".offset(x = 6.dp, y = (-8).dp)") &&
    chatList.includes("Do not clip this hit target") &&
    !chatList.includes(".size(width, height)\n            .clip(CircleShape)"),
);
check(
  "all four indicators are centered behind a common 24dp icon slot, including the custom Status glyph",
  chatList.includes("contentAlignment = Alignment.Center") &&
    chatList.includes(
      ".size(40.dp)\n                    .align(Alignment.Center)\n                    .clip(CircleShape)\n                    .background(selectedBackground)\n                    .border(1.25.dp, selectedBorder, CircleShape)",
    ) &&
    chatList.includes("Box(Modifier.size(24.dp))") &&
    chatList.includes("selected = tab == 1") &&
    chatList.includes("StatusGlyphIcon(tint, 24.dp)"),
);
check(
  "the capsule keeps its own visible border and real native background blur",
  chatList.includes(".border(1.5.dp, glassEdge, CircleShape)") &&
    chatList.includes("copy(alpha = 0.54f)"),
);
check(
  "native nav blur is localized when idle and its window is removed behind modal sheets",
  chatList.includes(
    "dialogWindow.setBackgroundBlurRadius(if (windowVisible) blurRadiusPx else 0)",
  ) &&
    chatList.includes("val windowVisible = visible") &&
    chatList.includes("if (!modalOpen) {") &&
    chatList.includes("dialogWindow.decorView.elevation = 0f") &&
    chatList.includes("dialogWindow?.setBackgroundBlurRadius(0)") &&
    chatList.includes(
      "translationY = hideDistancePx * (if (hasEntered) hideProgress else enterOffset.value)",
    ) &&
    chatList.includes("enterOffset.animateTo(0f, tween(380") &&
    chatList.includes("params.windowAnimations = 0") &&
    chatList.indexOf("FloatingBottomNav(") < chatList.indexOf("E2eeRestoreGate()") &&
    !chatList.includes(".shadow("),
);
check(
  "cold-start home and home-pill entrances rise from the bottom with no left/right slide",
  kpApp.includes("enterTransition = { slideInVertically(tween(300)) { it } }") &&
    chatList.includes("enterOffset.animateTo(0f, tween(380") &&
    chatList.includes(
      "translationY = hideDistancePx * (if (hasEntered) hideProgress else enterOffset.value)",
    ),
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
