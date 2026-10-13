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

test("the account page offers no light theme — the Web is dark blue only", async ({ page }) => {
  // Owner (2026-10-13): "website er colour theme dark blue hobe" — the light
  // option is gone from the Web. Even a device that still carries a legacy
  // stored choice paints dark blue.
  await page.addInitScript(() => window.localStorage.setItem("kp.app_theme", "light"));
  await mount(page);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-kp-theme", "dark_blue");
  await expect(page.getByRole("region", { name: "App theme" })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("kp.app_theme"))).toBe("dark_blue");
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
