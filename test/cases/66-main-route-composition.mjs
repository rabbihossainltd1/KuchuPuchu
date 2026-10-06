// Regression contracts for the main-route Compose runtime crash and the
// supplied chat glyph. Runtime/device reproduction remains an Android check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt"),
  "utf8",
);
const chatList = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt"),
  "utf8",
);
const focus = fs.readFileSync(
  path.join(root, "native-android/app/src/main/java/app/kuchupuchu/android/KpFocusSheet.kt"),
  "utf8",
);
const build = fs.readFileSync(path.join(root, "native-android/app/build.gradle.kts"), "utf8");
const icon = fs.readFileSync(
  path.join(root, "native-android/app/src/main/res/drawable/ic_nav_chat.xml"),
  "utf8",
);

const callStart = app.indexOf("HomeBottomNavigation(");
const callEnd = app.indexOf("\n        )", callStart);
const rootNavCall = callStart >= 0 && callEnd > callStart ? app.slice(callStart, callEnd) : "";
const homeStart = app.indexOf('composable(\n                    "main",');
const homeEnd = app.indexOf('composable("newchat")', homeStart);
const mainRoute = homeStart >= 0 && homeEnd > homeStart ? app.slice(homeStart, homeEnd) : "";
const navStart = chatList.indexOf("internal fun HomeBottomNavigation(");
const navEnd = chatList.indexOf("@Composable\nprivate fun NavItem(", navStart);
const nav = navStart >= 0 && navEnd > navStart ? chatList.slice(navStart, navEnd) : "";
const lines = [];
const check = (name, ok) => lines.push(`  ${ok ? "OK     " : "BROKEN "}  ${name}`);

check(
  "tab and unread/status changes are observed by the floating-pill scope, not KpApp's animated NavHost",
  rootNavCall.includes("selectedTab = homeTab") &&
    !rootNavCall.includes("tab = homeTab.intValue") &&
    !rootNavCall.includes("unreadChats = ScreenStore.convs") &&
    !rootNavCall.includes("unseenStatus = ScreenStore.statuses") &&
    nav.includes("val tab = selectedTab.intValue") &&
    nav.includes("val unreadChats = ScreenStore.convs.count") &&
    nav.includes("val unseenStatus = ScreenStore.statuses.any"),
);
check(
  "home remains stationary and chat entry uses the softened, short-distance route transition",
  mainRoute.includes('"main"') &&
    mainRoute.includes("enterTransition = { EnterTransition.None }") &&
    mainRoute.includes("exitTransition = { ExitTransition.None }") &&
    app.includes('"chat/{id}"') &&
    app.includes("fadeIn(tween(210, easing = FastOutSlowInEasing))") &&
    app.includes("slideInHorizontally(tween(210, easing = FastOutSlowInEasing)) { it / 20 }") &&
    app.includes("slideInHorizontally(tween(260))") &&
    app.includes("slideOutHorizontally(tween(260))"),
);
check(
  "the live focused row stays composed in its source slot and replays one graphics layer, with no bitmap or duplicate content",
  focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    focus.includes("focusLayer?.record") &&
    focus.includes("drawLayer(item.graphicsLayer)") &&
    focus.includes("content(requestFocus)") &&
    focus.includes("LocalPinnableContainer.current") &&
    focus.includes("KpModalFocusState.beginReturn()") &&
    !focus.includes("movableContentOf") &&
    !focus.includes("item.content()") &&
    !focus.includes("PixelCopy") &&
    !focus.includes("captureToImage") &&
    !focus.includes("duplicateContent"),
);
check(
  "Compose 1.11.3 baseline is restored to isolate #1101; #1100 avoids movable-content transfer",
  build.includes('val kpComposeBomVersion = "2026.06.00"') &&
    build.includes('platform("androidx.compose:compose-bom:$kpComposeBomVersion")') &&
    build.includes("Compose 1.11.3 baseline") &&
    build.includes("compileSdk = 35") &&
    build.includes("targetSdk = 35") &&
    focus.includes("LocalGraphicsContext.current") &&
    focus.includes("createGraphicsLayer()") &&
    !focus.includes("movableContentOf"),
);
check(
  "supplied chat vector stays tintable, outlined, and free of the attached metadata",
  icon.includes('android:strokeWidth="1.6"') &&
    icon.includes('android:strokeLineCap="round"') &&
    icon.includes('android:strokeLineJoin="round"') &&
    icon.includes('android:fillColor="#00000000"') &&
    icon.includes('android:pathData="M3 20l1.3 -3.9') &&
    !icon.includes("c2pa") &&
    !icon.includes("metadata"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
