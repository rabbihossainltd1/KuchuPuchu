// §50's non-Gradle rungs: the validator must catch each class of shipping bug it
// claims to, on fixtures — and the real tree must be clean. A validator nobody
// tests is a validator that quietly passes everything.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndroid } from "../../scripts/validate-android.ts";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

const SRC = `
import android.location.LocationManager
import android.net.ConnectivityManager
import android.os.PowerManager
import okhttp3.OkHttpClient

class MainActivity {
    val cm: ConnectivityManager? = null
    val lm: LocationManager? = null
    val client: OkHttpClient? = null
}

class CallService {
    // android:foregroundServiceType="microphone" in the manifest.
    val wl: PowerManager.WakeLock? = null
    fun types(): String = "microphone"
}
`;

function fixture(manifestBody, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "kpf-"));
  const main = join(root, "native-android/app/src/main");
  mkdirSync(join(main, "java/app/kuchupuchu/android"), { recursive: true });
  mkdirSync(join(main, "res/drawable"), { recursive: true });
  writeFileSync(join(main, "AndroidManifest.xml"), manifestBody);
  writeFileSync(join(main, "java/app/kuchupuchu/android/Sources.kt"), extra.src ?? SRC);
  writeFileSync(join(main, "res/drawable/good_icon.png"), "x");
  writeFileSync(join(root, "native-android/app/build.gradle.kts"), extra.gradle ?? CLEAN_GRADLE);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const CLEAN_GRADLE = `android {
  lint { abortOnError = true }
  dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }
  repositories { mavenCentral() }
}
`;

const HEAD_OK = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
  <application android:allowBackup="false">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
    </activity>
    <service android:name=".CallService" android:exported="false"
        android:foregroundServiceType="microphone" />
  </application>
</manifest>`;

const has = (finds, name) => finds.some((f) => f.check === name);

{
  const f = fixture(HEAD_OK);
  const finds = validateAndroid(f.root);
  check(
    "a well-formed manifest produces no findings",
    finds.length === 0,
    JSON.stringify(finds).slice(0, 200),
  );
  f.cleanup();
}
{
  // Permission declared that nothing justifies.
  const f = fixture(
    HEAD_OK.replace(
      "<application",
      '  <uses-permission android:name="android.permission.SEND_SMS" />\n  <application',
    ),
  );
  check(
    "an unlisted permission is a finding, not a shrug",
    has(validateAndroid(f.root), "permission-justified"),
  );
  f.cleanup();
}
{
  // Listed, but no code uses it: the CI gate has to notice deletions too.
  const f = fixture(HEAD_OK, { src: "class MainActivity\n" });
  const finds = validateAndroid(f.root);
  check(
    "a permission nothing imports is reported",
    has(finds, "permission-justified"),
    JSON.stringify(finds).slice(0, 160),
  );
  f.cleanup();
}
{
  const f = fixture(HEAD_OK.replace(' android:exported="true"', ""));
  check(
    "intent-filter without android:exported is caught",
    has(validateAndroid(f.root), "exported-declared"),
  );
  f.cleanup();
}
{
  const f = fixture(HEAD_OK.replace(".MainActivity", ".GhostActivity"));
  check(
    "a manifest class with no source behind it is caught",
    has(validateAndroid(f.root), "component-exists"),
  );
  f.cleanup();
}
{
  const f = fixture(
    HEAD_OK.replace('<uses-permission android:name="android.permission.WAKE_LOCK" />', "").replace(
      ' android:foregroundServiceType="microphone"',
      "",
    ),
    { src: SRC.replace("import android.os.PowerManager\n", "") },
  );
  const finds = validateAndroid(f.root);
  check(
    "…and a foregroundServiceType is tied to its permission",
    has(finds, "fgs-type") || has(finds, "permission-justified"),
    JSON.stringify(finds).slice(0, 160),
  );
  f.cleanup();
}
{
  const f = fixture(HEAD_OK.replace('android:allowBackup="false"', 'android:allowBackup="true"'));
  check("backup of message data is a finding", has(validateAndroid(f.root), "backup"));
  f.cleanup();
}
{
  const f = fixture(
    HEAD_OK.replace("<application", '  <application android:usesCleartextTraffic="true"'),
  );
  check("cleartext is a finding", has(validateAndroid(f.root), "cleartext"));
  f.cleanup();
}
{
  const f = fixture(HEAD_OK.replace("@mipmap", "@mipmap"), {});
  writeFileSync(join(f.root, "native-android/app/src/main/res/drawable/Bad Name.png"), "x");
  const finds = validateAndroid(f.root);
  check(
    "aapt-invalid resource name is caught",
    has(finds, "resource-name"),
    JSON.stringify(finds).slice(0, 160),
  );
  f.cleanup();
}
{
  const f = fixture(
    HEAD_OK.replace(
      "<application",
      '<uses-permission android:name="android.permission.CAMERA" />\n  <application',
    ),
  );
  writeFileSync(
    join(f.root, "native-android/app/src/main/AndroidManifest.xml"),
    (await import("node:fs"))
      .readFileSync(join(f.root, "native-android/app/src/main/AndroidManifest.xml"), "utf8")
      .replace("<application", '<application android:icon="@drawable/not_there"'),
  );
  check(
    "a missing @drawable referenced by the manifest is caught",
    has(validateAndroid(f.root), "resource-exists"),
  );
  f.cleanup();
}
{
  const f = fixture(HEAD_OK, { gradle: "android { lint { abortOnError = false } }" });
  check("loosening the lint gate fails validation", has(validateAndroid(f.root), "lint-gate"));
  f.cleanup();
}
{
  const f = fixture(HEAD_OK, {
    gradle:
      'dependencies { implementation("com.foo:bar:1.+")\n maven { url = uri("http://repo.example/x") } }',
  });
  const finds = validateAndroid(f.root);
  check(
    "a dynamic version is refused",
    has(finds, "dependency-pinned"),
    JSON.stringify(finds).slice(0, 160),
  );
  check("a plain-http repository is refused", has(finds, "repository-tls"));
  f.cleanup();
}
{
  const finds = validateAndroid(process.cwd());
  check(
    "the real tree passes every check",
    finds.length === 0,
    JSON.stringify(finds).slice(0, 300),
  );
}
{
  const ci = (await import("node:fs")).readFileSync(".github/workflows/ci.yml", "utf8");
  check("CI actually runs the android validator", ci.includes("npm run validate:android"));
  check("CI actually runs the pinned style gate", ci.includes("./scripts/ktlint-check.sh"));
  // Owner round 15 follow-up: the owner's single CI artifact is the DEBUG
  // apk; the release/signing machinery is intentionally out of CI now.
  check(
    "CI builds the debug variant as the single artifact",
    ci.includes("assembleDebug") && !ci.includes("assembleRelease"),
  );
  const sh = (await import("node:fs")).readFileSync("scripts/ktlint-check.sh", "utf8");
  check(
    "the style tool is pinned by version AND checksum (no floating gate)",
    /VER="1\.3\.1"/.test(sh) && /SHA="[0-9a-f]{64}"/.test(sh) && sh.includes("sha256sum -c"),
  );
}

process.stdout.write(lines.join("\n") + "\n");
const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
process.exit(broken ? 1 : 0);
