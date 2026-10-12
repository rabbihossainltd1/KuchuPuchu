/** Theme controls use consistent English UI copy. */

import { expect, test } from "@playwright/test";
import { PEER_NAME, createMockWorker, signIn } from "./helpers";

async function mount(page: Parameters<typeof signIn>[0]) {
  const worker = await createMockWorker();
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
}

test("app appearance labels and notes are English", async ({ page }) => {
  await mount(page);
  await page.goto("/account");
  const appearance = page.getByRole("region", { name: "App theme" });
  await expect(appearance.getByText("Dark Blue", { exact: true })).toBeVisible();
  await expect(appearance.getByText("Light Cream", { exact: true })).toBeVisible();
  const hasBengali = await appearance.evaluate((element) =>
    /[\u0980-\u09ff]/u.test(element.textContent ?? ""),
  );
  expect(hasBengali).toBe(false);
});

test("chat theme choices and current label are English", async ({ page }) => {
  await mount(page);
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Chat theme" }).click();

  const themes = page.getByRole("radiogroup", { name: "Chat theme" });
  for (const label of ["Dark Blue", "Classic Cream", "Mint", "Rose", "Night"]) {
    await expect(themes.getByRole("radio", { name: `Chat theme ${label}` })).toBeVisible();
  }
  const hasBengali = await page
    .locator(".chat-menu")
    .evaluate((element) => /[\u0980-\u09ff]/u.test(element.textContent ?? ""));
  expect(hasBengali).toBe(false);
});
