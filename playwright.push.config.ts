import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4181";

/**
 * Web Push suite (slice H): built with the account, push AND calls flags on.
 * Account is the session the settings card lives in; push is the slice under
 * test; calls is on so the doorbell's call knock has a Calls section to land
 * in — the click-routing rule sends every knock to Chats in a calls-less
 * build, and that fallback is pinned by the model, not by this suite.
 *
 * The browser side of push is inherently environment-shaped (a real
 * PushManager needs a push service; headless Chromium's answers vary between
 * builds), so the suite installs a deterministic PushManager the same way the
 * calls suite installs its screen-share refusal: the contract case proves the
 * wire format end to end, and this suite proves the SETTINGS surface against
 * a subscription of the exact real shape.
 */
export default defineConfig({
  testDir: "./web/e2e-push",
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
    // Blocked like every other suite: the deterministic PushManager stub the
    // helper installs stands in for the real registration, so no live worker
    // may race it.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["notifications"],
  },
  webServer: {
    command:
      "VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_PUSH=true VITE_KP_WEB_CALLS=true npm run build:web && VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_PUSH=true VITE_KP_WEB_CALLS=true npm run preview:web -- --host 127.0.0.1 --port 4181 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
