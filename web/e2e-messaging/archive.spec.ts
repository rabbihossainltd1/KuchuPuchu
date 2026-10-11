/**
 * Slice AP — pin + archive parity: the phone keeps both flags on the
 * device (ScreenStore), the web mirrors them in localStorage; the main
 * list floats pinned rows and hides archived ones behind the
 * "Archived (n)" entry that opens the phone's ArchiveScreen port.
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

test("Pin floats a chat to the top with the pin glyph", async ({ page }) => {
  const squadRow = page.locator(".conversation-rows__item", { hasText: "Squad" });
  await squadRow.getByRole("button", { name: /Options for/ }).click();
  await page.getByRole("menuitem", { name: "Pin" }).click();

  const firstRow = page.locator(".conversation-rows__item").first();
  await expect(firstRow).toContainText("Squad");
  await expect(firstRow.locator(".conversation-row__pin")).toBeVisible();

  await firstRow.getByRole("button", { name: /Options for/ }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(page.locator(".conversation-row__pin")).toHaveCount(0);
});

test("right-click archives a chat into the Archived pane", async ({ page }) => {
  await page.getByRole("link", { name: /^Rahi/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive" }).click();

  await expect(page.getByRole("link", { name: /^Rahi/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Archived/ })).toContainText("(1)");

  await page.getByRole("button", { name: /Archived/ }).click();
  const pane = page.getByRole("dialog", { name: "Archived" });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("link", { name: /^Rahi/ })).toBeVisible();

  await pane.getByRole("button", { name: /Options for/ }).click();
  await pane.getByRole("menuitem", { name: "Unarchive" }).click();
  await expect(pane.getByRole("link", { name: /^Rahi/ })).toHaveCount(0);
  await pane.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
});

test("the empty archive speaks the phone's copy", async ({ page }) => {
  await page.getByRole("button", { name: /Archived/ }).click();
  const pane = page.getByRole("dialog", { name: "Archived" });
  await expect(pane.getByText("No archived chats")).toBeVisible();
  await expect(pane.getByText("Swipe a chat right to archive it")).toBeVisible();
});

test("pin survives a reload (device-local like the phone)", async ({ page }) => {
  const squadRow = page.locator(".conversation-rows__item", { hasText: "Squad" });
  await squadRow.getByRole("button", { name: /Options for/ }).click();
  await page.getByRole("menuitem", { name: "Pin" }).click();
  await expect(page.locator(".conversation-rows__item").first()).toContainText("Squad");

  await page.reload();
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
  await expect(page.locator(".conversation-rows__item").first()).toContainText("Squad");
});

test("the archive pane has no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await page.getByRole("button", { name: /Archived/ }).click();
  await expect(page.getByRole("dialog", { name: "Archived" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
