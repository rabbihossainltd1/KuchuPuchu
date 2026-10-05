import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4179";

/**
 * Calls suite: built with the account, messaging and calls rollout flags on.
 * Messaging is on because a call is started from a chat header and the ring
 * screen's "Message" button sends a sealed 1:1 reply — the flags stay
 * independent, but this suite exercises the pair the way a real rollout would.
 *
 * The launch args are the load-bearing part:
 *
 * - `--use-fake-device-for-media-stream` gives every page a microphone and a
 *   camera that produce real frames, so a call is a call rather than a
 *   permission error. Without it `getUserMedia` still succeeds in a fresh
 *   context, but with no device behind it the peer connection has nothing to
 *   negotiate and the "connected" state never arrives.
 * - `--use-fake-ui-for-media-stream` answers the permission prompt, which is the
 *   browser equivalent of the phone's `gateMicCamera` grant.
 * - `--autoplay-policy=no-user-gesture-required` lets the single remote-audio
 *   element play. A real user has clicked Accept by then, so the gesture
 *   requirement is satisfied in production; the flag only keeps the test honest
 *   about what the element is bound to.
 */
export default defineConfig({
  testDir: "./web/e2e-calls",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1366, height: 860 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command:
      "VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_CALLS=true npm run build:web && VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_CALLS=true npm run preview:web -- --host 127.0.0.1 --port 4179 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
