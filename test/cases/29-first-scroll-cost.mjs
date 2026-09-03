// Bug 3: "the first scroll after opening the app is laggy, the second one is smooth."
//
// That asymmetry is the diagnosis: a smooth second pass means the memory cache is doing
// its job, so the cost is in what the FIRST pass pays per row. It was paying two things
// no row needs to pay:
//   * a full-size decode — an 88dp avatar drawn from a 512x512 data-URI decoded (and
//     kept, 1MB each) at 512, and a list of those at once, because `decode()` sampled
//     everything to a single global 1080px ceiling;
//   * a re-encode — `store()` compressed the bitmap it had just decoded back to PNG/JPEG
//     to build the disk tier, i.e. an encoder run per row, on the very first pass, while
//     the user is already scrolling.
//
// The fix is "decode at the size you draw, and cache the bytes you already hold":
// the disk file becomes the source bytes verbatim (they are already compressed, and
// smaller than what we used to write), so every size can decode from the same file at
// its own cost, and `Bitmaps` takes a `maxSide` that `KpAvatar` derives from the box it
// draws into. `BitmapSamplerTest` proves the sampling rule itself on the JVM; this case
// pins the wiring around it, which is where a regression would hide.

import { readFileSync } from "node:fs";

const DIR = "native-android/app/src/main/java/app/kuchupuchu/android";
const TESTS = "native-android/app/src/test/java/app/kuchupuchu/android";
const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);
const flat = (t) => t.replace(/\s+/g, " ");
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");

const ui = read("Ui.kt");
const uiFlat = flat(ui);
const bitmaps = uiFlat.slice(
  uiFlat.indexOf("object Bitmaps {"),
  uiFlat.indexOf("@Composable fun rememberBitmap"),
);

// ------------------------------------------------------------- 1. the decode is sized
{
  check(
    "the sampling rule is a top-level internal function (so the JVM test can reach it)",
    /internal fun bitmapSampleSize\(srcW: Int, srcH: Int, maxSide: Int\): Int/.test(uiFlat),
  );
  check(
    "the first paint path uses the caller's ceiling",
    /fun paint\(url: String\?, maxSide: Int = FULL\): Bitmap\?/.test(bitmaps) &&
      /inSampleSize = bitmapSampleSize\(bounds\.outWidth, bounds\.outHeight, maxSide\)/.test(
        bitmaps,
      ),
  );
  check(
    "the async load path uses it too",
    /fun load\(url: String\?, maxSide: Int = FULL\): Bitmap\?/.test(bitmaps) &&
      (bitmaps.match(/bitmapSampleSize/g) || []).length >= 3,
    String((bitmaps.match(/bitmapSampleSize/g) || []).length),
  );
  check(
    "no global 1080 ceiling survives inside the decode",
    !/while \(side \/ 2 >= 1080\)/.test(ui) && !/inSampleSize = sample\)/.test(ui),
  );
  check(
    "the memory key is per size, so a row's 219px bitmap can never be handed to a viewer",
    /private fun memKey\(url: String, maxSide: Int\): String = if \(maxSide >= FULL\) url else "\$url@\$maxSide"/.test(
      bitmaps,
    ),
  );
  check(
    "…and every cache read/write in the object goes through that key",
    (bitmaps.match(/mem\.get\(url\)|mem\.put\(url,/g) || []).length === 0,
    JSON.stringify(bitmaps.match(/mem\.(get|put)\([^)]*\)/g)?.slice(0, 6)),
  );
  check(
    "the disk file stays content-addressed by URL alone (one file, any size)",
    /private fun fileFor\(url: String\)/.test(bitmaps) &&
      !/fun store\(url: String, maxSide/.test(bitmaps),
  );
  check(
    "the inline-paint guards that keep a 12MP photo off the composition thread are untouched",
    /f\.length\(\) > INLINE_PAINT_MAX_BYTES/.test(bitmaps) &&
      /bounds\.outWidth\.toLong\(\) \* bounds\.outHeight > INLINE_PAINT_MAX_PIXELS/.test(bitmaps),
  );
}

