/**
 * Slice AI — the phone's AI chat menu on the web: History opens the
 * read-only archive ("AI History" / "Session"), "New chat" wipes over
 * POST …/reset, and the incognito row toggles between a fresh wipe and
 * POST …/restore-latest, exactly the phone's round-7/11 flow.
 */

import { expect, test } from "@playwright/test";
import { AI_CHAT_ID, createMockWorker, signIn, type MockWorker } from "./helpers";

let worker: MockWorker;

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ withAi: true });
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/chats");
  await page.getByRole("link", { name: /KuchuPuchu AI/ }).click();
  await expect(page.getByRole("textbox", { name: /Message/ })).toBeVisible();
});

test("the AI chat menu carries the phone's six entries", async ({ page }) => {
  await page.getByRole("button", { name: "More options" }).click();
  const menu = page.getByRole("dialog", { name: /Conversation options/ });
  for (const name of [
    "History",
    "New chat",
    "Mute…",
    "Chat theme",
    "Incognito mode",
    "Search in chat",
  ]) {
    await expect(menu.getByRole("button", { name })).toBeVisible();
  }
  // The solo-chat rows never leak into the AI menu.
  await expect(menu.getByRole("button", { name: "Hide chat" })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Delete chat" })).toHaveCount(0);
});

test("New chat wipes the transcript over the reset route", async ({ page }) => {
  await page.getByRole("button", { name: "More options" }).click();
  await page
    .getByRole("dialog", { name: /Conversation options/ })
    .getByRole("button", { name: "New chat" })
    .click();
  await expect(page.locator(".bubble", { hasText: "Hi! I'm your KuchuPuchu AI." })).toHaveCount(0);
  expect(worker.aiResets).toEqual([AI_CHAT_ID]);
});

test("History lists archived sessions and opens them read-only", async ({ page }) => {
  await page.getByRole("button", { name: "More options" }).click();
  await page
    .getByRole("dialog", { name: /Conversation options/ })
    .getByRole("button", { name: "History" })
    .click();

  await expect(page.getByText("AI History", { exact: true })).toBeVisible();
  await expect(page.getByText("Your past KuchuPuchu AI sessions")).toBeVisible();
  await expect(page.getByText("2 messages")).toBeVisible();

  await page.getByRole("button", { name: /View/ }).click();
  await expect(page.getByText("Session", { exact: true })).toBeVisible();
  await expect(page.getByText("Read-only archive")).toBeVisible();
  await expect(page.getByText("hello ai")).toBeVisible();
  await expect(page.getByText("Hello! Ask me anything.")).toBeVisible();
});

test("Incognito wipes on open and restores on close", async ({ page }) => {
  const menu = () => page.getByRole("dialog", { name: /Conversation options/ });
  await page.getByRole("button", { name: "More options" }).click();
  await menu().getByRole("button", { name: "Incognito mode" }).click();
  expect(worker.aiResets).toEqual([AI_CHAT_ID]);

  await page.getByRole("button", { name: "More options" }).click();
  await menu().getByRole("button", { name: "Close incognito mode" }).click();
  expect(worker.aiRestores).toEqual([AI_CHAT_ID]);
});

test("the AI history pane has no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await page.getByRole("button", { name: "More options" }).click();
  await page
    .getByRole("dialog", { name: /Conversation options/ })
    .getByRole("button", { name: "History" })
    .click();
  await expect(page.getByText("AI History", { exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
