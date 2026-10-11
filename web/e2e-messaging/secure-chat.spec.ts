/** The Web must not fork a phone's identity or ship a plaintext fallback. */

import { expect, test } from "@playwright/test";
import { CHAT_ID, createMockWorker, signIn, type MockWorker } from "./helpers";

let worker: MockWorker;

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ noE2eeBackup: true });
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
});

test("without the phone key, old sealed messages stay locked and Send explains the gate", async ({
  page,
}) => {
  await page.getByRole("link", { name: /^Rahi/ }).click();
  await expect(
    page.getByText("Secure chat keys are not on this browser", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("🔒 অ্যাপে খুলুন").first()).toBeVisible();

  const composer = page.getByLabel("Message text", { exact: true });
  await composer.fill("keep this until I unlock the phone key");
  const send = page.getByRole("button", { name: "Unlock secure chat to send" });
  await expect(send).toBeDisabled();

  await composer.press("Enter");
  await expect(composer).toHaveValue("keep this until I unlock the phone key");
  await expect(page.getByText(/Waiting for secure chat/)).toBeVisible();
  expect(worker.sent).toHaveLength(0);
  expect(page.url()).toContain(`/chats/${CHAT_ID}`);
});
