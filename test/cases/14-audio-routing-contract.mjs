// Call audio routing contract (regression guard for "call audio goes to the
// headset AND the speaker", "the audio button lies / does nothing on video",
// and "a headset plugged in mid-call is ignored").
//
// These are Android-side invariants, and CI has no Android SDK, so the guard
// reads the sources instead of a device: each rule the owner specified has a
// concrete failure mode in the code, and every one of them was real. If someone
// "simplifies" AudioRouter back to one device type, drops the runtime
// permission, or re-adds the video-call gate on hot-plug, this case fails here
// rather than as a bug report from a phone.
//
// native-android/audio-routing.md is the prose version of the same contract.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "native-android", "app", "src", "main");
const kt = (f) => readFileSync(join(SRC, "java", "app", "kuchupuchu", "android", f), "utf8");
const manifest = () => readFileSync(join(SRC, "AndroidManifest.xml"), "utf8");

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
// detail only when it failed: a passing line stays quiet so BROKEN lines stand out
const has = (src, needle, name) =>
  src.includes(needle) ? check(name, true) : check(name, false, `missing: ${needle}`);
const lacks = (src, needle, name) =>
  src.includes(needle) ? check(name, false, `regression: ${needle} is back`) : check(name, true);

function main() {
  const router = kt("AudioRouter.kt");
  const engine = kt("CallEngine.kt");
  const screens = kt("CallScreens.kt");
  const notify = kt("CallNotify.kt");
  const xml = manifest();

  // The enum moved to the router file exactly once: two definitions would not
  // compile, and a leftover in CallEngine is how the two copies drifted apart.
  check(
    "AudioRoute enum declared once, in AudioRouter",
    (router.match(/enum class AudioRoute/g) || []).length === 1 &&
      !engine.includes("enum class AudioRoute"),
  );

  // Contract 1: every accessory profile has to be visible or "external only"
  // silently becomes "phone only".
  for (const t of [
    "TYPE_BLUETOOTH_SCO",
    "TYPE_BLUETOOTH_A2DP",
    "TYPE_BLE_HEADSET",
    "TYPE_BLE_SPEAKER",
    "TYPE_WIRED_HEADSET",
    "TYPE_WIRED_HEADPHONES",
    "TYPE_USB_HEADSET",
    "TYPE_USB_DEVICE",
  ]) {
    has(router, t, `detection covers ${t}`);
  }
  has(
    router,
    "availableCommunicationDevices",
    "31+ unions the framework's communication device list",
  );

  // Contract 1b: exclusivity. A route that is *added* to the loudspeaker rather
  // than *moved off* it is the bug the owner heard.
  has(router, "setCommunicationDevice", "31+ commits one device (exclusive routing)");
  has(router, "clearCommunicationDevice", "teardown releases the committed device");
  has(router, "isSpeakerphoneOn = false", "sub-31 turns the loudspeaker OFF for headset routes");
  has(router, "MODE_IN_COMMUNICATION", "audio mode set for the call");
  has(router, "MODE_NORMAL", "audio mode restored afterwards");

  // Contract 2: BLUETOOTH_CONNECT is the reason Bluetooth used to never engage
  // (SecurityException swallowed by runCatching).
  has(xml, "android.permission.BLUETOOTH_CONNECT", "manifest declares BLUETOOTH_CONNECT");
  has(
    xml,
    'android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30"',
    "legacy BLUETOOTH capped at API 30",
  );
  has(router, "BLUETOOTH_CONNECT", "router checks the grant instead of assuming it");
  has(
    screens,
    "ActivityResultContracts.RequestPermission()",
    "UI asks for the permission at runtime",
  );
  has(
    screens,
    "retryBluetoothRoute",
    "grant re-routes the call instead of leaving it on the phone",
  );
  // Contract 3: SCO is a link, not a flag — selection has to be re-applied when
  // the state arrives, or the call lands back on the phone.
  has(router, "ACTION_SCO_AUDIO_STATE_UPDATED", "SCO state receiver registered");
  has(router, "setBluetoothScoOn(true)", "SCO is switched on, not only started");
  has(router, "startBluetoothSco()", "SCO link requested");
  has(router, "stopBluetoothSco()", "SCO released on teardown");
  has(router, "RECEIVER_NOT_EXPORTED", "receiver uses the exported-flag API on 33+");
  // Media-only A2DP has to be caught, or the button claims a headset that the
  // call never reached.
  has(router, "armScoWatchdog", "SCO gets a grace period before the route is believed");
  has(router, "TYPE_BLE_EARPHONE", "LE Audio earphones count as call-capable Bluetooth");
  has(router, "onNotice", "the fallback is announced instead of silently swallowed");
  has(engine, "AudioRouter.onNotice", "the engine shows that notice to the user");

  // Contract 4: hot-plug must not be gated by call kind (the old video bug).
  has(router, "AudioDeviceCallback", "device add/remove callback registered");
  has(router, "registerAudioDeviceCallback", "callback registered with the AudioManager");
  has(router, "unregisterAudioDeviceCallback", "callback unregistered on teardown");
  // The gate used to sit in the engine's own callback; hot-plug now lives in the
  // router, which must not know about call kinds at all.
  lacks(router, 'kind != "VIDEO"', "no call-kind gate on following a newly connected output");
  lacks(engine, "onOutputsChanged", "the engine's old gated callback stays deleted");
  // An audio call that turns into video has to re-ask for a fallback: the earpiece
  // is wrong once there is a picture on screen.
  const marks = (engine.match(/markVideoRoute\(\)/g) || []).length;
  check("audio→video conversion re-marks the route at every site", marks >= 4, `found ${marks}`);
  has(router, "videoCall", "video calls keep their own fallback (speaker, not earpiece)");

  // Contract 5: ring + ringback follow the route (ALARM stream ignores comms routing).
  const pinned = (notify.match(/setPreferredDevice/g) || []).length;
  check("ring and ringback are both pinned to the call output", pinned >= 2, `found ${pinned}`);
  has(notify, "tonePlaybackDevice", "tones ask the router for the device");
  has(router, "fun tonePlaybackDevice", "router exposes the tone device (incl. pre-answer ring)");

  // Contract 6: the button exists everywhere, cycles, and its icon tells the truth.
  const buttons = (screens.match(/rememberRouteAction\(engine\)/g) || []).length;
  check(
    "audio button present on voice grid, connecting screen and video strip",
    buttons >= 3,
    `found ${buttons}`,
  );
  for (const [route, icon] of [
    ["BLUETOOTH", "Icons.Filled.Bluetooth"],
    ["WIRED", "Icons.Filled.Headset"],
    ["SPEAKER", "Icons.Filled.Speaker"],
    ["EARPIECE", "Icons.Filled.PhoneInTalk"],
  ]) {
    has(screens, icon, `icon for ${route} is ${icon.split(".").pop()}`);
  }
  has(screens, "AudioRouter.next(", "tap steps to the next AVAILABLE output");
  has(router, "fun next(", "router owns the cycle order");
  has(router, "fun label(", "label comes from the router (device name when known)");

  // CallEngine must delegate, not re-implement: duplicated routing is how the
  // two halves disagreed before.
  has(engine, "AudioRouter.begin(", "call start asks the router for a route");
  has(engine, "AudioRouter.end(", "teardown releases the router");
  has(engine, "AudioRouter.apply(", "route changes go through the router");
  lacks(
    engine,
    "getDevices(AudioManager.GET_DEVICES_OUTPUTS)",
    "engine no longer scans devices itself",
  );
  lacks(engine, "startBluetoothSco()", "engine no longer touches SCO directly");

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
