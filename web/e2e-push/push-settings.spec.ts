import { expect, test, type Page } from "@playwright/test";
import {
  FAKE_AUTH,
  FAKE_ENDPOINT,
  FAKE_P256DH,
  createMockPushWorker,
  installFakePushStack,
  signIn,
  type PushMockState,
} from "./helpers";

/**
 * The Web Push SETTINGS surface (slice H), against a mocked Worker.
 *
 * What this file proves: the card is honest in every state it can be in —
 * supported, server-not-configured, permission-denied — and that opt-in and
 * opt-out send the REAL subscription shape to the server and nothing else.
 * The doorbell itself (payload privacy, encryption, delivery, cleanup) is
 * contract case 77's job; the settings card is this file's.
 */

let state: PushMockState;

const card = (page: Page) => page.locator("section", { has: page.locator("#push-heading") });

test.beforeEach(async ({ page }) => {
  const worker = await createMockPushWorker();
  state = worker.state;
  await installFakePushStack(page);
  await worker.install(page);
  await signIn(page);
});

test("the card states what a web notification IS — a doorbell, never a preview", async ({
  page,
}) => {
  await page.goto("/account");
  const section = card(page);

  await expect(section.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(section).toContainText("never includes message text, sender names or photos");
  await expect(section).toContainText("Delivery is best-effort");
  await expect(section).toContainText("Chats you mute for messages still update here — silently");
  await expect(section.getByRole("button", { name: "Turn on notifications" })).toBeEnabled();
});

test("opting in sends the real PushManager subscription to the server", async ({ page }) => {
  await page.goto("/account");
  const section = card(page);

  await section.getByRole("button", { name: "Turn on notifications" }).click();

  await expect(section.getByText("Notifications are on for this browser.")).toBeVisible();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({
    endpoint: FAKE_ENDPOINT,
    p256dh: FAKE_P256DH,
    auth: FAKE_AUTH,
  });
  // The VAPID key went to PushManager as raw bytes, not as a base64 string.
  const keyLength = await page.evaluate(
    () =>
      (window as unknown as { __kpPush?: { lastServerKeyLength: number } }).__kpPush
        ?.lastServerKeyLength,
  );
  expect(keyLength).toBe(65);
  // The server's registry answers and the card shows this browser's row.
  await expect(section.locator(".current-device-badge").first()).toBeVisible();
  await expect(section.getByRole("button", { name: "Turn off" })).toBeEnabled();
});

test("opting out unsubscribes locally and removes the server row", async ({ page }) => {
  await page.goto("/account");
  const section = card(page);

  await section.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(section.getByText("Notifications are on for this browser.")).toBeVisible();

  await section.getByRole("button", { name: "Turn off" }).click();

  await expect.poll(() => state.deletes.map((entry) => entry.endpoint)).toEqual([FAKE_ENDPOINT]);
  await expect(section.getByRole("button", { name: "Turn on notifications" })).toBeVisible();
  const subscribed = await page.evaluate(
    () => (window as unknown as { __kpPush?: { subscribed: boolean } }).__kpPush?.subscribed,
  );
  expect(subscribed).toBe(false);
});

test("a server without VAPID gets an honest line, not a dead button", async ({ page }) => {
  const worker = await createMockPushWorker({ supported: false });
  await worker.install(page);
  await page.goto("/account");
  const section = card(page);

  await expect(section).toContainText("Notifications are not configured on this server yet");
  await expect(section.getByRole("button", { name: "Turn on notifications" })).toHaveCount(0);
});

test("a denied browser permission is named, and the button stands down", async ({ page }) => {
  // The mock Worker from beforeEach stays; only the push stack turns hostile:
  // the permission reads "denied" exactly like a browser whose prompt was
  // refused in the settings. The card must name that instead of offering a
  // button that can only fail.
  await installFakePushStack(page, "deny");
  await page.goto("/account");
  const section = card(page);

  await expect(section).toContainText("Notification permission is blocked in this browser");
  await expect(section.getByRole("button", { name: "Turn on notifications" })).toBeDisabled();
  await expect.poll(() => state.posts.length).toBe(0);
});

test("a doorbell click lands the reader where the knock points", async ({ page }) => {
  await page.goto("/account");
  await expect(card(page).getByRole("heading", { name: "Notifications" })).toBeVisible();

  // The service worker's notificationclick hands the app a kp-push-nav message;
  // with calls ON in this build, a call knock goes to the Calls section.
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "kp-push-nav", path: "/calls" } }),
    );
  });
  await expect(page).toHaveURL(/\/calls$/);

  // And a message knock — or anything unrecognized — lands on Chats.
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "kp-push-nav", path: "/chats" } }),
    );
  });
  await expect(page).toHaveURL(/\/chats$/);
});
