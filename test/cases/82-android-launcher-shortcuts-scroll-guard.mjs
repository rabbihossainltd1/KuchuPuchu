// Regression contracts for Android launcher shortcuts and gesture-safe chat tail-follow.
import { readFileSync } from "node:fs";

const android = "native-android/app/src/main";
const java = `${android}/java/app/kuchupuchu/android`;
const read = (name) => readFileSync(`${java}/${name}`, "utf8");
const manifest = readFileSync(`${android}/AndroidManifest.xml`, "utf8");
const shortcuts = readFileSync(`${android}/res/xml/shortcuts.xml`, "utf8");
const strings = readFileSync(`${android}/res/values/strings.xml`, "utf8");
const app = read("KpApp.kt");
const mainActivity = read("MainActivity.kt");
const chat = read("ChatScreen.kt");
const camera = read("LauncherCameraScreen.kt");
const policy = read("LauncherShortcutPolicy.kt");
const launcher = read("LauncherShortcuts.kt");
const scrollPolicy = read("ChatScrollPolicy.kt");

const checks = [];
const check = (name, ok) => checks.push({ name, ok });

check(
  "the launcher activity declares Android's shortcut resource with camera, Kuchu AI, and status actions",
  manifest.includes('android:name="android.app.shortcuts"') &&
    manifest.includes('android:resource="@xml/shortcuts"') &&
    shortcuts.includes('android:shortcutId="launcher_camera"') &&
    shortcuts.includes('android:shortcutId="launcher_ai"') &&
    shortcuts.includes('android:shortcutId="launcher_status"') &&
    shortcuts.includes('android:value="camera"') &&
    shortcuts.includes('android:value="ai"') &&
    shortcuts.includes('android:value="status"') &&
    strings.includes('name="shortcut_camera_short"') &&
    strings.includes('name="shortcut_ai_short"') &&
    strings.includes('name="shortcut_status_short"'),
);
check(
  "static shortcut taps are dispatched after login and route to their real app destinations",
  mainActivity.includes("if (intent.action == LauncherShortcuts.ACTION)") &&
    mainActivity.includes("pendingLauncherShortcut.value = it") &&
    app.includes("MainActivity.pendingLauncherShortcut.collect") &&
    app.includes('nav.navigate("launcher-camera")') &&
    app.includes('nav.navigate("status")'),
);
check(
  "Kuchu AI shortcut resolves the signed-in user's actual bot conversation instead of inventing an id",
  app.includes("findKpAiConversationId()") &&
    app.includes('optString("id") == "kp_ai_bot"') &&
    app.includes('Api.get("/api/conversations", force = true)') &&
    app.includes('nav.navigate("chat/$conversationId")'),
);
check(
  "launcher camera requests permission contextually and sends a captured photo into the existing status editor",
  camera.includes("Manifest.permission.CAMERA") &&
    camera.includes("ActivityResultContracts.TakePicture()") &&
    camera.includes("statusPickArg(item)") &&
    camera.includes('nav.navigate("mediaedit/status/0/$routeArg")'),
);
check(
  "chat opens update a private per-account frequency ranking and publish dynamic conversation shortcuts",
  chat.includes(
    "LauncherShortcuts.recordChatOpened(ctx, Store.myId(), convId, rawTitle, otherUserId)",
  ) &&
    chat.includes(
      "LauncherShortcuts.refreshTitle(ctx, Store.myId(), convId, rawTitle, otherUserId)",
    ) &&
    launcher.includes("getSharedPreferences(PREFS, Context.MODE_PRIVATE)") &&
    launcher.includes("historyKey(userId)") &&
    launcher.includes("ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)"),
);
check(
  "dynamic shortcuts rank frequently opened chats, cap the list, and reserve bot actions for their static shortcuts",
  policy.includes("MAX_CHAT_SHORTCUTS = 4") &&
    policy.includes("it.openCount > 0") &&
    policy.includes("filterNot { it.peerUserId in systemBots }") &&
    launcher.includes("LauncherShortcutPolicy.rank(history)"),
);
check(
  "live arrival policy refuses tail-follow during an active user drag or fling",
  scrollPolicy.includes("nearBottom && !scrollInProgress") &&
    chat.includes("ChatScrollPolicy.shouldFollowTail(nearBottom, listState.isScrollInProgress)"),
);
check(
  "typing and AI reveal auto-follow use the same gesture-safe policy while explicit sends remain separate",
  (chat.match(/ChatScrollPolicy\.shouldFollowTail\(/g) || []).length >= 4 &&
    chat.includes(
      "val followLiveArrival = ChatScrollPolicy.shouldFollowTail(nearBottom, listState.isScrollInProgress)",
    ) &&
    chat.includes("forceScroll || (pinned && nearBottom && !listState.isScrollInProgress)"),
);

for (const { name, ok } of checks) console.log(`  ${ok ? "OK     " : "BROKEN "} ${name}`);
const broken = checks.filter(({ ok }) => !ok).length;
console.log(`android shortcuts/scroll guard: ${checks.length - broken} ok / ${broken} broken`);
process.exitCode = broken ? 1 : 0;
