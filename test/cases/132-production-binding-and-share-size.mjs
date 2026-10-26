import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const gradle = read("native-android/app/build.gradle.kts");
assert(gradle.includes('?: "https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev"'));
assert(!gradle.includes("vintoxbd-comm-core-preview"));
const release = read(".github/workflows/release.yml");
assert(release.includes("-PkpCoreBase=https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev"));
const core = read("native-android/app/src/main/java/app/kuchupuchu/android/VintoxBdCore.kt");
assert(core.includes("prefs.getString(ORIGIN_KEY, null) != base"));
assert(core.includes("if (e.status != 401) throw e"));
assert(core.includes("session(ctx, force = true)"));
const settings = read("native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt");
// r132: the app opens the signed consent link, not the code page.
assert(settings.includes('"https://vintoxbd.online/link/"'));
assert(settings.includes("consentUrl(approval)"));
// Owner 2026-10-25 (item 1): the waiting screen never prints a code again —
// the fallback is the same signed link, copied.
assert(!settings.includes("No browser on this device?"));
assert(!settings.includes("code.chunked(4)"));
// Owner 2026-10-25 (item 8): the waiting card is button-free now — the browser
// opens by itself, so no Copy link / Cancel / Open VintoxBd row is left.
assert(!settings.includes('ActionBtn("Copy link"'));
assert(!settings.includes("Open VintoxBd to approve"));
// Owner 2026-10-26 (item 5): the waiting card stopped shouting — one 15sp
// single-line heading and an 11sp one-line browser hint, never a two-line
// 16sp block.
assert(settings.includes("Finish in the browser"));
assert(settings.includes("maxLines = 1") && settings.includes("softWrap = false"));
assert(!settings.includes("Finish the approval in your browser"));
assert(!settings.includes("Browser didn't open? Tap to open VintoxBd again"));
// ...and a finished link gets its own success screen plus a way back in.
assert(settings.includes("Binding successful"));
// Owner 2026-10-26 (item 1): the success button no longer "opens KuchuPuchu"
// from inside KuchuPuchu — it takes the student to the class the link bought.
assert(!settings.includes('GoldBtn("Open KuchuPuchu"'));
assert(settings.includes('GoldBtn("Open class"'));
// ...and the shared desktop is fitted, because the scaling choice is applied
// AFTER the renderer is attached (attachRemote re-runs init, which reset it).
// Owner 2026-10-26 (item 4): an ACTIVE row never reads "Ringing…" again.
const screens = read("native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt");
assert(
  screens.includes(
    'call.status == "ACTIVE" && (call.connecting || call.startedAt <= 0L) -> "Connecting…"',
  ),
);
const calls = read("native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt");
const attachAt = calls.indexOf("if (remote) engine.attachRemote(this)");
const scalingAt = calls.indexOf("setScalingType(", attachAt);
assert(attachAt > -1 && scalingAt > attachAt);
const manifest = read("native-android/app/src/main/AndroidManifest.xml");
assert(manifest.includes('android:scheme="kuchupuchu" android:host="linked"'));
// Owner 2026-10-25 (item 8): the Profile tab header carries the settings gear.
const profile = read("native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt");
assert(profile.includes('nav.navigate("settings")'));
assert(profile.includes("Icons.Filled.Settings"));
const capture = read("native-android/app/src/main/java/app/kuchupuchu/android/KpScreenCapturer.kt");
assert(capture.includes("wm.maximumWindowMetrics.bounds"));
assert(capture.includes("onCapturedContentResize"));
assert(capture.includes("displayManager.registerDisplayListener"));
assert(capture.includes("displayManager.unregisterDisplayListener"));
assert(capture.includes("resizeTo(actual.first, actual.second)"));
assert(capture.includes("maxOf(sourceWidth, sourceHeight)"));
const screen = read("native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt");
assert(screen.includes("key(remote, pip, fit)"));
assert(screen.includes("if (effSwap) engine.sharing else engine.peerScreen"));
// Owner 2026-10-26 (item 3): the phone stays upright, the whole shared desktop
// is fitted with black bars, nothing is cropped or turned, and there are no
// extra chips. A SurfaceView draws into its own window layer, so a full-bleed
// one must be told it is an overlay BEFORE the surface exists — that flag is
// what makes the picture actually appear.
assert(screen.includes("if (pip || overlay) setZOrderMediaOverlay(true)"));
assert(screen.includes("VideoRenderer(engine, remote = true, fit = true, overlay = true)"));
assert(!screen.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE"));
assert(!screen.includes("ShareChip("));
assert(!screen.includes("graphicsLayer"));
const web = read("web/src/calls/CallStage.tsx");
assert(web.includes("element.videoWidth / element.videoHeight"));
assert(web.includes("onResize={syncSourceAspect}"));
assert(web.includes("call-stage__remote--screen"));
console.log(
  "OK production-bound linking sessions, explicit VX approval URL, code-free waiting screen, profile settings gear, real capture dimensions/rotation, contained shared-screen renderers",
);
