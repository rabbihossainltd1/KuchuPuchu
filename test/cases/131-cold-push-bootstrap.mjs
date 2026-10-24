import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../../native-android/app/src/main/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const app = read("java/app/kuchupuchu/android/KpApplication.kt");
const push = read("java/app/kuchupuchu/android/KpPush.kt");
assert(read("AndroidManifest.xml").includes('android:name=".KpApplication"'));
assert(
  app.includes("KpPush.restoreFirebase(this)") && app.includes("KpNotify.ensureChannels(this)"),
);
assert(!app.includes("Api.") && !app.includes("KpPush.boot"));
const restore = push.slice(
  push.indexOf("fun restoreFirebase"),
  push.indexOf("fun hasCachedConfig"),
);
assert(restore.includes("getSharedPreferences") && !restore.includes("Api.get"));
assert(push.includes('private const val CONFIG_KEY = "firebase_public_config_v1"'));
const publicCache = push.slice(push.indexOf("val publicOnly"), push.indexOf("enabled = ok"));
assert(publicCache.includes('put("applicationId"') && publicCache.includes('put("senderId"'));
assert(!publicCache.includes('put("token"') && !publicCache.includes("private_key"));
assert(push.includes("if (enabled || restoreFirebase(ctx)) return true"));
assert(push.includes("wakeLock.acquire(10_000L)") && push.includes("Api.loadToken(this)"));
console.log(
  "OK cold FCM bootstrap: manifest Application, offline public-options restore, channels, no cached secrets, existing bounded handler intact",
);
