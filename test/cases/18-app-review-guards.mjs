// Android-side guards for the review round (Files/diagnostics/notifications/
// profile/search/share). The Kotlin compiler lives in CI, so these assert on the
// SHAPE of the fix at its call site — a name check alone would pass with the body
// removed, so every rule here pins the code that has to be next to it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(
  new URL("../../native-android/app/src/main/java/app/kuchupuchu/android/", import.meta.url),
);
const kt = (f) => readFileSync(dir + f, "utf8").replace(/\r/g, "");

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );
const has = (src, needle, why) => check(why, src.includes(needle), `missing: ${needle}`);
const lacks = (src, needle, why) => check(why, !src.includes(needle), `unexpected: ${needle}`);

const files = kt("Files.kt");
const diag = kt("KpDiag.kt");
const app = kt("KpApp.kt");
const push = kt("KpPush.kt");
const profile = kt("ProfileScreen.kt");
const newChat = kt("NewChatScreen.kt");
const main = kt("MainActivity.kt");

// ── Files.kt — one hand-off, one file; nothing orphaned; nothing oversized ──
const cacheFn = files.slice(files.indexOf("fun cacheFile"), files.indexOf("fun open("));
check(
  "share files are unique per hand-off",
  cacheFn.includes("System.currentTimeMillis()") && cacheFn.includes("fingerprint(bytes)"),
  cacheFn.slice(0, 60),
);
check(
  "…and the old ones are swept (bounded cacheDir)",
  cacheFn.includes('startsWith("shared_")') && cacheFn.includes("lastModified()"),
  "",
);
// Bounded window from the DEFINITION (the name also appears at its call site,
// which is what made a naive slice empty — and an empty slice passes nothing).
const dlStart = files.indexOf("private fun saveToDownloads");
const dl = files.slice(dlStart, dlStart + 3200);
check(
  "the slice really is the function body",
  dlStart > 0 && dl.includes("fun saveToDownloads") && dl.length > 800,
  `start=${dlStart} len=${dl.length}`,
);
check(
  "Downloads rows get a real mime type",
  dl.includes('MediaStore.Downloads.MIME_TYPE, mimeFor(safe, "")'),
  dl.slice(0, 80),
);
check(
  "a failed open leaves NO 0-byte row",
  dl.includes("ctx.contentResolver.delete(target, null)") && dl.includes("if (input == null)"),
  "",
);
check(
  "API < 29 has its own path (MediaStore.Downloads is 29+)",
  dl.includes("SDK_INT < 29") && dl.includes("getExternalFilesDir"),
  "",
);
const decode = files.slice(files.indexOf("if (bmp == null)"), files.indexOf("var picture = bmp"));
check(
  "the pre-28 fallback samples instead of full-decoding",
  decode.includes("inJustDecodeBounds = true") && decode.includes("inSampleSize = sample"),
  decode.slice(0, 60),
);
const readDoc = files.slice(
  files.indexOf("fun readDocument"),
  files.indexOf("fun readDocument") + 1400,
);
check(
  "readDocument delegates mime (no more audio/mpeg for wav, no image/*)",
  readDoc.includes('mime = mimeFor(name, "")') && !readDoc.includes('"audio/mpeg"'),
  readDoc.slice(0, 60),
);

// ── KpDiag: two threads must not lose a line ────────────────────────────────
has(diag, "private val logLock = Any()", "the push log is a read-modify-write, so it is locked");
check(
  "the lock wraps the whole body",
  diag.indexOf("fun log(ctx: Context, line: String) = synchronized(logLock)") > 0,
  "",
);

// ── KpApp: a failed navigation must not eat the pending chat ────────────────
has(
  app,
  ".onSuccess { MainActivity.pendingChat.value = null }",
  "pending id cleared only after the route took",
);
check(
  "…and not before (order matters, that was the bug)",
  app.indexOf('nav.navigate("chat/$pending")') >= 0 &&
    app.indexOf('nav.navigate("chat/$pending")') <
      app.indexOf("MainActivity.pendingChat.value = null"),
  "",
);

// ── KpPush: the hand-off stays awake; the in-chat test survives a query ─────
has(push, "wakeLock.acquire(6_000L)", "FCM dispatch holds a capped wake lock");
has(push, "setReferenceCounted(false)", "…non-ref-counted, so a stray release cannot throw");
has(push, "if (!wakeLock.isHeld)", "…and never acquired twice");
check(
  "in-chat suppression matches the id boundary, not a bare prefix",
  push.includes('Store.route == "chat/$convoId" || Store.route.startsWith("chat/$convoId?")'),
  "chat/12 must not suppress chat/123",
);

