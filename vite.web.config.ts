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
        // Slice J: the PWA identity files live in web/public (copied verbatim
        // to the dist root) and join the shell precache — the same idea the
        // legacy kp-shell cache had, minus the stale-prone unversioned app.js.
        // Their real bytes feed the build id, so an icon/manifest change also
        // rotates the service worker.
        const publicExtras = ["icon.svg", "manifest.webmanifest"].map((name) => ({
          url: `/${name}`,
          bytes: readFileSync(resolve(process.cwd(), "web/public", name)),
        }));
        const digest = createHash("sha256").update(serviceWorkerTemplate);
        const precacheUrls = [
          ...files.map((output) => `/${output.fileName}`),
          ...publicExtras.map((extra) => extra.url),
        ].sort();

        for (const output of files) {
          digest.update(output.fileName).update("\0");
          digest.update(output.type === "chunk" ? output.code : output.source).update("\0");
        }
        for (const extra of publicExtras) {
          digest.update(extra.url).update("\0");
          digest.update(extra.bytes).update("\0");
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
 * The production Web client workspace. Since the slice J cutover, this build
 * (web/dist) is what the Worker serves at / — see wrangler.toml [assets] and
 * docs/web-cutover.md for the service-worker migration and rollback story.
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
    // Slice J: the dist is now uploaded as PUBLIC worker assets, so no
    // sourcemaps — they would ship the whole source next to the bundles.
    sourcemap: false,
  },
});
