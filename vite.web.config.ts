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
 * Incremental Web client workspace. The current production PWA remains served
 * from ./public until the migrated flows pass parity and regression gates.
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
    sourcemap: true,
  },
});
