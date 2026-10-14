/**
 * Slice Y — scheduled sends + disappearing messages, mirroring the phone's
 * ChatScreen: hold the send button for the "Send later" sheet, quick picks
 * and the custom day/clock picker park the draft with `sendAt`, the chip +
 * the ⋮ "Scheduled messages" view list and cancel them, and the ⋮
 * "Disappearing messages" sheet PATCHes the phone's four choices.
 */

import { expect, test, type Page } from "@playwright/test";
import { CHAT_ID, createMockWorker, signIn, type MockWorker } from "./helpers";

let worker: MockWorker;
let patchCalls: Array<Record<string, unknown>>;

const holdSend = async (page: Page) => {
  const button = page.getByRole("button", { name: /Send message/ });
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
};

const typeAndHold = async (page: Page) => {
  await page.getByRole("textbox", { name: /Message/ }).fill("salam later");
  await holdSend(page);
};

test.beforeEach(async ({ page }) => {
  patchCalls = [];
  worker = await createMockWorker({});
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.route(`**/api/conversations/${CHAT_ID}`, (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patchCalls.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto("/chats");
  await page.getByRole("link", { name: /Rahi/ }).click();
  await expect(page.getByRole("textbox", { name: /Message/ })).toBeVisible();
});

test("holding the send button opens Send later and a quick pick parks the draft", async ({
  page,
}) => {
  await typeAndHold(page);
  await expect(page.getByText("Send later", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "In 1 hour" })).toBeVisible();

  await page.getByRole("button", { name: "In 1 hour" }).click();

  // The sheet closes once the park lands; only then can the chip exist.
  await expect(page.getByText("Send later", { exact: true })).toBeHidden();
  const chip = page.locator(".composer__sched-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/Today|Tomorrow|\d{1,2} \w{3}/);

  // The worker got the draft with a sendAt ~1h out — never as a live send.
  const parked = worker.sent[worker.sent.length - 1];
  expect(parked?.body.sendAt).toBeTruthy();
  const at = Date.parse(String(parked?.body.sendAt));
  expect(at - Date.now()).toBeGreaterThan(50 * 60 * 1000);
  expect(at - Date.now()).toBeLessThan(70 * 60 * 1000);

  // The chip shows the parked row; the composer is clear again.
  await expect(page.getByRole("button", { name: /Today|Tomorrow|\d{1,2} \w{3}/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Message/ })).toHaveValue("");
});

test("the Scheduled view lists parked rows and Cancel removes them", async ({ page }) => {
  await typeAndHold(page);
  await page.getByRole("button", { name: "Tomorrow 8 AM" }).click();
  await expect(page.getByRole("button", { name: /Tomorrow 8:00 AM/ })).toBeVisible();

  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Scheduled messages" }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Tomorrow 8:00 AM").nth(1)).toBeVisible();

  await page.getByRole("button", { name: "Cancel scheduled message" }).click();
  await expect(page.getByText("Nothing is waiting to send.")).toBeVisible();

  // The sheet's chip is gone once nothing is parked.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("button", { name: "Scheduled messages" })).toHaveCount(0);
});

test("the custom picker offers day chips, a 12-hour clock and AM/PM", async ({ page }) => {
  await typeAndHold(page);
  await page.getByRole("button", { name: "Pick date & time" }).click();
  await expect(page.getByRole("radio", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Tomorrow" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "In a week" })).toBeVisible();

  await page.getByRole("radio", { name: "Tomorrow" }).click();
  await page.getByRole("radio", { name: "AM" }).click();
  // Hour wheel steps 1-12; the stamp mirrors the phone's format.
  await page.getByRole("button", { name: "Hour up" }).click();
  await expect(page.getByText(/Tomorrow \d{1,2}:\d{2} AM/)).toBeVisible();

  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const parked = worker.sent[worker.sent.length - 1];
  expect(parked?.body.sendAt).toBeTruthy();
});

test("a scheduled slash command sends only its body and preserves its metadata", async ({
  page,
}) => {
  await page.getByRole("textbox", { name: /Message/ }).fill("/silent call me later");
  await holdSend(page);
  await expect(page.getByText("Send later", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "In 1 hour" }).click();

  const parked = worker.sent[worker.sent.length - 1]?.body;
  expect(parked?.sendAt).toBeTruthy();
  expect(parked?.meta).toMatchObject({ silent: true });
  expect(String(parked?.body ?? "")).not.toContain("/silent");
  await expect(page.getByRole("textbox", { name: /Message/ })).toHaveValue("");
});

test("Disappearing messages offers the phone's four choices and PATCHes the pick", async ({
  page,
}) => {
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Disappearing messages" }).click();
  await expect(page.getByText("Disappearing messages", { exact: true })).toBeVisible();
  for (const label of ["Off", "24 hours", "7 days", "90 days"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await page.getByRole("button", { name: "24 hours" }).click();
  expect(patchCalls[0]).toMatchObject({ disappearSeconds: 86400 });
});

test("the schedule sheets have no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await typeAndHold(page);
  let scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole("button", { name: "Pick date & time" }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Disappearing messages" }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
