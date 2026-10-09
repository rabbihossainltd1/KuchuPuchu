import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4183";

/**
 * Slice I exit gate: the hardening suite — theme parity (app + per-chat),
 * the 4-breakpoint × 2-theme visual matrix, reduced motion, accessibility and
 * the IndexedDB account-isolation wall. Built with the account + messaging
 * flags on, like the messaging suite.
 */
export default defineConfig({
  testDir: "./web/e2e-hardening",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1366, height: 860 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true npm run build:web && VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true npm run preview:web -- --host 127.0.0.1 --port 4183 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
