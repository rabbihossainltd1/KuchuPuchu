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
  "signing continuity is checked against the published v274 APK before publishing v279",
  workflow.includes("gh release download v274") &&
    workflow.includes("kuchupuchu-3.9.197-r104.apk") &&
    workflow.includes("Verify signing continuity with v274") &&
    workflow.includes('test "$code" = "279"') &&
    workflow.includes('test "$name" = "3.9.202"'),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
