// 79 — production cutover contract (slice J, integration of the two parallel
// attempts; revised 2026-10-19 for the stale-cutover fix).
//
// The React PWA (web/dist) replaced the legacy public/ shell at the Worker's
// assets root. These checks pin the deploy mechanics a browser cannot prove
// for itself: the build hook, the served directory, the single header
// mechanism, the production recipe's flags, the service-worker migration, and
// the install metadata.
//
// Header mechanism history: PR #93 used an assets `_headers` file; PR #94
// replaced it with worker-stamped headers (run_worker_first ["/*"], a single
// source of truth). Live 2026-10-19 the worker path turned into the fault: the
// worker-intermediated edge cache served the PREVIOUS build (old logo/old
// bundle) for days — redeploys, brownfield manifests, even a no-assets
// teardown never refreshed it, because env.ASSETS was already serving the NEW
// build from inside while the public kept hitting the stale worker-response
// cache. Statics now serve-directly (fresh, ["/api/*","/ws/*","/download/apk"]
// stay on the worker) and the security headers returned to the assets
// `_headers` file — still one source of truth, now one that cannot go stale.
// Runtime migration behaviour lives in web/e2e-cutover; the worker's own
// privacy rules stay in verify-web-sw; cases 04/55 keep pinning the retired
// legacy files.

import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const wrangler = read("../../wrangler.toml");
const preview = read("../../wrangler.kuchupuchu-preview.toml");
const worker = read("../../src/worker/index.ts");
const swTemplate = read("../../web/service-worker.template.js");
const verifySw = read("../../scripts/verify-web-sw.ts");
const pkg = JSON.parse(read("../../package.json"));
const viteConfig = read("../../vite.web.config.ts");
const indexHtml = read("../../web/index.html");
const legacySw = read("../../public/sw.js");

/* ------------------------------------------------- serving configuration --- */

check(
  "the production worker serves the built React app, not ./public",
  wrangler.includes('directory = "./web/dist"'),
);
check(
  "wrangler builds the web app itself on every deploy/upload",
  wrangler.includes("[build]") && wrangler.includes('command = "npm run build:web:prod"'),
);
check(
  "the assets binding is exposed to the worker as ASSETS",
  wrangler.includes('binding = "ASSETS"'),
);
check(
  "statics are serve-directly, not worker-intermediated (the worker path caches stale builds behind the edge — 2026-10-19 fix); only api/ws/apk stay on the worker",
  wrangler.includes('run_worker_first = ["/api/*", "/ws/*", "/download/apk"]') &&
    !/\nrun_worker_first\s*=\s*\["\/\*"\]/.test("\n" + wrangler),
);
check(
  "unknown paths still fall back to the shell for deep links",
  wrangler.includes('not_found_handling = "single-page-application"'),
);

/* -------------------- one header mechanism: the assets _headers file ------- */

const headersFile = existsSync(new URL("../../web/public/_headers", import.meta.url))
  ? read("../../web/public/_headers")
  : "";

check(
  "the assets _headers file is the single source of truth (worker-stamped responses went stale behind the edge cache, so they are retired — see wrangler.toml note)",
  headersFile.length > 0,
);
check(
  "_headers stamps frame-ancestors as a response header (meta cannot), one line only",
  headersFile.includes("frame-ancestors 'self'") && !headersFile.includes("<script"),
);
check(
  "_headers carries the production panel origins in frame-ancestors and the clickjacking protection",
  headersFile.includes("https://vintoxbd.online") &&
    headersFile.includes("https://www.vintoxbd.online"),
);
check(
  "every asset response carries nosniff and no-referrer",
  headersFile.includes("X-Content-Type-Options: nosniff") &&
    headersFile.includes("Referrer-Policy: no-referrer"),
);
check(
  "sw.js is no-store so every update check revalidates",
  headersFile.includes("/sw.js") && headersFile.includes("Cache-Control: no-store"),
);
check(
  "wrangler carries no unsupported assets rules (live deploys ignored them)",
  !wrangler.includes("[[assets.rules]]"),
);
check(
  "the worker still delegates non-API paths to the ASSETS binding as the binding-free preview fallback (only /download/apk stays on the worker)",
  worker.includes("serveShellAsset(env, request)") &&
    worker.includes('!pathname.startsWith("/api/")') &&
    worker.includes('!pathname.startsWith("/ws/")') &&
    worker.includes('pathname !== "/download/apk"'),
);
check(
  "the binding-free preview fallback still answers 404 when ASSETS is absent",
  worker.includes("if (!env.ASSETS)"),
);
check(
  "the meta CSP stays as belt for worker-less previews",
  indexHtml.includes('http-equiv="Content-Security-Policy"'),
);

