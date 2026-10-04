import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4178";

/**
 * Status suite: built with the account, messaging and status rollout flags on.
 * Messaging is on because a reply to a status is a sealed 1:1 message, and the
 * viewer's "Message" row opens a chat — the flags stay independent, but this
 * suite exercises the pair the way a real rollout would.
 */
export default defineConfig({
  testDir: "./web/e2e-status",
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
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command:
      "VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_STATUSES=true npm run build:web && VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_STATUSES=true npm run preview:web -- --host 127.0.0.1 --port 4178 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