// ── ProfileScreen: blocked comes from the server; save uses the authed client ─
has(profile, 'user?.optBoolean("blocked") == true', "the button starts in the server's state");
has(
  profile,
  'if (!res.has("error")) blocked = !blocked',
  "the flip waits for the write to succeed",
);
lacks(
  profile,
  "java.net.URL(url).openStream()",
  "avatar save goes through Api.download (auth header + timeout)",
);
has(profile, "else Api.download(url)", "…including absolute URLs");

// ── NewChatScreen: cancellation is not an error, and errors are visible ─────
const catchIdx = newChat.indexOf("catch (e: kotlinx.coroutines.CancellationException)");
const errIdx = newChat.indexOf('searchError = "Search failed');
check(
  "a cancelled search is rethrown, not reported",
  catchIdx > 0 && newChat.indexOf("catch (_: Exception)", catchIdx) > catchIdx,
  "cancellation catch must come first",
);
check("a real search failure is surfaced to the user", errIdx > catchIdx, "");
has(newChat, "var searchError by remember", "there is a state to surface it with");

// ── MainActivity: a stale share result cannot answer the wrong caller ──────
has(main, "val gen = ++shareGen", "each share request takes a generation");
has(main, "if (gen == shareGen) cb(code, data)", "…and a superseded callback is dropped");

// ── poll storm: a fixed 2s fallback against a failing API is how a quota
//    problem becomes an outage. The cadence must grow, and back off when told to.
const api = kt("Api.kt");
has(api, "@Volatile private var cooldownUntil = 0L", "Api remembers a server-said-stop");
has(api, "429, 503 -> {", "…from both rate limits and the quota guard");
has(api, 'resp.header("retry-after")?.toLongOrNull()', "…using the header, not a guess");
has(api, "else -> if (resp.isSuccessful) cooldownUntil = 0", "…and cleared by any success");
has(api, "noteBackpressure(resp)", "the hook is inside executeJson, so every call goes through it");
has(api, "object PollCadence", "there is one place that owns the poll gap");
const cadStart = api.indexOf("object PollCadence");
const cad = api.slice(cadStart, cadStart + 900);
check(
  "the cadence object is really in Api.kt",
  cadStart > 0 && cad.includes("fun tick(live: Boolean)"),
  `index=${cadStart}`,
);
check(
  "cadence grows on failure and resets on success",
  cad.includes("fun failed()") &&
    cad.includes("fun succeeded()") &&
    cad.includes("2_000L, 4_000L, 8_000L, 15_000L"),
  cad.slice(0, 60),
);
const list = kt("ChatListScreen.kt");
has(list, "if (Api.inCooldown()) 30_000", "the list loop actually skips ticks while throttled");
has(
  list,
  "Api.PollCadence.tick(KpSocket.userLive())",
  "…and grows its gap when the socket is down",
);
check(
  "…in BOTH of its loops (one wired, one not, would still storm)",
  (list.match(/Api\.PollCadence\.tick/g) || []).length >= 2,
  `${(list.match(/Api\.PollCadence\.tick/g) || []).length} sites`,
);
has(list, "Api.PollCadence.succeeded()", "a good poll clears the penalty");
has(list, "Api.PollCadence.failed()", "…and a bad one starts it");

