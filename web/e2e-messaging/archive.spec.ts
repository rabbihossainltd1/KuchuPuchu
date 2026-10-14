/**
 * Slice AP — pin + archive parity: the phone keeps both flags on the
 * device (ScreenStore), the web mirrors them in localStorage; the main
 * list floats pinned rows and hides archived ones behind the
 * "Archived (n)" entry that opens the phone's ArchiveScreen port.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createMockWorker, signIn } from "./helpers";

async function dispatchTouch(
  page: Page,
  target: Locator,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  y: number,
): Promise<void> {
  await target.evaluate(
    (element, event) => {
      const touch = new Touch({
        identifier: 31,
        target: element,
        clientX: 120,
        clientY: event.y,
        screenX: 120,
        screenY: event.y,
      });
      const ending = event.type === "touchend" || event.type === "touchcancel";
      element.dispatchEvent(
        new TouchEvent(event.type, {
          bubbles: true,
          cancelable: true,
          touches: ending ? [] : [touch],
          changedTouches: [touch],
        }),
      );
    },
    { type, y },
  );
}

test.beforeEach(async ({ page }) => {
  const worker = await createMockWorker();
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/chats");
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

test("touch-pulling the list top and holding opens Archive with the ring progress", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const row = page.getByRole("link", { name: /^Rahi/ });
  const progress = page.getByRole("progressbar", { name: "Opening archived chats" });

  await dispatchTouch(page, row, "touchstart", 220);
  await dispatchTouch(page, row, "touchmove", 320);
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);
  await expect(page.getByRole("dialog", { name: "Archived" })).toBeVisible({ timeout: 6_000 });
  await expect(
    page.getByRole("dialog", { name: "Archived" }).getByText("No archived chats"),
  ).toBeVisible();
});

test("a pull begun on the list header also opens Archive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const title = page.getByRole("heading", { name: "Chats" });
  await dispatchTouch(page, title, "touchstart", 100);
  await dispatchTouch(page, title, "touchmove", 200);
  await expect(page.getByRole("progressbar", { name: "Opening archived chats" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Archived" })).toBeVisible({ timeout: 6_000 });
});

test("releasing a pull early cancels it and does not activate the chat row", async ({ page }) => {
  const row = page.getByRole("link", { name: /^Rahi/ });
  const initialUrl = page.url();
  const progress = page.getByRole("progressbar", { name: "Opening archived chats" });

  await dispatchTouch(page, row, "touchstart", 180);
  await dispatchTouch(page, row, "touchmove", 280);
  await expect(progress).toBeVisible();
  await page.waitForTimeout(150);
  await dispatchTouch(page, row, "touchend", 280);
  await expect(progress).toHaveCount(0);
  await row.dispatchEvent("click", { button: 0 });
  await expect(page).toHaveURL(initialUrl);
  await page.waitForTimeout(2_100);
  await expect(page.getByRole("dialog", { name: "Archived" })).toHaveCount(0);
});

test("the archive pull only arms while the conversation list is at its top", async ({ page }) => {
  const scroller = page.locator(".list-content");
  await scroller.evaluate((element: HTMLDivElement) => {
    element.style.flex = "0 0 120px";
    element.style.height = "120px";
    element.scrollTop = 48;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const row = page.getByRole("link", { name: /^Rahi/ });
  await dispatchTouch(page, row, "touchstart", 180);
  await dispatchTouch(page, row, "touchmove", 280);
  await expect(page.getByRole("progressbar", { name: "Opening archived chats" })).toHaveCount(0);
  await dispatchTouch(page, row, "touchend", 280);
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
