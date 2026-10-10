// Regression contracts for notification sender avatars, robust home-tab ordering,
// quiet offline status surfaces, and call timer/network recovery behavior.
import { readFileSync } from "node:fs";

const android = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(`${android}/${name}`, "utf8");
const worker = readFileSync("src/worker/index.ts", "utf8");
const notify = read("KpNotify.kt");
const push = read("KpPush.kt");
const api = read("Api.kt");
const nav = read("ChatListScreen.kt");
const engine = read("CallEngine.kt");
const callUi = read("CallScreens.kt");
const status = read("StatusScreens.kt");

const checks = [];
const check = (name, ok) => checks.push({ name, ok });

check(
  "message pushes identify the sender without embedding a private avatar blob",
  worker.includes("fromId: uid,") &&
    worker.includes("Never put\n          // a raw avatar blob in the FCM payload."),
);
check(
  "Android resolves a sender photo through the authenticated privacy-checked API and gives up quickly offline",
  push.includes('Api.getWithin("/api/users/$senderId/avatar", 1_000L)') &&
    push.includes('takeIf { it.startsWith("data:image/") }') &&
    api.includes("fun getWithin(path: String, millis: Long): JSONObject?") &&
    api.includes("callTimeout(millis.coerceAtLeast(1L), TimeUnit.MILLISECONDS)"),
);
check(
  "message notifications use the sender avatar, retain the brand fallback, and attach avatars to MessagingStyle people",
  push.includes("senderAvatar = senderAvatar(data)") &&
    notify.includes("senderAvatar: android.graphics.Bitmap? = null") &&
    notify.includes(".setLargeIcon(senderIcon ?: roundLogo(ctx))") &&
    notify.includes("setIcon(IconCompat.createWithBitmap(it))"),
);
check(
  "bottom-nav rendering follows the stable id list itself and animates sibling placement rather than translating a fixed icon row",
  nav.includes("LazyRow(") &&
    nav.includes("items(items = navOrder, key = { it })") &&
    nav.includes("Modifier.animateItem(") &&
    nav.includes("placementSpec = spring(dampingRatio = 0.84f, stiffness = 620f)") &&
    !nav.includes("HomeNavOrderPolicy.defaultOrder.forEach { itemId ->"),
);
check(
  "network recovery is represented as call state and pauses/resumes elapsed time from the prior value",
  engine.includes("val reconnecting: Boolean = false") &&
    engine.includes("private fun beginReconnecting()") &&
    engine.includes("private fun connectedCallState(cur: CallUi): CallUi") &&
    engine.includes("private val MAX_RECONNECT_DURATION_MS = 45_000L") &&
    engine.includes("delay(MAX_RECONNECT_DURATION_MS)") &&
    engine.includes("cur.startedAt + (now - reconnectStartedAt).coerceAtLeast(0L)") &&
    callUi.includes('call.reconnecting -> "Reconnecting…"') &&
    callUi.includes("remember(callId) { mutableIntStateOf(0) }") &&
    !engine.includes('notify("Reconnecting…")'),
);
check(
  "offline call attempts and exhausted recovery end with an explanation that remains visible after hangup",
  engine.includes("private fun hasValidatedInternet(): Boolean") &&
    engine.includes("private fun enforceCallNetworkState(): Boolean") &&
    engine.includes("private val MAX_PRECONNECT_OFFLINE_MS = 8_000L") &&
    engine.includes("if (enforceCallNetworkState()) return") &&
    engine.includes(
      "override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities)",
    ) &&
    engine.includes('notify("No internet connection. Call ended.")') &&
    engine.includes("private fun endCallForNetworkFailure()") &&
    callUi.includes("if (call == null || engine.minimized)") &&
    callUi.includes("if (toast.isNotBlank()) CallNoticeOverlay(toast)"),
);
check(
  "status feed failures keep the cached feed without adding offline error copy",
  !status.includes("refreshError") &&
    !status.includes("status_refresh_error") &&
    !status.includes("Check your connection and tap to retry") &&
    status.includes("error -> Spacer(Modifier.height(8.dp))"),
);

for (const { name, ok } of checks) console.log(`  ${ok ? "OK     " : "BROKEN "} ${name}`);
const broken = checks.filter(({ ok }) => !ok).length;
console.log(`android notification/call/network: ${checks.length - broken} ok / ${broken} broken`);
process.exitCode = broken ? 1 : 0;
