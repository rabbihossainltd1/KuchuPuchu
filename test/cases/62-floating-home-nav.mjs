// Source-contract coverage for the Android home navigation: equal slots, route gating,
// smooth independent motion, and the platform window's real backdrop blur.
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
  "home navigation distributes all four tabs in equal-width slots",
  nav.includes("horizontalArrangement = Arrangement.spacedBy(gap)") &&
    (nav.match(/Modifier\.weight\(1f\)/g) ?? []).length >= 4 &&
    nav.includes("val slotWidth = (maxWidth - capsulePadding * 2 - gap * 3) / 4"),
);
check(
  "selected indicator is centered within the selected slot on the icon baseline",
  nav.includes("val indicatorSize = 40.dp") &&
    nav.includes("capsulePadding + (slotWidth - indicatorSize) * 0.5f") &&
    nav.includes("val indicatorY = capsulePadding + (itemH - indicatorSize) * 0.5f") &&
    nav.includes("animateDpAsState") &&
    nav.includes(".offset(x = indicatorX, y = indicatorY)"),
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
  "bottom-nav route changes use compositor window animations rather than per-frame WindowManager relayouts",
  nav.includes("if (modalOpen)") &&
    nav.includes("dialogAttached = visible") &&
    nav.includes("window.setWindowAnimations(R.style.KpNavWindowAnimations)") &&
    nav.includes("params.y = bottomOffsetPx") &&
    !nav.includes("slideProgress") &&
    !nav.includes("params.y = windowYOffsetPx") &&
    fs
      .readFileSync(
        path.join(root, "native-android/app/src/main/res/anim/kp_nav_enter.xml"),
        "utf8",
      )
      .includes('android:fromYDelta="100%"') &&
    fs
      .readFileSync(path.join(root, "native-android/app/src/main/res/anim/kp_nav_exit.xml"), "utf8")
      .includes('android:toYDelta="100%"'),
);
check(
  "the pill is an explicitly translucent themed window using Android's real rounded background blur API",
  nav.includes("HomeNavPillDialog(") &&
    chatList.includes("Dialog(activityContext, R.style.KpNavDialogTheme)") &&
    chatList.includes("CompositionLocalProvider(LocalContext provides dialog.context)") &&
    nav.includes("R.style.KpNavDialogTheme") &&
    nav.includes("window.setBackgroundDrawable(background)") &&
    nav.includes("params.format = PixelFormat.TRANSLUCENT") &&
    nav.includes("window.setBackgroundBlurRadius(if (blurEnabled) blurRadiusPx else 0)") &&
    nav.includes("rememberCrossWindowBlurEnabled()") &&
    nav.includes("val fallbackFill =") &&
    theme.includes('name="KpNavDialogTheme"') &&
    theme.includes('name="android:windowIsTranslucent">true') &&
    nav.includes("WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE") &&
    nav.includes("WindowManager.LayoutParams.FLAG_DIM_BEHIND.inv()") &&
    app.includes("HomeBottomNavigation("),
);
check(
  "home nav exposes stable tab semantics and the selected tab state",
  nav.includes("onSelect(0)") &&
    nav.includes("onSelect(1)") &&
    nav.includes("onSelect(2)") &&
    nav.includes("onSelect(3)") &&
    chatList.includes("role = Role.Tab") &&
    chatList.includes("this.selected = selected") &&
    chatList.includes("contentDescription = accessibilityLabel"),
);
check(
  "chat overflow action stays above the floating nav reservation",
  chatList.includes("val listBottomPadding = with(LocalDensity.current)") &&
    chatList.includes("110.dp + WindowInsets.navigationBars.getBottom(this).toDp()"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
