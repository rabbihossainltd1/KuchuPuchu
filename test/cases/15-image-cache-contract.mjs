// Image/profile cache contract (regression guard for the owner's report:
// "opening a profile loads it again on every app start, and a chat's photos load
// again too — as if nothing was saved locally").
//
// The bytes ARE local in this app: contact avatars live in a per-version prefs
// cache and media urls are content-addressed. What was missing was that the
// DECODED pixels lived only in a memory LRU (dead on every cold start) and the
// one disk cache that existed sat in cacheDir, the directory the system is
// allowed to purge — so every reopen paid a re-decode (or a re-download) and the
// UI showed its "loading" state for it. And the profile snapshot was refused by
// a 45-second TTL, so opening a profile minutes after the last look was a
// network round trip with nothing painted first.
//
// These assertions pin the shape that fixes it. The image side cannot be driven
// from a browser, so the contract is on the sources: no Android SDK in CI means
// the apk job compiles it and this case keeps the design from silently
// regressing back to memory-only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(
  here,
  "..",
  "..",
  "native-android",
  "app",
  "src",
  "main",
  "java",
  "app",
  "kuchupuchu",
  "android",
);
const kt = (f) => readFileSync(join(SRC, f), "utf8");

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );
const has = (src, needle, name) =>
  src.includes(needle) ? check(name, true) : check(name, false, `missing: ${needle}`);
const lacks = (src, needle, name) =>
  src.includes(needle) ? check(name, false, `regression: ${needle} is back`) : check(name, true);

const ui = kt("Ui.kt");
const main = kt("MainActivity.kt");
const cache = kt("Cache.kt");
const profile = kt("ProfileScreen.kt");

// 1. pixels get a disk tier, in filesDir, with our own cap and eviction.
has(ui, "private var dir: java.io.File? = null", "Bitmaps keeps a disk directory");
has(ui, 'ctx.filesDir, "kp-bitmaps"', "the bitmap cache lives in filesDir, not cacheDir");
has(ui, "fun init(ctx: android.content.Context)", "it is initialised once per process");
has(cache, "Bitmaps.init(ctx)", "and from the same place the JSON cache is");
has(ui, "DISK_CAP", "with a size cap we enforce ourselves");
has(ui, "private fun trim()", "and oldest-first eviction");
has(ui, "private fun store(url: String, bmp: Bitmap)", "what we drew is what gets stored");
has(ui, 'f.name + ".tmp"', "writes are staged then renamed (no half file painted)");
has(
  ui,
  "runCatching { f.delete() } // unreadable entry",
  "a corrupt entry re-fetches instead of staying blank",
);

// 2. a cold start paints from that tier instead of showing a loader.
has(
  ui,
  "val state = remember(url) { mutableStateOf(Bitmaps.paint(url)?.asImageBitmap()) }",
  "rows seed from the cache synchronously",
);
has(ui, "fun paint(url: String?): Bitmap?", "the inline path exists");
has(ui, "inJustDecodeBounds = true", "and it checks the size before decoding inline");
has(ui, "INLINE_PAINT_MAX_PIXELS", "so a full-size photo can never be decoded during composition");
has(ui, "INLINE_PAINT_MAX_BYTES", "with a byte ceiling as well");

// 3. Coil's media cache: same treatment, and no pointless revalidation.
// Matched on the code line, not a block slice: the comment above it explains the
// old cacheDir location, and prose must not be able to trip a guard.
const dirLines = main
  .split("\n")
  .filter((l) => l.includes(".directory(") && !l.trim().startsWith("//"));
check(
  "Coil's disk cache points at filesDir",
  dirLines.some((l) => l.includes('filesDir.resolve("kp-image-cache")')),
  dirLines.join(" | "),
);
check(
  "Coil's disk cache is not built on cacheDir",
  !dirLines.some((l) => l.includes("cacheDir")),
  dirLines.join(" | "),
);
has(main, ".respectCacheHeaders(false)", "content-addressed urls are not revalidated on open");
has(main, "if (stale.exists()) stale.deleteRecursively()", "the old cacheDir copy is cleaned up");
has(main, "priority = Thread.MIN_PRIORITY", "off the main thread, so startup does not pay for it");

// 4. profile payload: paint the snapshot, then revalidate — never wait on the net.
has(
  cache,
  'path.contains("/api/users/") -> 24L * 3600_000L',
  "a contact snapshot stays usable across app starts",
);
has(
  profile,
  "mutableStateOf(profileSnapshot(userId))",
  "the profile screen paints the snapshot first",
);
const load = profile.slice(
  profile.indexOf("LaunchedEffect(userId)"),
  profile.indexOf("LaunchedEffect(userId)") + 900,
);
// Both calls must exist and be ordered: comparing indexOf results alone lets an
// absent needle (-1) "win" the comparison, which is how a mutation of exactly
// this line slipped past the first version of this guard.
const cachedAt = load.indexOf('Api.get("/api/users/$userId")');
const forcedAt = load.indexOf('Api.get("/api/users/$userId", true)');
check(
  "the profile load still reads the cache first and then forces",
  cachedAt >= 0 && forcedAt >= 0,
  `cached=${cachedAt} forced=${forcedAt}`,
);
check(
  "the cached read happens BEFORE the forced refresh",
  cachedAt >= 0 && cachedAt < forcedAt,
  "otherwise the first paint waits on the network again",
);
has(
  profile,
  'Api.get("/api/users/$userId", true)',
  "and a forced refresh still runs, so nothing goes stale",
);

process.stdout.write(lines.join("\n") + "\n");
const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
process.exit(broken ? 1 : 0);
