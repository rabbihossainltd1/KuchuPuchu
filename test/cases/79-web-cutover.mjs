// 79 — production cutover contract (slice J, integration of the two parallel
// attempts; owner chose the worker-stamped-header mechanism, PR #94).
//
// The React PWA (web/dist) replaced the legacy public/ shell at the Worker's
// assets root. These checks pin the deploy mechanics a browser cannot prove
// for itself: the build hook, the served directory, the single header
// mechanism (worker stamps; neither _headers nor [[assets.rules]]), the
// production recipe's flags, the service-worker migration, and the install
// metadata. Runtime migration behaviour lives in web/e2e-cutover; the worker's
// own privacy rules stay in verify-web-sw; cases 04/55 keep pinning the
// retired legacy files.

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
  "every path runs the worker first so headers can be stamped",
  wrangler.includes('run_worker_first = ["/*"]'),
);
check(
  "unknown paths still fall back to the shell for deep links",
  wrangler.includes('not_found_handling = "single-page-application"'),
);

/* ------------------------- one header mechanism: the worker, nothing else --- */

check(
  "the retired _headers file is gone (single source of truth)",
  !existsSync(new URL("../../web/public/_headers", import.meta.url)),
);
check(
  "wrangler carries no unsupported assets rules (live deploys ignored them)",
  !wrangler.includes("[[assets.rules]]"),
);
check(
  "non-API paths delegate to the ASSETS binding before the REST router",
  worker.includes("serveShellAsset(env, request)") &&
    worker.includes('!pathname.startsWith("/api/") && !pathname.startsWith("/ws/")'),
);
check(
  "the worker stamps frame-ancestors as a response header (meta cannot)",
  worker.includes("frame-ancestors 'self'") &&
    worker.includes('headers.set("Content-Security-Policy", SHELL_CSP)'),
);
check("the header CSP only lands on HTML documents", worker.includes('includes("text/html")'));
check(
  "every asset response carries nosniff and no-referrer",
  worker.includes('headers.set("X-Content-Type-Options", "nosniff")') &&
    worker.includes('headers.set("Referrer-Policy", "no-referrer")'),
);
check(
  "sw.js is no-store so every update check revalidates",
  worker.includes('pathname === "/sw.js"') &&
    worker.includes('headers.set("Cache-Control", "no-store")'),
);
check(
  "the meta CSP stays as belt for worker-less previews",
  indexHtml.includes('http-equiv="Content-Security-Policy"'),
);
check(
  "a binding-free worker answers 404 for asset paths instead of crashing",
  worker.includes("if (!env.ASSETS)"),
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
  "calls stay default-off and the reserved media gate stays unflipped",
  !prodRecipe.includes("VITE_KP_WEB_CALLS") && !prodRecipe.includes("VITE_KP_WEB_MEDIA"),
);
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
  "icon and manifest join the precache and rotate the build id",
  viteConfig.includes('const publicExtras = ["icon.svg", "manifest.webmanifest"]') &&
    verifySw.includes('precache.includes("/icon.svg")') &&
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
    indexHtml.includes('rel="icon" href="/icon.svg"') &&
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
