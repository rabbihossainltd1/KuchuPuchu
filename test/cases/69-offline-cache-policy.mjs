// Offline snapshot, privacy, and polling contracts for the Android client.
import { readFileSync } from "node:fs";

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (name) => readFileSync(`${ANDROID}/${name}`, "utf8");
const cache = read("Cache.kt");
const api = read("Api.kt");
const screenStore = read("ScreenStore.kt");
const chatList = read("ChatListScreen.kt");
const chat = read("ChatScreen.kt");
const statuses = read("StatusScreens.kt");
const calls = read("CallsTabScreen.kt");
const callEngine = read("CallEngine.kt");
const store = read("Store.kt");
const lines = [];
const check = (name, condition) => lines.push(`  ${condition ? "OK     " : "BROKEN "} ${name}`);

check(
  "disk snapshots retain their original freshness across restarts and stay within a 512-file / 64 MiB LRU bound",
  cache.includes('.put("t", savedAt)') &&
    cache.includes('o.optLong("t", f.lastModified())') &&
    cache.includes("MAX_CACHE_SNAPSHOTS = 512") &&
    cache.includes("MAX_CACHE_BYTES = 64L * 1024 * 1024") &&
    cache.includes("files.sortedByDescending { it.lastModified() }") &&
    cache.includes("pruneDisk()"),
);
check(
  "chat headers, status groups, calls and recent messages have bounded persisted offline windows",
  screenStore.includes("take(60)") &&
    screenStore.includes("takeLast(120)") &&
    screenStore.includes("convs.toList().take(200)") &&
    screenStore.includes("calls.toList().take(150)") &&
    screenStore.includes("statuses.toList().take(200)") &&
    cache.includes('path.startsWith("/api/conversations/") -> 30_000L'),
);
check(
  "view-once rows are excluded from both newly written and legacy offline message snapshots",
  cache.includes("private fun offlineSafe(path: String, data: JSONObject)") &&
    cache.includes(
      'row.optBoolean("viewOnce") || row.optJSONObject("meta")?.optBoolean("viewOnce") == true',
    ) &&
    cache.includes("val safe = offlineSafe(p, d)") &&
    screenStore.includes("val safeRows = rows.filterNot {") &&
    screenStore.includes(
      'it.optBoolean("viewOnce") || it.optJSONObject("meta")?.optBoolean("viewOnce") == true',
    ) &&
    screenStore.includes("if (scrubbedViewOnce) persist()"),
);
check(
  "message pages remain network-first and view-once media/call signaling cannot be served from a fresh or stale cache",
  cache.includes('path.contains("/messages") -> 0L') &&
    cache.includes('return !route.startsWith("/api/calls/") || route == "/api/calls/history"') &&
    cache.includes("if (p.isNotBlank() && !shouldPersist(p))") &&
    (callEngine.match(/Api\.get\(icePath, allowCachedFallback = false\)/g) ?? []).length === 2,
);
check(
  "offline snapshots include updated reaction metadata, while sign-out still clears account and cache data",
  screenStore.includes(
    'append(m.optJSONObject("meta")?.optJSONObject("reactions")?.toString().orEmpty())',
  ) &&
    store.includes("Cache.clearDisk()") &&
    screenStore.includes("fun clearAccount()") &&
    screenStore.includes("disk?.delete()"),
);
check(
  "status feeds and conversation details use short reusable TTLs; call history alone gets a 20-second TTL",
  cache.includes('path == "/api/calls/history" -> 20_000L') &&
    cache.includes('path.contains("/api/calls") -> 0L') &&
    cache.includes('path == "/api/statuses" -> 30_000L') &&
    cache.includes('path.startsWith("/api/conversations/") -> 30_000L'),
);
check(
  "foreground safety polls are less chatty without changing immediate push/socket refreshes",
  chatList.includes("now - lastSafetyRefresh >= 12_000") &&
    chat.includes("else 15_000L") &&
    chat.includes("pending.isEmpty()) 30_000L else 15_000L") &&
    chat.includes("refreshMessages(forceNetwork = down)") &&
    statuses.includes("delay(12_000)") &&
    statuses.includes("if (Store.foreground && !Api.inCooldown()) refresh()") &&
    statuses.includes("refresh(force = true)") &&
    calls.includes('Api.get("/api/calls/history", force = forced)'),
);
check(
  "status and chat-header fetches can use persisted fallback while forced status events still revalidate",
  api.includes("if (allowCachedFallback) Cache.peek(key)?.let { return it }") &&
    !statuses.includes("allowCachedFallback = false") &&
    chat.includes('Api.get("/api/conversations/$convId")'),
);

for (const line of lines) console.log(line);
const failures = lines.filter((line) => line.startsWith("  BROKEN")).length;
console.log(`offline cache policy: ${lines.length - failures} ok / ${failures} broken`);
process.exitCode = failures ? 1 : 0;
