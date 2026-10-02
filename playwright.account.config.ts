import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4176";

export default defineConfig({
  testDir: "./web/e2e-account",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 7_000 },
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
      "VITE_KP_WEB_ACCOUNT_INTEGRATION=true npm run build:web && VITE_KP_WEB_ACCOUNT_INTEGRATION=true npm run preview:web -- --host 127.0.0.1 --port 4176 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
