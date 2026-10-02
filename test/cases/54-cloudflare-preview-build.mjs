// Guard the separate, non-production Worker config from drifting into a live route.
import { readFileSync } from "node:fs";

const production = readFileSync("wrangler.toml", "utf8");
const preview = readFileSync("wrangler.kuchupuchu-preview.toml", "utf8");
const lines = (text) => new Set(text.split(/\r?\n/).map((line) => line.trim()));
const productionLines = lines(production);
const previewLines = lines(preview);
const checks = [
  [
    "production Wrangler config continues to target kuchupuchu-api",
    productionLines.has('name = "kuchupuchu-api"'),
  ],
  [
    "separate preview Wrangler config targets the Workers Builds kuchupuchu service",
    previewLines.has('name = "kuchupuchu"'),
  ],
  ["preview config disables workers.dev routing", previewLines.has("workers_dev = false")],
  ["preview config disables public version URLs", previewLines.has("preview_urls = false")],
  [
    "preview uses the existing Worker entry point and static assets",
    previewLines.has('main = "src/worker/index.ts"') && previewLines.has('directory = "./public"'),
  ],
  [
    "preview config excludes production D1, R2, and Durable Object bindings",
    !previewLines.has("[[d1_databases]]") &&
      !previewLines.has("[[r2_buckets]]") &&
      !previewLines.has("[[durable_objects.bindings]]"),
  ],
  [
    "preview upload cannot apply Durable Object migrations or production cron triggers",
    !previewLines.has("[[migrations]]") && !previewLines.has("[triggers]"),
  ],
];

for (const [name, ok] of checks) {
  console.log(`  ${ok ? "OK     " : "BROKEN "}  ${name}`);
}
process.exit(checks.some(([, ok]) => !ok) ? 1 : 0);
