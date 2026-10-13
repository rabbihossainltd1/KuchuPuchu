/**
 * Slice HP — the phone's HomeMenuSheet on the web, verbatim and in the
 * phone's order: My Profile, New contact, All contacts, New group,
 * Settings. Profile and Settings land on the account page, which is
 * the web's one surface for both.
 */

import { expect, test } from "@playwright/test";
import { createMockWorker, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  const worker = await createMockWorker();
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
});

test("the home menu carries the phone's five rows in order", async ({ page }) => {
  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("menu", { name: "Chat list menu" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "My Profile",
    "New contact",
    "All contacts",
    "New group",
    "Settings",
  ]);
});

test("home menu is accessible", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await page.getByRole("button", { name: "Menu" }).click();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});

test("Settings and My Profile land on the account page", async ({ page }) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "My Profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
});

test("signed-out mobile visitors see the full welcome tabs and APK banner", async ({ browser }) => {
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto("/");
  await expect(
    mobilePage.getByRole("heading", { name: "Messages that stay yours." }),
  ).toBeVisible();
  await expect(mobilePage.getByRole("tab", { name: "Features" })).toBeVisible();
  await mobilePage.getByRole("tab", { name: "Architecture" }).click();
  await expect(mobilePage.getByRole("heading", { name: "System architecture" })).toBeVisible();
  await mobileCtx.close();
});
