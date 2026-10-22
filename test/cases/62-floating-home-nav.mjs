// Source-contract coverage for the Android home navigation: equal slots, route gating,
// smooth independent motion, and a translucent native-blur surface when supported.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const chatList = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt"),
  "utf8",
);
const app = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt"),
  "utf8",
);
const theme = fs.readFileSync(
  path.join(root, "native-android/app/src/main/res/values/themes.xml"),
  "utf8",
);
const navPolicy = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/HomeNavOrderPolicy.kt"),
  "utf8",
);
const navPolicyTest = fs.readFileSync(
  path.join(
    root,
    "native-android/app/src/test/java/app/kuchupuchu/android/HomeNavOrderPolicyTest.kt",
  ),
  "utf8",
);
const navEnter = fs.readFileSync(
  path.join(root, "native-android/app/src/main/res/anim/kp_nav_enter.xml"),
  "utf8",
);
const navExit = fs.readFileSync(
  path.join(root, "native-android/app/src/main/res/anim/kp_nav_exit.xml"),
  "utf8",
);
const navStart = chatList.indexOf("internal fun HomeBottomNavigation(");
const navEnd = chatList.indexOf("@Composable\nprivate fun NavItem(", navStart);
const nav = navStart >= 0 && navEnd > navStart ? chatList.slice(navStart, navEnd) : "";
const rootNavStart = app.indexOf("HomeBottomNavigation(");
const rootNavEnd = app.indexOf("\n    }", rootNavStart);
const rootNav =
  rootNavStart >= 0 && rootNavEnd > rootNavStart ? app.slice(rootNavStart, rootNavEnd) : "";
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "home navigation lays the actual stable-id order into four equal-width slots",
  nav.includes("LazyRow(") &&
    nav.includes("horizontalArrangement = Arrangement.spacedBy(gap)") &&
    nav.includes("items(items = navOrder, key = { it })") &&
    nav.includes(".width(slotWidth)") &&
    nav.includes("val slotWidth = (maxWidth - capsulePadding * 2 - gap * 3) / 4"),
);
check(
  "selected indicator is centered within the selected slot on the icon baseline",
  nav.includes("val indicatorSize = 40.dp * navScale") &&
    nav.includes("capsulePadding + (slotWidth - indicatorSize) * 0.5f") &&
    nav.includes(
      "val indicatorY = capsulePadding + (itemH - indicatorSize) * 0.5f + navContentYOffset",
    ) &&
    nav.includes("val navContentYOffset = 0.dp") &&
    nav.includes("animateDpAsState") &&
    nav.includes(".offset(x = indicatorX, y = indicatorY)"),
);
check(
  'the pill goes a notch smaller (0.9 ≈ 223x50) with contents dead-centred — the 3dp dip was the "nicher dike extra" (owner round 121, 2026-10-22: card onekta boro + nicher dike extra)',
  nav.includes("val navScale = 0.9f") &&
    nav.includes("val navWindowWidth = 248.dp * navScale") &&
    nav.includes("val navWindowHeight = 56.dp * navScale") &&
    nav.includes("val backgroundCardWidth = navWindowWidth") &&
    nav.includes("val backgroundCardHeight = navWindowHeight") &&
    nav.includes("val itemH = 44.dp * navScale") &&
    nav.includes("val indicatorSize = 40.dp * navScale") &&
    nav.includes("val navIconSize = 27.dp") &&
    nav.includes("val navContentYOffset = 0.dp") &&
    nav.includes(".offset(y = navContentYOffset)") &&
    nav.includes("iconSize = navIconSize") &&
    nav.includes("sizeScale = navScale") &&
    nav.includes(".size(backgroundCardWidth, backgroundCardHeight)") &&
    nav.includes("StatusGlyphIcon(tint, navIconSize)"),
);
check(
  "the background card sits 1.5dp below the icon/indicator baseline and carries the frosted-glass treatment itself (owner 2026-10-20)",
  nav.includes("val backgroundCardYOffset = 0.dp") &&
    nav.includes(
      ".align(Alignment.Center)\n                            .offset(y = backgroundCardYOffset)\n                            .size(backgroundCardWidth, backgroundCardHeight)\n                            .clip(CircleShape)\n                            .hazeEffect(state = hazeState) {",
    ) &&
    nav.includes(".offset(y = navContentYOffset)"),
);
check(
  "tab and badge state are read inside the floating-pill scope, not by KpApp's animated NavHost",
  rootNav.includes("selectedTab = homeTab") &&
    !rootNav.includes("tab = homeTab.intValue") &&
    !rootNav.includes("unreadChats = ScreenStore.convs.count") &&
    !rootNav.includes("unseenStatus = ScreenStore.statuses.any") &&
    nav.includes("val tab = selectedTab.intValue") &&
    nav.includes("val unreadChats = ScreenStore.convs.count") &&
    nav.includes("val unseenStatus = ScreenStore.statuses.any"),
);
check(
  "nav visibility is route-gated to the authenticated home route",
  rootNav.includes('visible = authed && actualRoute == "main"') &&
    rootNav.includes("HomeNavState.visible.value") &&
    rootNav.includes("!callFullscreen") &&
    rootNav.includes("!modalWindowVisible"),
);
check(
  "pushed destinations keep the home nav hidden while home tabs keep it visible",
  app.includes('actualRoute == "main"') &&
    app.includes('currentDestination == "chat/{id}"') &&
    app.includes("HomeBottomNavigation(") &&
    chatList.includes('currentEntry?.destination?.route == "main"') &&
    chatList.includes("if (homeRouteActive) HomeNavState.visible.value = true"),
);
check(
  "scroll-to-hide behavior stays limited to the home chat list and resets on tab changes",
  chatList.includes("navHidePx") &&
    chatList.includes("navShowPx") &&
    chatList.includes("if (acc < -navHidePx) navVisible = false") &&
    chatList.includes("else if (acc > navShowPx) navVisible = true") &&
    chatList.includes("LaunchedEffect(tab) { navVisible = true }"),
);
check(
  "chat/status/calls content reserves room for the floating nav and system inset",
  chatList.includes("84.dp else 2.dp") &&
    fs
      .readFileSync(
        path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt"),
        "utf8",
      )
      .includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()") &&
    fs
      .readFileSync(
        path.join(
          root,
          "native-android/app/src/main/java/app/kuchupuchu/android/CallsTabScreen.kt",
        ),
        "utf8",
      )
      .includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()"),
);
check(
  "bottom-nav route changes drive the pill through Compose's compositor (AnimatedVisibility), never a per-frame WindowManager relayout",
  nav.includes("if (modalOpen)") &&
    nav.includes("dialogAttached = visible") &&
    nav.includes("AnimatedVisibility(") &&
    nav.includes("slideInVertically(") &&
    nav.includes("slideOutVertically(") &&
    nav.includes("with(density) { bottomOffsetPx.toDp() }") &&
    !nav.includes("slideProgress") &&
    !nav.includes("params.y = windowYOffsetPx"),
);
check(
  "the nav pill is a translucent frosted card — Haze samples the scaffold's own content on every device, no OS blur begging (owner 2026-10-20)",
  nav.includes("Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter)") &&
    nav.includes("AnimatedVisibility(") &&
    nav.includes("visible = dialogAttached") &&
    nav.includes("val pillBase =") &&
    nav.includes("HazeTint(pillBase.copy(alpha = 0.30f))") && // round 122: real frost again
    nav.includes("blurRadius = 40.dp") &&
    nav.includes("noiseFactor = 0.12f") &&
    nav.includes("fallbackTint = HazeTint(pillBase.copy(alpha = 0.92f))") && // no-RenderEffect devices get solid frost
    !nav.includes(".background(pillFill)") &&
    nav.includes("val navScale = 0.9f") &&
    nav.includes("val navIconSize = 27.dp") &&
    nav.includes(".clip(CircleShape)") &&
    nav.includes(".hazeEffect(state = hazeState)") &&
    !chatList.includes("setBackgroundBlurRadius(") &&
    !chatList.includes("addCrossWindowBlurEnabledListener") &&
    !chatList.includes("HomeNavPillDialog") &&
    chatList.includes("import dev.chrisbanes.haze.hazeEffect") &&
    app.includes("hazeState = homeNavHazeState,"),
);
check(
  "home nav exposes stable tab semantics and follows the selected content tab after reordering",
  nav.includes("onSelect(pageIndex)") &&
    nav.includes(
      "val selectedId = HomeNavOrderPolicy.defaultOrder.getOrElse(tab.coerceIn(0, 3))",
    ) &&
    chatList.includes("role = Role.Tab") &&
    chatList.includes("this.selected = selected") &&
    chatList.includes("contentDescription = accessibilityLabel"),
);
check(
  "long-press horizontal drag reorders stable tab ids and persists the account preference for sync",
  chatList.includes("detectDragGesturesAfterLongPress") &&
    nav.includes("HomeNavOrderPolicy.move(navOrder, itemId, target)") &&
    nav.includes("if (saveOrder) onOrderChanged(navOrder)") &&
    rootNav.includes("onOrderChanged = { order ->") &&
    app.includes('Api.patch("/api/me", JSONObject().put("homeNavOrder", JSONArray(order)))') &&
    app.includes('"_homeNavOrderPending"') &&
    navPolicy.includes('listOf("chats", "status", "calls", "profile")') &&
    navPolicy.includes("fun move(order: List<String>, itemId: String, destination: Int)") &&
    navPolicyTest.includes("HomeNavOrderPolicy.move(") &&
    navPolicyTest.includes("HomeNavOrderPolicy.normalize("),
);
check(
  "dragged tabs alone scale smoothly while stable-key siblings animate into their ordered slots",
  nav.includes("val isMoving = draggingId == itemId || settlingId == itemId") &&
    nav.includes("Modifier.animateItem(") &&
    nav.includes("placementSpec = spring(dampingRatio = 0.84f, stiffness = 620f)") &&
    nav.includes("dragOffsetPx =") &&
    nav.includes("reorderOffsetPx = itemOffsetPx") &&
    nav.includes("settlingOffset.animateTo("),
);
check(
  "the Chats unread badge is red and circular with no outline",
  chatList.includes(".background(Color(0xFFE24B4A))") &&
    !chatList.includes(".border(1.5.dp * sizeScale"),
);
check(
  "chat overflow action stays above the floating nav reservation",
  chatList.includes("val listBottomPadding = with(LocalDensity.current)") &&
    chatList.includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
