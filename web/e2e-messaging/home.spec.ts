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
  await page.goto("/chats");
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

test("signed-out mobile visitors see feature banners, no login buttons, footer legal links, and page tabs", async ({
  browser,
}) => {
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto("/");
  await expect(
    mobilePage.getByRole("heading", { name: "Messages that stay yours." }),
  ).toBeVisible();
  await expect(
    mobilePage.getByRole("heading", { name: "How to Hide & Unhide Secret Chats" }),
  ).toBeVisible();
  await expect(
    mobilePage.getByRole("heading", {
      name: "How to Archive Chats & Use the 2-Second Pull Gesture",
    }),
  ).toBeVisible();

  // Mobile mode has no login button anywhere
  await expect(mobilePage.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(mobilePage.getByRole("button", { name: "Open KuchuPuchu Web" })).toHaveCount(0);

  const nav = mobilePage.getByRole("navigation", { name: "Site pages" });
  await expect(nav.getByRole("link", { name: "Features" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Privacy" })).toHaveCount(0);

  const footer = mobilePage.locator(".kp-welcome__foot");
  await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Data" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Terms" })).toBeVisible();

  await nav.getByRole("link", { name: "Features" }).click();
  await expect(mobilePage).toHaveURL(/\/features$/);
  await expect(
    mobilePage.getByRole("heading", { name: "Built for everyday privacy" }),
  ).toBeVisible();
  await expect(
    mobilePage.getByRole("heading", {
      name: "Every feature built into KuchuPuchu Android & Web",
    }),
  ).toBeVisible();
  await expect(
    mobilePage.getByRole("heading", { name: "How to Hide & Unhide Secret Chats" }),
  ).toBeVisible();
  await expect(mobilePage.locator(".kp-feature-banner")).toHaveCount(24);
  await expect(mobilePage.getByRole("button", { name: "Open KuchuPuchu Web" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Encryption" }).click();
  await expect(mobilePage).toHaveURL(/\/encryption$/);
  await expect(
    mobilePage.getByRole("heading", { name: "End-to-end encryption (KP1 & KP2)" }),
  ).toBeVisible();
  await expect(
    mobilePage.getByRole("heading", {
      name: "Visual Cryptography & Privacy Shield Banners",
    }),
  ).toBeVisible();

  await nav.getByRole("link", { name: "Overview" }).click();
  await expect(mobilePage).toHaveURL(/\/$/);
  await expect(
    mobilePage.getByRole("heading", { name: "Messages that stay yours." }),
  ).toBeVisible();
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const scan = await new AxeBuilder({ page: mobilePage })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await mobileCtx.close();
});

test("signed-in desktop user keeps / as Home Overview and /chats as Chat page without mixing", async ({
  page,
}) => {
  // Currently on /chats from beforeEach
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();

  // Visiting / while signed in renders the Home / Overview page (WelcomePage), NOT the chat page
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Messages that stay yours." })).toBeVisible();
  await expect(page.locator(".kp-feature-banner")).toHaveCount(24);

  // Navigating to /features and clicking Overview returns to / (Home Overview), not /chats
  const nav = page.getByRole("navigation", { name: "Site pages" });
  await nav.getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator(".kp-feature-banner")).toHaveCount(24);

  await nav.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Messages that stay yours." })).toBeVisible();

  // Clicking Open KuchuPuchu Web on Home navigates to /chats and opens the signed-in Chat page
  await page.getByRole("button", { name: "Open KuchuPuchu Web" }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
});
