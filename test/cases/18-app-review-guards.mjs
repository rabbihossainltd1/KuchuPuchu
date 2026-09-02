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

process.stdout.write(lines.join("\n") + "\n");
const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
process.exit(broken ? 1 : 0);
