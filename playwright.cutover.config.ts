import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4184";

/**
 * Slice J exit gate: the production-cutover browser suite. Unlike every other
 * suite this one ALLOWS service workers — the migration mechanics (legacy
 * cache cleanup on activation, offline shell from the precache) are the very
 * thing under test. Built with the exact production script (build:web:prod)
 * so CI proves the bytes that will be served.
 */
export default defineConfig({
  testDir: "./web/e2e-cutover",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1366, height: 860 },
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "npm run build:web:prod && npm run preview:web -- --host 127.0.0.1 --port 4184 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
