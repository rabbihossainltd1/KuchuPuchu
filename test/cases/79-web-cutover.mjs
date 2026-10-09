// Slice J (production cutover) static pins. The cutover itself is a config +
// worker + service-worker change; the browser suites already prove the React
// app, so this case stops the SERVING contract from silently drifting back:
//
//  1. The root worker serves web/dist (the built React PWA) on the same
//     origin as /api and /ws, builds it before every deploy, and stamps the
//     deploy-day security headers (CSP with frame-ancestors) server-side.
//  2. The preview-only config keeps serving ./public and never runs the
//     worker for asset paths — a preview upload must not need the React build
//     and must not touch production serving.
//  3. The production recipe enables exactly the legacy surface (account +
//     messaging); calls stay default-off per the standing directive.
//  4. The React service worker sweeps the legacy kp-shell-* caches on
//     activate and keeps the no-skipWaiting update policy; the legacy worker's
//     delete-everything-else activate makes a one-revert rollback self-heal.
//  5. The React shell carries the same install metadata (manifest, icon) the
//     legacy PWA had, so existing home-screen installs keep their identity.

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
const pkg = read("../../package.json");
const indexHtml = read("../../web/index.html");
const legacySw = read("../../public/sw.js");

/* ------------------------------------------------- serving configuration --- */

check(
  "the production worker serves the built React app, not ./public",
  wrangler.includes('directory = "./web/dist"'),
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
check(
  "wrangler builds the production recipe before every deploy",
  wrangler.includes("[build]") && wrangler.includes('command = "npm run build:web:prod"'),
);
check(
  "the preview config still targets ./public and never builds the React app",
  preview.includes('directory = "./public"') &&
    !preview.includes("[build]") &&
    !preview.includes("web/dist"),
);
check(
  "the preview config keeps the worker off asset paths",
  preview.includes('run_worker_first = ["/api/*", "/ws/*"]'),
);

/* ---------------------------------------------------- worker delegation --- */

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
  "the header CSP matches the meta CSP plus frame-ancestors",
  worker.includes("frame-src https://accounts.google.com; frame-ancestors 'self'; font-src") &&
    indexHtml.includes("frame-src https://accounts.google.com; font-src"),
);
check(
  "a binding-free worker answers 404 for asset paths instead of crashing",
  worker.includes("if (!env.ASSETS)"),
);

/* ----------------------------------------------------- production recipe --- */

const prodRecipe = pkg.match(/"build:web:prod": "([^"]+)"/)?.[1] ?? "";
check(
  "the production recipe enables account integration and messaging",
  prodRecipe.includes("VITE_KP_WEB_ACCOUNT_INTEGRATION=true") &&
    prodRecipe.includes("VITE_KP_WEB_MESSAGING=true"),
);
check(
  "the production recipe publishes no source maps (legacy never did)",
  prodRecipe.includes("KP_WEB_PROD=1") &&
    read("../../vite.web.config.ts").includes('process.env.KP_WEB_PROD !== "1"'),
);
check(
  "the production recipe leaves calls, statuses and media at their safe defaults",
  !prodRecipe.includes("VITE_KP_WEB_CALLS") &&
    !prodRecipe.includes("VITE_KP_WEB_STATUSES") &&
    !prodRecipe.includes("VITE_KP_WEB_MEDIA"),
);
check(
  "the production recipe is part of the CI chain",
  JSON.parse(pkg).scripts.ci.includes("build:web:prod"),
);

/* ----------------------------------------------- service-worker migration --- */

check(
  "the React worker sweeps legacy kp-shell-* caches on activate",
  swTemplate.includes('const LEGACY_CACHE_PREFIX = "kp-shell-"') &&
    swTemplate.includes("key.startsWith(LEGACY_CACHE_PREFIX)"),
);
check(
  "the no-skipWaiting update policy is kept (updates wait for clients)",
  !swTemplate.includes("skipWaiting"),
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