// ── Phase 2 §11/§40: the outgoing queue must heal itself, not wait for a chat ──
{
  const cache = kt("Cache.kt");
  const flStart = cache.indexOf("suspend fun flushNow");
  const flush = cache.slice(flStart, flStart + 2600);
  check("the outbox owns a real retry state per item", flStart > 0, `index=${flStart}`);
  has(cache, '.put("attempts", 0)', "fresh items start with an attempt counter");
  has(cache, '.put("nextAt", 0L)', "…a next-retry deadline…");
  has(
    cache,
    'item.put("lastErr", err.take(180))',
    "…and the reason it last failed, for scheduled recovery",
  );
  has(
    cache,
    "backoffMs[minOf(n - 1, backoffMs.size - 1)]",
    "backoff is read from the table by attempt count",
  );
  has(cache, "MAX_AUTO", "there is an automatic-retry ceiling");
  has(
    cache,
    "Long.MAX_VALUE / 4",
    "past the ceiling the item WAITS for a trigger — it is not deleted",
  );
  check(
    "a deferred item does not block the ones behind it (old code did `break`)",
    flush.includes('if (!force && item.optLong("nextAt") > System.currentTimeMillis()) continue'),
    flush.slice(0, 80),
  );
  check(
    "…and it still stops walking the queue when the path itself is dead",
    /bump\(clientId, e\.message \?: "network"\)[\s\S]{0,320}?break/.test(flush),
  );
  has(cache, "if (Api.inCooldown()) return", "the queue respects the server's Retry-After");
  has(cache, "if (flushing) return", "two coroutines can still not post the same item twice");
  has(
    cache,
    "catch (e: kotlinx.coroutines.CancellationException)",
    "a cancelled kick rethrows instead of faking a send",
  );
  has(
    cache,
    '.put("clientId", clientId)',
    "queued payloads keep the idempotency key the server dedupes on",
  );
  check(
    "a permanently refused send is reported, not left spinning",
    cache.includes("markDropped(clientId)") &&
      /status in 400\.\.499 && status != 408 && status != 429/.test(cache),
  );
  has(
    cache,
    "${f.name}.tmp",
    "the queue file is replaced atomically (a kill mid-write must not eat it)",
  );
  has(
    cache,
    "if (sent > 0) ScreenStore.pokeInbox()",
    "a healed send repaints the open chat immediately",
  );

  // Triggers: the whole point of the change — flush had exactly one call site.
  has(cache, "fun start(ctx: Context)", "startup arms the queue");
  has(cache, "watchNetwork(ctx)", "…by registering for connectivity…");
  has(cache, "mgr.registerNetworkCallback(req, cb)", "…through the documented callback…");
  has(cache, "override fun onAvailable(network: Network)", "…on the available event…");
  const onAv = cache.slice(
    cache.indexOf("override fun onAvailable(network: Network)"),
    cache.indexOf("override fun onAvailable(network: Network)") + 320,
  );
  check(
    "…which force-flushes (backoff must not outlive an outage)",
    onAv.includes("kick(400, force = true)"),
    onAv.slice(0, 60),
  );
  has(
    cache,
    "kick(backoffMs[0])",
    "the send that just failed is followed by one short-delay retry",
  );
  has(kt("MainActivity.kt"), "Outbox.start(this)", "the app actually starts it");
  const onOpen = kt("Api.kt");
  const oaStart = onOpen.indexOf("override fun onOpen(webSocket: WebSocket, response: Response)");
  check(
    "a socket reconnect (proof the network is back) kicks the queue too",
    onOpen.slice(oaStart, oaStart + 500).includes("Outbox.kick(300, force = true)"),
  );

  const chat = kt("ChatScreen.kt");
  check(
    "the chat force-flushes on open and no longer calls the old fire-and-forget flush",
    chat.includes("Outbox.flushNow(force = true)") && !chat.includes("Outbox.flush()"),
  );
  check(
    "…and marks queue-refused bubbles failed so they stop pretending to send",
    /val refused = Outbox\.droppedIds\(\)[\s\S]{0,400}put\("failed", true\)/.test(chat),
  );
}

// ── §16 push-device lifecycle: sign-out must remove THIS install, no more ─────
{
  const push = kt("KpPush.kt");
  const dStart = push.indexOf("fun deviceId(ctx: Context): String");
  const dev = push.slice(dStart, dStart + 700);
  check(
    "the install id is stable, generated once and kept in prefs",
    dStart > 0 &&
      dev.includes('getString("device_id", null)') &&
      dev.includes('putString("device_id", fresh)'),
    `index=${dStart}`,
  );
  const reg = push.slice(
    push.indexOf("internal fun post(ctx: Context, token: String)"),
    push.indexOf("internal fun post(ctx: Context, token: String)") + 1400,
  );
  check(
    "registration carries the §16 identity fields",
    reg.includes('.put("deviceId", deviceId(app))') &&
      reg.includes('.put("platform", "android")') &&
      reg.includes('.put("appVersion", appVersion(app))'),
    reg.slice(0, 60),
  );
  check(
    "the app version comes from the package, not a BuildConfig that is not generated",
    !push.includes("BuildConfig") && push.includes("getPackageInfo(ctx.packageName, 0)"),
  );
  const settings = kt("SettingsScreen.kt");
  const outStart = settings.indexOf(
    'Api.post(\n                                    "/api/auth/logout"',
  );
  check(
    "logout names the device it is signing out of, in the logout request itself",
    outStart > 0 &&
      settings.slice(outStart, outStart + 320).includes('put("deviceId", KpPush.deviceId(ctx))'),
    `index=${outStart}`,
  );
  check(
    "…and the local FCM cleanup still forgets the accepted token (re-login must re-register)",
    push.includes('remove("registered")') && push.includes("deleteToken()"),
  );
}

process.stdout.write(lines.join("\n") + "\n");
const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
process.exit(broken ? 1 : 0);
