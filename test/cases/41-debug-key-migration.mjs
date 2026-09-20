// M4 phase 1 (audit 2026-09-21): the debug signing key moves to CI secret.
//
// CI passes no KP_KEYSTORE_B64, so the committed debug.keystore signs BOTH
// CI APKs (debug + release) — it is the de-facto production key and rotating
// it would force every install to reinstall. Phase 1 teaches gradle to read
// the SAME bytes from KP_DEBUG_KEYSTORE_B64 (CI secret) with the committed
// file as fallback, and prints source+sha256 so continuity is provable:
// after the owner pastes the secret, CI must print the committed file's hash.
// Phase 2 (after owner confirms "added") deletes the file and falls back to
// AGP's default debug key instead. Signatures never change in between.

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const gradle = readFileSync(join(repo, "native-android/app/build.gradle.kts"), "utf8");

check(
  "gradle reads the debug key from KP_DEBUG_KEYSTORE_B64 into build keystores",
  gradle.includes('System.getenv("KP_DEBUG_KEYSTORE_B64")') &&
    gradle.includes('layout.buildDirectory.file("keystores/kp-debug.keystore")'),
);
check(
  "gradle prefers the secret, falls back to the committed file (phase 1), and prints source+sha256",
  gradle.includes('val dbg = kpDebugKeystore ?: file("debug.keystore")') &&
    gradle.includes("kp-debug-keystore source=") &&
    gradle.includes("sha256Hex(dbg)") &&
    gradle.includes("fun sha256Hex(f: File): String"),
);
check(
  "phase 1: the committed file is still the fallback (tracked in git)",
  execSync("git ls-files native-android/app/debug.keystore", { cwd: repo }).toString().trim() ===
    "native-android/app/debug.keystore" &&
    existsSync(join(repo, "native-android/app/debug.keystore")),
);

console.log(lines.join("\n"));
console.log(
  `m4 debug-key-migration-p1: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
