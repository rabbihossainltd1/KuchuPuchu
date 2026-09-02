/**
 * Android manifest / resource / dependency validation (§50's ladder, the rungs the
 * Gradle build does not cover).
 *
 * Why this exists as a repo script instead of "trust the IDE": every check below
 * corresponds to a class of shipping bug that a debug build tolerates and a device
 * or a Play review does not — a component with an intent filter and no `exported`
 * value fails to install on Android 12+, a `foregroundServiceType` without its
 * permission throws SecurityException at runtime, an unjustified permission is a
 * review rejection, a `@drawable/x` that is not in res/ is a build break with a
 * message nobody reads, and a dynamic `+` version is how a working main branch
 * becomes a broken one overnight with nothing to bisect.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Finding = { check: string; message: string };

/**
 * Every permission the manifest may declare, with the evidence that proves it is
 * used. Unlisted permissions are a finding on purpose: the list is the justification
 * record, so adding one means writing down what depends on it (§56: never request an
 * unnecessary permission).
 */
const PERMISSION_EVIDENCE: Record<string, RegExp> = {
  "android.permission.INTERNET": /OkHttp|FirebaseMessaging|kotlinx\.coroutines\.Coroutine/,
  "android.permission.ACCESS_NETWORK_STATE": /ConnectivityManager/,
  "android.permission.CAMERA": /Manifest\.permission\.CAMERA|ImageCapture|MediaRecorder/,
  "android.permission.RECORD_AUDIO": /Manifest\.permission\.RECORD_AUDIO|AudioRecord/,
  "android.permission.MODIFY_AUDIO_SETTINGS": /AudioManager/,
  "android.permission.BLUETOOTH_CONNECT":
    /BluetoothAdapter|setCommunicationDevice|BluetoothHeadset/,
  "android.permission.BLUETOOTH": /startBluetoothSco|BluetoothAdapter|BluetoothHeadset/,
  "android.permission.POST_NOTIFICATIONS": /POST_NOTIFICATIONS|NotificationManagerCompat/,
  "android.permission.VIBRATE": /Vibrator|VibrationEffect|HapticFeedback/,
  "android.permission.ACCESS_FINE_LOCATION": /LocationManager|FusedLocation/,
  "android.permission.ACCESS_COARSE_LOCATION": /LocationManager|FusedLocation/,
  "android.permission.WAKE_LOCK": /PowerManager|WakeLock/,
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS":
    /IGNORE_BATTERY_OPTIMIZATIONS|isIgnoringBatteryOptimizations/,
  "android.permission.RECEIVE_BOOT_COMPLETED": /BOOT_COMPLETED/,
  "android.permission.READ_MEDIA_IMAGES": /MediaStore|READ_MEDIA_IMAGES/,
  "android.permission.READ_MEDIA_VIDEO": /MediaStore|READ_MEDIA_VIDEO/,
  "android.permission.READ_EXTERNAL_STORAGE": /MediaStore|READ_EXTERNAL_STORAGE/,
  "android.permission.USE_FULL_SCREEN_INTENT": /USE_FULL_SCREEN_INTENT|setFullScreenIntent/,
  "android.permission.FOREGROUND_SERVICE":
    /startForegroundService|foregroundServiceType|startForeground\(/,
  "android.permission.FOREGROUND_SERVICE_MICROPHONE": /microphone/,
  "android.permission.FOREGROUND_SERVICE_CAMERA": /camera/,
  "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION": /mediaProjection/,
  "android.permission.MANAGE_OWN_CALLS": /ConnectionService/,
  "android.permission.READ_CALL_LOG": /CallLog|PhoneAccountHandle/,
};

/** Service types and the permission each one requires (Android 14 rule). */
const FGS_TYPES: Record<string, string> = {
  microphone: "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  camera: "android.permission.FOREGROUND_SERVICE_CAMERA",
  mediaProjection: "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
  phoneCall: "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
};

/** Two libraries for the same job is a finding (§51: no duplicate libraries). */
const CONFLICTS: { name: string; group: string; any: RegExp }[] = [
  {
    name: "image loader",
    group: "images",
    any: /com\.github\.bumptech\.glide|io\.coil-kt|com\.facebook\.fresco/,
  },
  { name: "http client", group: "http", any: /com\.squareup\.okhttp3|org\.apache\.httpcomponents/ },
  { name: "json", group: "json", any: /com\.google\.code\.gson|com\.fasterxml\.jackson|org\.json/ },
];

const RES_NAME = /^[a-z0-9][a-z0-9_]*\.[a-z0-9]+$/;
const SRC_EXT = /\.(kt|java|xml)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function validateAndroid(root: string): Finding[] {
  const finds: Finding[] = [];
  const add = (check: string, message: string) => finds.push({ check, message });

  const appDir = join(root, "native-android/app/src/main");
  const manifestPath = join(appDir, "AndroidManifest.xml");
  if (!existsSync(manifestPath)) {
    add("manifest", `no AndroidManifest.xml at ${relative(root, manifestPath)}`);
    return finds;
  }
  const manifest = readFileSync(manifestPath, "utf8");
  const srcFiles = walk(appDir).filter((f) => SRC_EXT.test(f));
  const src = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");

  // 1. permissions must be justified
  const declaredPerms = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  for (const perm of declaredPerms) {
    const evidence = PERMISSION_EVIDENCE[perm];
    if (!evidence) {
      add(
        "permission-justified",
        `${perm}: declared but not in PERMISSION_EVIDENCE — write down what uses it`,
      );
      continue;
    }
    if (!evidence.test(src))
      add("permission-justified", `${perm}: nothing in the sources uses ${evidence}`);
  }

  // 2. exported must be explicit on anything with an intent filter
  const components = [
    ...manifest.matchAll(
      /<(activity|service|receiver|provider)\b([\s\S]*?)\/\s*>|<(activity|service|receiver|provider)\b([\s\S]*?)<\/\3>/g,
    ),
  ];
  for (const m of components) {
    const body = (m[2] ?? m[5] ?? "") + (m[6] ?? "");
    if (!/intent-filter/.test(body)) continue;
    if (!/android:exported="(true|false)"/.test(body)) {
      const name = body.match(/android:name="([^"]+)"/)?.[1] ?? "?";
      add(
        "exported-declared",
        `${name}: has an intent-filter but no explicit android:exported (install fails on API 31+)`,
      );
    }
  }

  // 3. declared classes must exist
  for (const m of manifest.matchAll(/android:name="(\.?[A-Za-z0-9_.]+)"/g)) {
    const raw = m[1]!;
    if (!raw.startsWith(".")) continue; // application / permission / action names
    const cls = raw.slice(1);
    if (!new RegExp(`class ${cls}\\b|object ${cls}\\b`).test(src)) {
      add(
        "component-exists",
        `${raw}: declared in the manifest, no such class/object in the sources`,
      );
    }
  }

  // 4. foregroundServiceType ↔ permission, both directions
  const declaredTypes = new Set<string>();
  for (const m of manifest.matchAll(/android:foregroundServiceType="([^"]+)"/g)) {
    for (const t of m[1]!.split("|").map((s) => s.trim())) {
      declaredTypes.add(t);
      const need = FGS_TYPES[t];
      if (!need) add("fgs-type", `unknown foregroundServiceType "${t}"`);
      else if (!declaredPerms.includes(need))
        add("fgs-type", `foregroundServiceType="${t}" requires ${need}, which is not declared`);
    }
  }
  for (const [t, perm] of Object.entries(FGS_TYPES)) {
    if (declaredPerms.includes(perm) && !declaredTypes.has(t))
      add("fgs-type", `${perm} declared but no service uses foregroundServiceType="${t}"`);
  }

  // 5. backup / cleartext stay off
  if (/android:allowBackup="true"/.test(manifest))
    add("backup", 'allowBackup="true" exports messages and media into adb backup');
  if (/android:usesCleartextTraffic="true"/.test(manifest))
    add("cleartext", "usesCleartextTraffic is on — the API and media URLs are HTTPS-only");

  // 6. resources referenced by the manifest must exist, and names must be aapt-safe
  const resDir = join(appDir, "res");
  const resFiles = walk(resDir);
  const resNames = new Set(
    resFiles.map((f) =>
      f
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, ""),
    ),
  );
  for (const m of manifest.matchAll(/@(drawable|mipmap|xml|raw|style)\/([A-Za-z0-9_.]+)/g)) {
    if (m[1] === "style") continue;
    if (!resNames.has(m[2]!))
      add("resource-exists", `@${m[1]}/${m[2]} referenced by the manifest, not in res/`);
  }
  for (const f of resFiles) {
    const base = f.split("/").pop()!;
    if (!RES_NAME.test(base))
      add("resource-name", `${relative(root, f)}: not a valid resource file name`);
    if (/\.(bak|orig|tmp|rej)$/.test(base))
      add("resource-name", `${relative(root, f)}: junk file in res/`);
  }

  // 7. gradle: pinned versions, TLS repos only, no duplicate-purpose libraries,
  //    and the lint gate cannot be quietly loosened again.
  const gradleFiles = walk(join(root, "native-android")).filter((f) => /\.gradle\.kts$/.test(f));
  const gradle = gradleFiles.map((f) => readFileSync(f, "utf8"));
  gradle.forEach((text, i) => {
    const file = relative(root, gradleFiles[i]!);
    for (const m of text.matchAll(/["']([A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+):([^"']+?)["']/g)) {
      if (/[+]|latest/.test(m[2]!))
        add("dependency-pinned", `${file}: ${m[1]} uses a dynamic version "${m[2]}"`);
    }
    for (const m of text.matchAll(/https?:\/\/[^\s"']+/g)) {
      if (m[0].startsWith("http://"))
        add("repository-tls", `${file}: plain-http repository ${m[0]}`);
    }
  });
  const allGradle = gradle.join("\n");
  for (const c of CONFLICTS) {
    const hits = new Set<string>();
    for (const m of allGradle.matchAll(new RegExp(c.any.source, "g"))) hits.add(m[0]);
    if (hits.size > 1)
      add("no-duplicate-libs", `multiple ${c.name} libraries: ${[...hits].join(", ")}`);
  }
  const appGradle = gradleFiles.findIndex((f) => f.endsWith("app/build.gradle.kts"));
  if (appGradle >= 0) {
    const t = gradle[appGradle]!;
    if (/abortOnError\s*=\s*false/.test(t))
      add(
        "lint-gate",
        "lint { abortOnError = false } — CI would print lint errors and stay green (§50)",
      );
  }

  return finds;
}

function main() {
  const root = process.cwd();
  const finds = validateAndroid(root);
  if (finds.length) {
    console.error(`Android validation failed (${finds.length}):`);
    for (const f of finds) console.error(` - [${f.check}] ${f.message}`);
    process.exit(1);
  }
  console.info("Android validation passed (manifest, resources, dependencies, lint gate).");
}

main();
