// §50's "Unit tests" rung and §48's areas, plus the one property the notification-id
// bug broke: the number a card is POSTED with is the number its actions CANCEL with.
// These are source-shape guards — the arithmetic itself is asserted by the Kotlin
// tests in native-android/app/src/test (run by `./gradlew testDebugUnitTest` in CI).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

const ANDROID = "native-android/app";
const read = (p) => readFileSync(p, "utf8");
const main = (f) => read(`${ANDROID}/src/main/java/app/kuchupuchu/android/${f}`);
const ci = read(".github/workflows/ci.yml");
const gradle = read(`${ANDROID}/build.gradle.kts`);
// Whitespace-normalised: prettier re-wraps long shell lines in the workflow, and a
// needle that spans a wrap point is a flake, not a guard.
const ciFlat = ci.replace(/\s+/g, " ");

{
  const step = ci.slice(ci.indexOf("Unit tests + Android lint"));
  check(
    "CI runs the unit tests AND a lint task (§50 rungs, before the build)",
    /testDebugUnitTest/.test(step.slice(0, 600)) && /lintDebug/.test(step.slice(0, 600)),
    step.slice(0, 120),
  );
  check(
    "the lint task runs before the APK builds, so findings are not an afterthought",
    ci.indexOf("Unit tests + Android lint") < ci.indexOf("Build release APK (minify + shrink)"),
  );
  check(
    "round 15: CI builds exactly ONE APK artifact (signed release only)",
    !ci.includes("assembleDebug") && ci.includes("kuchupuchu-apk-release"),
  );
  check(
    "the style gate also lints test sources",
    read("scripts/ktlint-check.sh").includes("app/src/test/java/**/*.kt"),
  );
  check(
    "unit tests use a pinned JUnit (§51: no floating versions)",
    /testImplementation\("junit:junit:4\.13\.2"\)/.test(gradle) && !/junit:[^"]*\+/.test(gradle),
  );
}

{
  const dir = `${ANDROID}/src/test/java/app/kuchupuchu/android`;
  const files = readdirSync(dir).filter((f) => f.endsWith(".kt"));
  check("the module has JVM test sources (it had none)", files.length >= 2, JSON.stringify(files));
  const all = files.map((f) => read(`${dir}/${f}`)).join("\n");
  const tests = (all.match(/@Test\n/g) || []).length + (all.match(/@Test /g) || []).length;
  check("§48 areas are covered by real @Test methods", tests >= 8, `found ${tests}`);
  for (const area of ["waitMs", "rearmOnLoad", "isDue", "messageCard", "MAX_AUTO"]) {
    check(`the tests exercise ${area} (not a copy of it)`, all.includes(area));
  }
  check("the tests assert the post/cancel identity explicitly", /post id and cancel id/i.test(all));
  check(
    "the fixtures are real ids (uuid shape), not toy strings",
    /[0-9a-f]{8}-[0-9a-f]{4}-/.test(all),
  );
}

{
  const notify = main("KpNotify.kt");
  const cache = main("Cache.kt");
  check(
    "the notify path gets its id from the shared function",
    notify.includes("NotifyIds.messageCard(mid, convoId, System.nanoTime())"),
  );
  check(
    "the action receiver gets its id from the SAME function",
    notify.includes('NotifyIds.messageCard(intent.getStringExtra("mid"))'),
  );
  check(
    "no hand-rolled sign-masking id survives next to it (that is what drifted)",
    !/hashCode\(\)\?\.and\(Int\.MAX_VALUE\)/.test(notify) &&
      !/\.hashCode\(\) and Int\.MAX_VALUE/.test(notify),
  );
  check(
    "the queue keeps no private copy of the retry table",
    !cache.includes("private val backoffMs") && !cache.includes("private const val MAX_AUTO"),
  );
  check(
    "…and calls the policy at every one of its four call sites",
    (cache.match(/OutboxPolicy\./g) || []).length === 4,
    String((cache.match(/OutboxPolicy\./g) || []).length),
  );
  const policy = main("OutboxPolicy.kt");
  check(
    "waitMs is total (a 0/negative count cannot index out of bounds)",
    /attempts <= 1 -> backoffMs\[0\]/.test(policy),
  );
  check("parked uses a non-overflowing sentinel", /Long\.MAX_VALUE \/ 4/.test(policy));
  check(
    "the tables the tests pin are the shipped ones",
    /1_500L, 4_000L, 12_000L, 30_000L, 60_000L, 180_000L, 300_000L/.test(policy) &&
      /const val MAX_AUTO = 12/.test(policy),
  );
}

{
  // The api-level check must fire on the exact configuration that shipped: java.time,
  // minSdk 24, no desugaring. A guard that never fails is not a guard.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { validateAndroid } = await import("../../scripts/validate-android.ts");
  const tree = (gradleBody, srcBody) => {
    const root = mkdtempSync(join(tmpdir(), "kpapi-"));
    const main = join(root, "native-android/app/src/main");
    mkdirSync(join(main, "java/app/kuchupuchu/android"), { recursive: true });
    writeFileSync(join(main, "AndroidManifest.xml"), "<manifest><application /></manifest>");
    writeFileSync(join(main, "java/app/kuchupuchu/android/S.kt"), srcBody);
    writeFileSync(join(root, "native-android/app/build.gradle.kts"), gradleBody);
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  };
  const uses = `import java.time.Instant
import java.time.ZoneId
class S { val picker = registerForActivityResult(null); val t = Instant.now() }
`;
  const noDesugar = `android {
  defaultConfig { minSdk = 24 }
  lint { abortOnError = true }
  implementation("androidx.fragment:fragment-ktx:1.8.9")
}
`;
  const withDesugar =
    noDesugar +
    `android {
  compileOptions { isCoreLibraryDesugaringEnabled = true }
  coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
`;
  {
    const t = tree(noDesugar, uses);
    const finds = validateAndroid(t.root);
    check(
      "java.time + minSdk 24 + no desugaring is a finding",
      finds.some((f) => f.check === "api-level"),
      JSON.stringify(finds).slice(0, 160),
    );
    t.cleanup();
  }
  {
    const t = tree(withDesugar, uses);
    const finds = validateAndroid(t.root);
    check(
      "…and the same tree with desugaring enabled is clean",
      !finds.some((f) => f.check === "api-level"),
      JSON.stringify(finds).slice(0, 160),
    );
    t.cleanup();
  }
  {
    const t = tree(noDesugar.replace("fragment-ktx:1.8.9", "fragment-ktx:1.2.5"), uses);
    const finds = validateAndroid(t.root);
    check(
      "an old androidx.fragment under registerForActivityResult is a finding",
      finds.some((f) => /fragment/.test(f.message)),
    );
    t.cleanup();
  }
  {
    const t = tree(
      `android { defaultConfig { minSdk = 26 } lint { abortOnError = true } implementation("androidx.fragment:fragment-ktx:1.8.9") }`,
      uses,
    );
    const finds = validateAndroid(t.root);
    check(
      "minSdk 26 needs no desugaring, so nothing is reported",
      !finds.some((f) => f.check === "api-level"),
      JSON.stringify(finds).slice(0, 120),
    );
    t.cleanup();
  }
  check(
    "CI prints the full lint report when lint fails",
    ciFlat.includes("lint-results") && ciFlat.includes('cat "$1"'),
  );
  check(
    "the app pins the desugaring library like everything else",
    /coreLibraryDesugaring\("com\.android\.tools:desugar_jdk_libs:2\.1\.5"\)/.test(gradle),
  );
  check(
    "the API-27-only frame grab is guarded (it was a silent no-thumbnail)",
    /if \(Build\.VERSION\.SDK_INT >= 27\)/.test(main("AttachSheet.kt")),
  );
  check(
    "Bluetooth probes use the constant set the API documents",
    /BluetoothAdapter\.STATE_CONNECTED/.test(main("AudioRouter.kt")),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