/* ----------------------------------------------------- production recipe --- */

const prodRecipe = pkg.scripts["build:web:prod"] ?? "";
check(
  "the production recipe enables account integration and messaging",
  prodRecipe.includes("VITE_KP_WEB_ACCOUNT_INTEGRATION=true") &&
    prodRecipe.includes("VITE_KP_WEB_MESSAGING=true"),
);
check(
  "the production recipe enables the implemented parity surface (account, messaging, statuses, push)",
  prodRecipe.includes("VITE_KP_WEB_STATUSES=true") && prodRecipe.includes("VITE_KP_WEB_PUSH=true"),
);
check(
  "calls ship in production since slice Q (owner-approved 1:1 WebRTC)",
  prodRecipe.includes("VITE_KP_WEB_CALLS=true"),
);
check("the reserved media gate stays unflipped", !prodRecipe.includes("VITE_KP_WEB_MEDIA"));
check("no sourcemaps ship with the public assets", viteConfig.includes("sourcemap: false"));
check(
  "the ci chain runs the cutover suite, then the prod build and a second verify",
  pkg.scripts.ci.includes(
    "test:web:cutover:e2e && npm run build:web:prod && npm run verify:web-sw",
  ),
);

/* ----------------------------------------------- service-worker migration --- */

check(
  "the React worker sweeps retired kp-shell-* caches on activate",
  swTemplate.includes('const LEGACY_CACHE_PREFIXES = ["kp-shell-"];') &&
    swTemplate.includes("LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))"),
);
check(
  "the no-skipWaiting update policy is kept (updates wait for clients)",
  !swTemplate.includes("skipWaiting"),
);
check(
  "icon, logo, and manifest join the precache and rotate the build id",
  viteConfig.includes('const publicExtras = ["icon.svg", "logo.png", "manifest.webmanifest"]') &&
    verifySw.includes('precache.includes("/icon.svg")') &&
    verifySw.includes('precache.includes("/logo.png")') &&
    verifySw.includes('precache.includes("/manifest.webmanifest")'),
);
check(
  "verify-web-sw enforces the legacy sweep and the no-skipWaiting policy",
  verifySw.includes('!cacheStores.has("kp-shell-v1")') &&
    verifySw.includes('!worker.includes("skipWaiting")'),
);
check(
  "the legacy worker still deletes foreign caches, so a revert self-heals",
  legacySw.includes("ks.filter((k) => k !== SHELL)"),
);

/* --------------------------------------- preview mirrors prod, no bindings --- */

check(
  "the preview config serves the same React build via the same build hook",
  preview.includes('directory = "./web/dist"') &&
    preview.includes('command = "npm run build:web:prod"'),
);
check(
  "the preview config keeps production bindings out",
  !preview.includes("d1_databases") && !preview.includes("r2_buckets"),
);

/* -------------------------------------------------------- install metadata --- */

check(
  "the React shell ships the same manifest and icon the legacy PWA had",
  indexHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
    indexHtml.includes('rel="icon" type="image/png" href="/logo.png"') &&
    indexHtml.includes('rel="apple-touch-icon" href="/icon.svg"'),
);
check(
  "the web public dir carries the manifest and icon into the build",
  existsSync(new URL("../../web/public/manifest.webmanifest", import.meta.url)) &&
    existsSync(new URL("../../web/public/icon.svg", import.meta.url)),
);
check(
  "the manifest keeps the legacy identity and start url",
  read("../../web/public/manifest.webmanifest").includes('"start_url": "/"') &&
    read("../../web/public/manifest.webmanifest").includes('"short_name": "KuchuPuchu"'),
);

console.log(lines.join("\n"));
