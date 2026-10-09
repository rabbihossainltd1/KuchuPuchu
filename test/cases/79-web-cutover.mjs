// 79 — production cutover contract (slice J).
//
// The React PWA (web/dist) replaced the legacy public/ shell at the Worker's
// assets root. These checks pin the deploy mechanics that a browser cannot
// prove for itself: the build hook, the served directory, the header rules
// (CSP including frame-ancestors, immutable hashed bundles, no-store sw.js)
// and the retirement of the legacy shell. Runtime migration behaviour lives
// in web/e2e-cutover/cutover.spec.ts; the worker's own privacy rules stay in
// verify-web-sw and case 55/04 keep pinning the retired legacy files.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const wrangler = read("../../wrangler.toml");
const preview = read("../../wrangler.kuchupuchu-preview.toml");
const pkg = JSON.parse(read("../../package.json"));
const indexHtml = read("../../web/index.html");
const viteConfig = read("../../vite.web.config.ts");
const template = read("../../web/service-worker.template.js");

// 1. the served client is the built React app, fresh on every deploy
check(
  "production assets root is the React build output",
  wrangler.includes('directory = "./web/dist"'),
);
check(
  "wrangler builds the web app itself on deploy/upload (no dashboard build command needed)",
  wrangler.includes('[build]\ncommand = "npm run build:web:prod"'),
);
check(
  "API and socket paths still run through the worker first",
  wrangler.includes('run_worker_first = ["/api/*", "/ws/*"]'),
);
check(
  "unknown paths still fall back to the app shell",
  wrangler.includes('not_found_handling = "single-page-application"'),
);

// 2. header rules: caching + the security contract
check(
  "hashed bundles are immutable",
  /path = "\/assets\/\*"\s+headers = \{ Cache-Control = "public, max-age=31536000, immutable" \}/.test(
    wrangler,
  ),
);
check(
  "sw.js is no-store so every update check revalidates",
  /path = "\/sw\.js"\s+headers = \{ Cache-Control = "no-store" \}/.test(wrangler),
);
const fallbackRule = wrangler.match(/path = "\/\*"\s+headers = \{ ([^}]+) \}/)?.[1] ?? "";
check("documents are no-store", fallbackRule.includes('Cache-Control = "no-store"'));
check("nosniff on documents", fallbackRule.includes('X-Content-Type-Options = "nosniff"'));
check(
  "sane referrer policy",
  fallbackRule.includes('Referrer-Policy = "strict-origin-when-cross-origin"'),
);
const csp = fallbackRule.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? "";
check(
  "server CSP: same-origin default, GSI the only third party, no inline scripts",
  /default-src 'self'/.test(csp) &&
    /script-src 'self' https:\/\/accounts\.google\.com/.test(csp) &&
    !/script-src[^;]*'unsafe-(inline|eval)'/.test(csp) &&
    /object-src 'none'/.test(csp),
);
check(
  "server CSP: frame-ancestors (impossible in meta) is enforced",
  /frame-ancestors 'self'/.test(csp),
);

// 3. the non-production preview mirrors the same mechanics without prod bindings
check(
  "preview config serves the React build and builds it the same way",
  preview.includes('directory = "./web/dist"') &&
    preview.includes('command = "npm run build:web:prod"'),
);
check(
  "preview config still excludes production bindings/triggers/migrations",
  !preview.includes("[[d1_databases]]") &&
    !preview.includes("[[r2_buckets]]") &&
    !preview.includes("[[durable_objects.bindings]]") &&
    !preview.includes("[triggers]") &&
    !preview.includes("[[migrations]]"),
);

// 4. the production flag set is explicit and conservative
const prodBuild = pkg.scripts["build:web:prod"] ?? "";
check(
  "production build enables account + messaging + statuses + media",
  prodBuild.includes("VITE_KP_WEB_ACCOUNT_INTEGRATION=true") &&
    prodBuild.includes("VITE_KP_WEB_MESSAGING=true") &&
    prodBuild.includes("VITE_KP_WEB_STATUSES=true") &&
    prodBuild.includes("VITE_KP_WEB_MEDIA=true"),
);
check(
  "calls and push stay off in production (plan default; VAPID unset)",
  !prodBuild.includes("VITE_KP_WEB_CALLS=true") && !prodBuild.includes("VITE_KP_WEB_PUSH=true"),
);
check(
  "CI runs the cutover browser gate",
  pkg.scripts.ci.includes("test:web:cutover:e2e") &&
    pkg.scripts["test:web:cutover:e2e"]?.includes("playwright.cutover.config.ts"),
);

// 5. the served shell is PWA-complete with a single CSP source of truth
check(
  "index.html has no meta CSP (the header is the only source of truth)",
  !/http-equiv="Content-Security-Policy"/i.test(indexHtml),
);
check(
  "index.html is an installable PWA shell (manifest + icon)",
  indexHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
    indexHtml.includes('rel="icon" href="/icon.svg"'),
);
check(
  "the PWA identity files are build inputs",
  viteConfig.includes('"icon.svg"') && viteConfig.includes('"manifest.webmanifest"'),
);
check("no sourcemaps in the public asset upload", /sourcemap:\s*false/.test(viteConfig));

// 6. legacy retirement + migration cleanup
check(
  "the new worker deletes retired legacy shell caches on activation",
  template.includes('const LEGACY_CACHE_PREFIXES = ["kp-shell-"];'),
);
check(
  "public/ is retired but preserved as the legacy reference",
  read("../../public/sw.js").includes('const SHELL = "kp-shell-v2";') &&
    /no longer served/i.test(read("../../public/RETIRED.md")),
);

console.log(lines.join("\n"));
