import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const serviceWorkerTemplate = readFileSync(
  resolve(process.cwd(), "web/service-worker.template.js"),
  "utf8",
);

function versionedServiceWorker(): Plugin {
  return {
    name: "kp-versioned-service-worker",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const files = Object.values(bundle)
          .filter((output) => output.fileName !== "sw.js" && !output.fileName.endsWith(".map"))
          .filter(
            (output) => output.fileName === "index.html" || /\.(?:js|css)$/i.test(output.fileName),
          )
          .sort((left, right) => left.fileName.localeCompare(right.fileName));
        const digest = createHash("sha256").update(serviceWorkerTemplate);
        const precacheUrls = files.map((output) => `/${output.fileName}`);

        for (const output of files) {
          digest.update(output.fileName).update("\0");
          digest.update(output.type === "chunk" ? output.code : output.source).update("\0");
        }

        if (!precacheUrls.includes("/index.html")) {
          this.error("The Web service worker requires the built index.html shell.");
        }

        const buildId = digest.digest("hex").slice(0, 16);
        const workerSource = serviceWorkerTemplate
          .replace("__BUILD_ID__", buildId)
          .replace("__PRECACHE_URLS__", JSON.stringify(precacheUrls));
        this.emitFile({ type: "asset", fileName: "sw.js", source: workerSource });
      },
    },
  };
}

/**
 * The production Web client workspace. Since the slice J cutover, the root
 * wrangler.toml builds this app (`build:web:prod` — account + messaging flags
 * on, matching the legacy ./public surface; calls stay off) and serves
 * web/dist from the worker on the same origin as /api and /ws. ./public stays
 * in the repo only for the legacy contract suite and one-revert rollback.
 * Default-flag `build:web` remains the safe preview/E2E recipe.
 */
export default defineConfig({
  root: "web",
  base: "/",
  plugins: [react(), versionedServiceWorker()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: [".e2b.app"],
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: [".e2b.app"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Slice J cutover: the deployed recipe (KP_WEB_PROD=1) must not publish
    // source maps — everything in web/dist is world-readable once served, and
    // the legacy ./public never shipped maps. Preview/E2E builds keep them.
    sourcemap: process.env.KP_WEB_PROD !== "1",
  },
});
