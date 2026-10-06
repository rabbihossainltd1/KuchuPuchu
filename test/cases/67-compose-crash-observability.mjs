// Regression contracts for the Compose crash investigation: preserve the full
// throwable chain, identify the exact CI build/device, and retain its R8 map.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const crash = read("native-android/app/src/main/java/app/kuchupuchu/android/KpCrash.kt");
const build = read("native-android/app/build.gradle.kts");
const workflow = read(".github/workflows/ci.yml");
const e2ee = read("native-android/app/src/main/java/app/kuchupuchu/android/E2eeMsg.kt");
const restoreGate = read("native-android/app/src/main/java/app/kuchupuchu/android/E2eeBackup.kt");
const app = read("native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const roamingStart = e2ee.indexOf("private fun restoreRoaming(");
const roamingEnd = e2ee.indexOf("private fun encodeBackup(", roamingStart);
const roaming =
  roamingStart >= 0 && roamingEnd > roamingStart ? e2ee.slice(roamingStart, roamingEnd) : "";
const tryRestoreStart = e2ee.indexOf("fun tryRestore(");
const tryRestoreEnd = e2ee.indexOf("/** The privacy sheet", tryRestoreStart);
const tryRestore =
  tryRestoreStart >= 0 && tryRestoreEnd > tryRestoreStart
    ? e2ee.slice(tryRestoreStart, tryRestoreEnd)
    : "";

check(
  "crash capture retains the complete stack and recursively records causes and suppressed errors",
  !crash.includes("stackTrace.take(28)") &&
    !crash.includes("stackTrace.take(10)") &&
    crash.includes("error.suppressed.take(MAX_SUPPRESSED_PER_THROWABLE)") &&
    crash.includes('error.cause?.let { appendThrowable(it, "caused by", depth + 1) }') &&
    crash.includes("MAX_STACK_FRAMES = 256") &&
    crash.includes("MAX_REPORT_CHARS = 24_000"),
);
check(
  "the crash report identifies app version, CI source SHA, Compose BOM, Android API, and device model",
  crash.includes("BuildConfig.VERSION_NAME") &&
    crash.includes("BuildConfig.VERSION_CODE") &&
    crash.includes("BuildConfig.BUILD_SHA") &&
    crash.includes("BuildConfig.COMPOSE_BOM_VERSION") &&
    crash.includes("Build.VERSION.SDK_INT") &&
    crash.includes("Build.MANUFACTURER") &&
    crash.includes("Build.MODEL") &&
    !crash.includes("readText()?.take(4000)"),
);
check(
  "Gradle embeds CI revision/BOM diagnostics without changing the shipped app version",
  build.includes('buildConfigField("String", "BUILD_SHA"') &&
    build.includes('buildConfigField("String", "COMPOSE_BOM_VERSION"') &&
    build.includes("buildConfig = true") &&
    build.includes("versionCode = 276") &&
    build.includes('versionName = "3.9.199"'),
);
check(
  "release CI retains a build-matched R8 mapping artifact beside the unchanged APK artifact",
  workflow.includes("name: kuchupuchu-apk") &&
    workflow.includes("name: kuchupuchu-r8-mapping") &&
    workflow.includes("native-android/app/build/outputs/mapping/release/mapping.txt") &&
    workflow.includes("retention-days: 30"),
);
check(
  "E2EE restore work stays on IO while Compose-observed restoredNonce is posted to the main looper",
  e2ee.includes("Handler(Looper.getMainLooper()).post { restoredNonce++ }") &&
    (e2ee.match(/notifyRestoredNonceOnMain\(\)/g) ?? []).length === 3 &&
    roaming.includes("notifyRestoredNonceOnMain()") &&
    tryRestore.includes("notifyRestoredNonceOnMain()") &&
    tryRestore.indexOf("notifyRestoredNonceOnMain()") <
      tryRestore.indexOf('Api.request("/api/me"') &&
    !roaming.includes("restoredNonce++") &&
    !tryRestore.includes("restoredNonce++") &&
    restoreGate.includes("withContext(Dispatchers.IO) { E2eeMsg.tryRestore(ctx, pass) }"),
);
check(
  "the authenticated E2EE retry loop and normal polling cadence remain intact",
  app.includes("while (!E2eeMsg.ensureOnce(appCtx))") &&
    app.includes("var waitMs = 2_000L") &&
    app.includes("waitMs = (waitMs * 2).coerceAtMost(30_000L)"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
