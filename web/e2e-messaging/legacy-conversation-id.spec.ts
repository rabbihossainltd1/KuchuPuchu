import { expect, test, type WebSocketRoute } from "@playwright/test";
import { PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

/**
 * Legacy conversation-id regression.
 *
 * Pre-2026 SOLO conversations carry ids shaped `c_<uuid>_<uuid>` — 75 chars.
 * The protocol parser once capped ids at 64, silently clipping those ids, so
 * every conversation-scoped request 404'd for old accounts: history never
 * loaded ("That item is no longer available") and sends died in the cloud.
 * This spec pins the full id through the list, the transcript load and a send.
 */
const LEGACY_ID = "c_2541ac80-ecb9-4a68-96e5-1dda334fdc52_f9864c26-b413-48ba-9b7f-be64fed8d6d6";

let worker: MockWorker;

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ chatId: LEGACY_ID });
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/chats");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
});

test("a 75-char legacy conversation loads history and sends", async ({ page }) => {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();

  // The router must navigate with the FULL id — a truncated id would 404 the
  // detail and messages routes and show the "no longer available" fallback.
  await expect(page).toHaveURL(new RegExp(`/chats/${LEGACY_ID}`));
  await expect(page.getByRole("heading", { level: 2, name: PEER_NAME })).toBeVisible();

  // Sealed history decrypts — the transcript really loaded.
  await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();
  await expect(page.getByText("That item is no longer available.")).toHaveCount(0);

  // Send against the full id — the worker must receive the untripped id.
  const composer = page.getByLabel("Message text", { exact: true });
  await composer.fill("legacy id send");
  await page.keyboard.press("Enter");
  // Scope to the transcript: right after Enter the composer may still hold the
  // draft for a frame, and getByText would trip over both in strict mode.
  await expect(page.locator(".transcript").getByText("legacy id send")).toBeVisible();
  await expect.poll(() => worker.sent.length).toBeGreaterThan(0);
  expect(worker.sent[0]?.conversationId).toBe(LEGACY_ID);
});
