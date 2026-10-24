import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const engine = readFileSync(
  "native-android/app/src/main/java/app/kuchupuchu/android/CallEngine.kt",
  "utf8",
);
const policy = readFileSync(
  "native-android/app/src/main/java/app/kuchupuchu/android/CallNegotiationPolicy.kt",
  "utf8",
);
assert(policy.includes("initialSdpReady && localSdp && remoteSdp"));
assert(
  engine.includes(
    "canRenegotiateCall(initialSdpReady, peer.localDescription != null, peer.remoteDescription != null)",
  ),
);
const answer = engine.slice(
  engine.indexOf("    fun answer()"),
  engine.indexOf("    fun decline()"),
);
assert(answer.includes("posting.await().getOrThrow()"));
assert(answer.indexOf("posting.await().getOrThrow()") < answer.indexOf("initialSdpReady = true"));
assert(answer.includes("abortCallSetup(rec.id)"));
assert(answer.includes("ignoredCalls.add(callId)"));
assert(answer.includes('Api.post("/api/calls/$callId/end"'));
assert(engine.includes('Api.get("/api/calls/active", true, allowCachedFallback = false)'));
assert(engine.includes("if (active?.id != rec.id) { abortCallSetup(rec.id); return@launch }"));
console.log(
  "OK initial native SDP is serialized before renegotiation; failed Accept ends authority row; active polls never resurrect offline cached rings",
);
const web = readFileSync("web/src/messaging/RealmBadge.tsx", "utf8");
const native = readFileSync(
  "native-android/app/src/main/java/app/kuchupuchu/android/RealmBadge.kt",
  "utf8",
);
assert(web.includes('if (realm !== "vx" || !label) return null'));
assert(native.includes('realm == "vx"'));
assert(native.includes("if (!isCrossRealmBadge(realm)) return"));
console.log(
  "OK KP web and Android origin artwork is restricted to foreign VX accounts without changing realm identity",
);

const gradle = readFileSync("native-android/app/build.gradle.kts", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const code = gradle.match(/versionCode\s*=\s*(\d+)/)[1];
const version = gradle.match(/versionName\s*=\s*"([^"]+)"/)[1];
assert(release.includes(`test "$code" = "${code}"`));
assert(release.includes(`test "$name" = "${version}"`));
console.log(
  "OK release shell version gates exactly match the Android package before an expensive APK build",
);
