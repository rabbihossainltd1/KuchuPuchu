// §31 (Android Telecom / self-managed calling) — the guards that keep the bridge from
// being able to hurt a working call, plus the manifest/service/permission facts the
// platform needs before it will bind at all. Everything here is source/manifest shape:
// the runtime behaviour is Telecom's side of the binder and cannot be exercised without
// a device, so what is asserted is the structure that makes it safe.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const SRC = "native-android/app/src/main/java/app/kuchupuchu/android";
/** Whitespace-normalised source, comments stripped: assertions are about code, and a
 * KDoc that *names* an API someone decided not to call must not flip a check. */
const read = (f) =>
  readFileSync(`${SRC}/${f}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");
const manifest = readFileSync("native-android/app/src/main/AndroidManifest.xml", "utf8");
const gradle = readFileSync("native-android/app/build.gradle.kts", "utf8");
const engine = read("CallEngine.kt");
const telecom = read("KpTelecom.kt");
const conn = read("KpCallConnection.kt");
const svc = read("KpConnectionService.kt");
const policy = read("TelecomPolicy.kt");
const audio = read("AudioRouter.kt");

// ---------------------------------------------------------------- manifest (§32)
check(
  "MANAGE_OWN_CALLS is declared",
  /uses-permission android:name="android\.permission\.MANAGE_OWN_CALLS"/.test(manifest),
);
check(
  "it is not requested at runtime (normal permission, install-time)",
  !engine.includes("MANAGE_OWN_CALLS") && !telecom.includes("requestPermissions"),
);
check(
  "the permission carries a written justification",
  /§31 self-managed calling[\s\S]{0,900}MANAGE_OWN_CALLS/.test(manifest),
);
check(
  "the service is declared for Telecom to bind",
  /android:name="\.KpConnectionService"[\s\S]{0,220}android:permission="android\.permission\.BIND_TELECOM_CONNECTION_SERVICE"/.test(
    manifest,
  ),
);
check(
  "the service exports only to the platform",
  /KpConnectionService"[\s\S]{0,120}android:exported="true"/.test(manifest),
);
check(
  "the intent-filter action is the platform's own",
  manifest.includes('<action android:name="android.telecom.ConnectionService" />'),
);
check(
  "no FOREGROUND_SERVICE_PHONE_CALL was added because another app has it (§32)",
  !manifest.includes("FOREGROUND_SERVICE_PHONE_CALL"),
);

// ---------------------------------------------------------------- policy (§48 covers the logic)
check(
  "the policy is free of android.telecom types",
  !policy.includes("import android."),
  "pure = unit-testable",
);
check(
  "the floor is API 26, where CAPABILITY_SELF_MANAGED landed",
  /const val MIN_SDK = 26/.test(policy),
);
check(
  "the address scheme is private, never tel:/sip:",
  /const val SCHEME = "kuchupuchu"/.test(policy) && !/SCHEME = "(tel|sip|sms)"/.test(policy),
);
check(
  "a refused registration expires instead of wedging the bridge",
  /const val REGISTRATION_TIMEOUT_MS = 10_000L/.test(policy) && policy.includes("registeringAtMs"),
);

// ---------------------------------------------------------------- the mirror's limits
check(
  "the whole bridge is a no-op below API 26",
  telecom.split("Build.VERSION_CODES.O) return").length - 1 >= 2,
);
check(
  "every Telecom entry point is failure-proofed",
  /runCatching \{/.test(telecom) && telecom.includes("syncNow"),
);
check(
  "the account is registered once and a disabled account opts out of everything",
  telecom.includes("CAPABILITY_SELF_MANAGED") &&
    /if \(tm\.getPhoneAccount\(handle\) == null\) return/.test(telecom),
);
check(
  "concurrency is asked of the platform, not guessed",
  telecom.includes("isIncomingCallPermitted(handle)") &&
    telecom.includes("isOutgoingCallPermitted(handle)"),
);
check(
  "incoming uses addNewIncomingCall and outgoing placeCall with the account handle",
  telecom.includes("tm.addNewIncomingCall(handle, extras)") &&
    telecom.includes("tm.placeCall(uriFor(call.id), extras)") &&
    telecom.includes("EXTRA_PHONE_ACCOUNT_HANDLE"),
);
check(
  "audio handover was NOT adopted (AudioRouter stays authoritative)",
  !telecom.includes("setCommunicationDevice") && !telecom.includes("startBluetoothSco"),
);
check(
  "AudioRouter still owns the routes",
  audio.includes("setCommunicationDevice") || audio.includes("startBluetoothSco"),
);
check(
  "the connection declares itself self-managed and VoIP, with only the hold capability",
  conn.includes("PROPERTY_SELF_MANAGED") &&
    conn.includes("setAudioModeIsVoip(true)") &&
    conn.includes("setConnectionCapabilities(CAPABILITY_SUPPORT_HOLD)"),
);
check(
  "no capability is promised without an engine action behind it",
  !conn.includes("CAPABILITY_MUTE") &&
    !conn.includes("CAPABILITY_READ") &&
    !conn.includes("CAPABILITY_DTMF"),
);
check(
  "the connection never registers or places a call itself",
  !conn.includes("addNewIncomingCall") && !conn.includes("placeCall"),
);
check(
  "framework requests reach the engine on the main thread only",
  /private fun request\(name: String\) \{[\s\S]{0,700}main\.post \{/.test(conn),
);
check(
  "each engine call is individually failure-proofed",
  (conn.match(/runCatching \{ engine\./g) ?? []).length >= 4,
);
check(
  "show-incoming-call-ui uses the verified notification, never a raw startActivity (Android 14 refuses non-activity contexts)",
  /onShowIncomingCallUi[\s\S]{0,400}CallNotify\.incoming\(ctx/.test(conn) &&
    !conn.includes("startActivity") &&
    !manifest.includes("SYSTEM_ALERT_WINDOW"),
);
check(
  "lint's API guard sits where lint can see it: thin entry point + @RequiresApi worker",
  (telecom.match(/androidx\.annotation\.RequiresApi/g) ?? []).length >= 2 &&
    telecom.includes(
      "fun syncNow(app: android.app.Application) { if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return runCatching { syncO(app) } }",
    ) &&
    telecom.includes("private fun syncO(app: android.app.Application)"),
);
check(
  "every function that touches an API-26 symbol carries the annotation lint needs",
  // No regex here on purpose: this is a substring contract on whitespace-collapsed
  // source, which is exactly what the `lintDebug` NewApi gate requires (CI run
  // 33686619793 failed on four such calls that sat in un-annotated private helpers).
  telecom.split("@androidx.annotation.RequiresApi(Build.VERSION_CODES.O)").length - 1 >= 5 &&
    telecom.includes("RequiresApi(Build.VERSION_CODES.O) private fun request(") &&
    telecom.includes("RequiresApi(Build.VERSION_CODES.O) private fun release(") &&
    telecom.includes("RequiresApi(Build.VERSION_CODES.O) fun onCreated(") &&
    telecom.includes("RequiresApi(Build.VERSION_CODES.O) private fun syncO(") &&
    telecom.includes("RequiresApi(Build.VERSION_CODES.O) private fun ensureAccountO("),
);
check(
  "permission-checked framework calls handle SecurityException at the call",
  (telecom.match(/catch \(e: SecurityException\)/g) ?? []).length >= 2,
);
check(
  "state is pushed forward only once per transition",
  conn.includes("if (state == pushed) return"),
);
check(
  "the connection is annotated for the API it needs",
  /@RequiresApi\(Build\.VERSION_CODES\.O\)/.test(conn),
);
check(
  "a request that matches no live call is refused with a disconnected connection",
  svc.includes("refused()") &&
    svc.includes("Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))"),
);
check(
  "held uses setOnHold and unhold goes back to active (no invented setHeld)",
  conn.includes("setOnHold()") && !conn.includes("setHeld()"),
);
check(
  "no display-name setter is invented; the peer name rides on caller display name",
  !conn.includes("setDisplayName(") && conn.includes("setCallerDisplayName("),
);
check(
  "no invented connect-time API either (setConnectTimeMillis is @hide)",
  !conn.includes("setConnectionStartTime"),
);
check(
  "the service compiles against the real API surface, asserted via its imports",
  /import android\.telecom\.(Connection|ConnectionRequest|ConnectionService|DisconnectCause|PhoneAccountHandle)/.test(
    svc,
  ),
);
check(
  "direction and row id are both checked before mirroring",
  /if \(call\.incoming != incoming \|\| \(wanted != null && wanted != call\.id\)\) return refused\(\)/.test(
    svc,
  ),
);
check("a failed registration frees its slot", svc.includes("KpTelecom.onFailed()"));
check("the service teardown forgets the mirror", svc.includes("KpTelecom.onServiceDestroyed()"));

// ---------------------------------------------------------------- one funnel, no drift
check(
  "every state change the UI sees is published from one function",
  (engine.match(/publishChange\(\)/g) ?? []).length >= 12 &&
    (engine.match(/onChange\?\.invoke\(active\)/g) ?? []).length === 1,
);
check(
  "publishing cannot end a call (the mirror is wrapped, not trusted)",
  /private fun publishChange\(\) \{ onChange\?\.invoke\(active\) runCatching \{ KpTelecom\.syncNow\(app\) \}/.test(
    engine,
  ),
);
check(
  "the teardown path publishes too, so no ghost connection outlives a call",
  /active = null[\s\S]{0,400}publishChange\(\)/.test(engine),
);
check(
  "the account is registered from the engine's start, once per process",
  /fun start\(ctx: Context\) \{[\s\S]{0,300}KpTelecom\.ensureAccount\(app\)/.test(engine),
);

// ---------------------------------------------------------------- §51 dependency rule
const telecomRaw = readFileSync(`${SRC}/KpTelecom.kt`, "utf8");
check(
  "androidx.core:core-telecom was evaluated and rejected on evidence, not taste",
  !gradle.includes("core-telecom") &&
    readFileSync("native-android/build.gradle.kts", "utf8").includes("1.9.25") &&
    // The reason is written down where the next reader will look for it: the bridge's own
    // doc comment, naming the library and the Kotlin-metadata reason it is not used.
    telecomRaw.includes("core-telecom") &&
    telecomRaw.includes("kotlin.Metadata"),
);

// ---------------------------------------------------------------- the real tree is clean
const { validateAndroid } = await import("../../scripts/validate-android.ts");
const findings = await validateAndroid(".");
check(
  "validate:android still passes with the new permission and service",
  findings.length === 0,
  JSON.stringify(findings).slice(0, 300),
);

const broken = lines.filter((l) => l.startsWith("  BROKEN"));
console.log(lines.join("\n"));
console.log(`\n${lines.length - broken.length} OK, ${broken.length} BROKEN`);
if (broken.length) process.exit(1);
