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
const web = read("web/src/calls/CallStage.tsx");
assert(web.includes("element.videoWidth / element.videoHeight"));
assert(web.includes("onResize={syncSourceAspect}"));
assert(web.includes("call-stage__remote--screen"));
console.log(
  "OK production-bound linking sessions, explicit VX approval URL, real capture dimensions/rotation, contained shared-screen renderers",
);
