/**
 * Slice MS — the phone's ListSelect on the web: kebab "Select" enters
 * tick mode ("N selected" bar with X and ⋮), the ⋮ sheet carries the
 * phone's rows (Delete / Mute… / Pin / Create group with X / Select),
 * the mute chooser is the phone's three-row KpMuteChooser, and the
 * delete popup speaks the phone's multi copy verbatim.
 */

import { expect, test } from "@playwright/test";
import { CHAT_ID, GROUP_ID, createMockWorker, signIn, type MockWorker } from "./helpers";

let worker: MockWorker;

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker();
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
});

const enterSelect = async (page: import("@playwright/test").Page, who: string) => {
  await page
    .locator(".conversation-rows__item", { hasText: who })
    .getByRole("button", { name: /Options for/ })
    .click();
  await page.getByRole("menuitem", { name: "Select" }).click();
};

test("tick mode counts and multi-pin", async ({ page }) => {
  await enterSelect(page, "Squad");
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("checkbox", { name: /^Rahi/ }).click();
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();

  await expect(page.getByText("2 selected")).toHaveCount(0);
  await expect(page.locator(".conversation-row__pin")).toHaveCount(2);
});

test("multi delete speaks the phone's copy and deletes both", async ({ page }) => {
  await enterSelect(page, "Rahi");
  await page.getByRole("checkbox", { name: /^Squad/ }).click();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete Chats" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Permanently delete these 2 chats?")).toBeVisible();
  await expect(dialog.getByText("Also delete for everyone")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete Chats" }).click();

  await expect(page.getByRole("link", { name: /^Rahi/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Squad/ })).toHaveCount(0);
  expect(worker.deletedConversations.sort()).toEqual([CHAT_ID, GROUP_ID]);
});

test("the mute chooser mutes every ticked chat", async ({ page }) => {
  await enterSelect(page, "Rahi");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Mute…" }).click();

  const chooser = page.getByRole("dialog", { name: "Mute" });
  for (const label of ["Mute all", "Mute calls", "Mute messages"]) {
    await expect(chooser.getByRole("button", { name: label })).toBeVisible();
  }
  await chooser.getByRole("button", { name: "Mute all" }).click();

  expect(worker.mutePicks).toEqual([{ id: CHAT_ID, call: true, msg: true }]);
  await expect(
    page.locator(".conversation-rows__item", { hasText: "Rahi" }).getByText("Muted"),
  ).toBeVisible();
});

test("Create group with X rides the ticked peer along", async ({ page }) => {
  await enterSelect(page, "Rahi");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Create group with Rahi" }).click();

  await expect(page.getByRole("button", { name: "Deselect Rahi" })).toBeVisible();
});

test("select mode has no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await enterSelect(page, "Rahi");
  await expect(page.getByText("1 selected")).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
