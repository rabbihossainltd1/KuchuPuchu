// The release workflow runs the shared browser suites, so it must install their Chromium prerequisite first.
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ciStart = workflow.indexOf("name: Worker and source CI");
const ciEnd = workflow.indexOf("name: Android unit tests and lint", ciStart);
const ciSection = ciStart >= 0 && ciEnd > ciStart ? workflow.slice(ciStart, ciEnd) : "";
const npmCi = ciSection.indexOf("npm ci");
const browserInstall = ciSection.indexOf("npx playwright install --with-deps chromium");
const sharedCi = ciSection.indexOf("npm run ci");

check(
  "release CI installs Chromium after npm ci and before the Playwright suites",
  npmCi >= 0 && browserInstall > npmCi && sharedCi > browserInstall,
  ciSection,
);
check(
  "v279 release stays main-only and requires its explicit signer confirmation",
  workflow.includes("github.ref == 'refs/heads/main'") &&
    workflow.includes("inputs.confirm == 'RELEASE-DEBUG-KEY-V279'"),
);
check(
  "signing continuity is checked against the published v274 APK before publishing v302",
  workflow.includes("gh release download v274") &&
    workflow.includes("kuchupuchu-3.9.197-r104.apk") &&
    workflow.includes("Verify signing continuity with v274") &&
    workflow.includes('test "$code" = "302"') &&
    workflow.includes('test "$name" = "3.9.225"'),
);

// The R2 upload used to be skipped on every release: its own `env:` is applied
// AFTER the step's `if:` is evaluated, so `env.CLOUDFLARE_API_TOKEN` was always
// empty in the condition and the step never ran — the APK in /download/apk
// stayed at whatever the last manual upload was. The Cloudflare values now
// live at JOB level, where the `env` context already carries them when the
// step's condition is evaluated.
const jobEnv = workflow.slice(
  workflow.indexOf("jobs:"),
  workflow.indexOf("steps:", workflow.indexOf("jobs:")),
);
const r2Step = workflow.slice(workflow.indexOf("Upload latest APK to R2"));
check(
  "the R2 upload can actually run: the Cloudflare values are at job level, not inside the step's own env",
  jobEnv.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}") &&
    jobEnv.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}") &&
    jobEnv.includes("CLOUDFLARE_EMAIL: ${{ secrets.CLOUDFLARE_EMAIL }}") &&
    r2Step.includes("if: ${{ env.CLOUDFLARE_API_TOKEN != ''"),
  jobEnv,
);
check(
  "the R2 step still uploads the release asset to the kuchupuchu-latest.apk key",
  r2Step.includes("wrangler r2 object put kp-media/apk/kuchupuchu-latest.apk") &&
    r2Step.includes("--remote") &&
    r2Step.includes("application/vnd.android.package-archive"),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