// ---------------------------------------------------- 2. the disk tier stores bytes now
{
  const store = bitmaps.slice(bitmaps.indexOf("private fun store("));
  check(
    "store takes the source bytes, not a bitmap",
    /private fun store\(url: String, bytes: ByteArray\)/.test(store),
  );
  check(
    "and writes them verbatim — no encoder on the first-sight path",
    /it\.write\(bytes\)/.test(store) && !/\.compress\(/.test(store),
  );
  check(
    "load feeds it the bytes it downloaded or decoded, not the pixels it produced",
    /store\(url, bytes\)/.test(bitmaps) &&
      /val bytes = sourceBytes\(url\) \?: return null/.test(bitmaps),
  );
  check(
    "the atomic temp-file + rename + trim discipline is preserved",
    /"\.tmp"/.test(store) && /tmp\.renameTo\(f\)/.test(store) && /trim\(\)/.test(store),
  );
  check(
    "a corrupt disk entry still self-heals (delete, then re-fetch)",
    /f\.delete\(\) \/\/ unreadable entry/.test(bitmaps) ||
      /runCatching \{ f\.delete\(\) \}/.test(bitmaps),
  );
  check(
    "a failed download still cannot crash a frame (runCatching around the source read)",
    /private fun sourceBytes\(url: String\): ByteArray\? = runCatching/.test(bitmaps),
  );
}

// --------------------------------------------------------------- 3. the caller wiring
{
  check(
    "rememberBitmap carries the target through to both tiers",
    /fun rememberBitmap\(url: String\?, maxSidePx: Int = Bitmaps\.FULL\): ImageBitmap\?/.test(
      uiFlat,
    ) &&
      /Bitmaps\.paint\(url, maxSidePx\)/.test(uiFlat) &&
      /Bitmaps\.load\(url, maxSidePx\)/.test(uiFlat),
  );
  check(
    "and its cache keys follow the size, or a size change would be ignored",
    /remember\(url, maxSidePx\)/.test(uiFlat) && /LaunchedEffect\(url, maxSidePx\)/.test(uiFlat),
  );
  const avatar = uiFlat.slice(
    uiFlat.indexOf("fun KpAvatar("),
    uiFlat.indexOf("fun KpAvatar(") + 1200,
  );
  check(
    "KpAvatar computes the device-pixel box it draws into and asks for that",
    /rememberBitmap\(resolved, px\)/.test(avatar) &&
      /val px = \(inner\.value \* LocalDensity\.current\.density\)\.toInt\(\)\.coerceAtLeast\(64\)/.test(
        avatar,
      ),
    avatar.slice(0, 260),
  );
  check(
    "the density is read from the composition (no hardcoded 3x)",
    /import androidx\.compose\.ui\.platform\.LocalDensity/.test(ui),
  );
  check(
    "callers that do not care still get the old ceiling by default",
    /const val FULL = 1080/.test(ui) &&
      (ui.match(/rememberBitmap\((url|dataUrl)\)/g) || []).length >= 1,
  );
}

// ------------------------------------------------------------- 4. the JVM test exists
{
  const t = readFileSync(`${TESTS}/BitmapSamplerTest.kt`, "utf8");
  check(
    "the sampling rule is proven on the JVM, including the property, not just examples",
    /src \/ \(s \* 2\) < max/.test(t) && /s and \(s - 1\) == 0/.test(t),
  );
  check(
    "and it pins the pre-existing 1080 behaviour as a regression case",
    /bitmapSampleSize\(4000, 3000, 1080\)\)\s*\n?\s*assertEquals\(4/.test(
      flat(t).replace(/assertEquals/g, "assertEquals"),
    ) || /assertEquals\(2, bitmapSampleSize\(4000, 3000, 1080\)\)/.test(flat(t)),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
