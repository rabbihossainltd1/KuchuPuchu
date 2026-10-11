/**
 * Slice Z — the phone's message-level sheets: "Info" in the message actions
 * opens the Message info sheet (Sent/Delivered/Seen for mine, Received for
 * theirs, the phone's "23 Sep, 10:45 AM" stamps), and the quick reaction
 * bar's "+" opens the full "React" picker with the phone's forty emojis.
 */

import { expect, test } from "@playwright/test";
import { PEER_NAME, createMockWorker, ownPlaintextBody, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  const worker = await createMockWorker({});
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByText(ownPlaintextBody())).toBeVisible();
  return worker;
});

test("Message info shows Sent / Delivered / Seen for my message", async ({ page }) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.hover();
  await ownBubble.getByRole("button", { name: /Message info for/ }).click();
  await expect(page.getByText("Message info", { exact: true })).toBeVisible();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  // The phone's stamp: "11 Oct, h:mm AM/PM".
  await expect(page.getByText(/\d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)/).first()).toBeVisible();
});

test("Message info shows Received for the peer's message", async ({ page }) => {
  const theirsBubble = page.locator(".bubble", {
    hasText: "এই মেসেজটি ফোন থেকে এনক্রিপ্টেড",
  });
  await theirsBubble.hover();
  await theirsBubble.getByRole("button", { name: /Message info for/ }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
});

test("the quick bar rides on my messages too and + opens the full picker", async ({ page }) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.hover();
  // My own bubble now carries the quick reaction bar (phone parity).
  await expect(ownBubble.getByRole("button", { name: "React thumbs up" })).toBeVisible();

  await ownBubble.getByRole("button", { name: "More emojis" }).click();
  await expect(page.getByText("React", { exact: true })).toBeVisible();
  // The phone's forty seats.
  await expect(page.getByRole("dialog", { name: "React" }).getByRole("button")).toHaveCount(40);

  await page.getByRole("button", { name: "React 🔥" }).click();
  await expect(page.getByText("React", { exact: true })).toBeHidden();
});

test("the message sheets have no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.hover();
  await ownBubble.getByRole("button", { name: /Message info for/ }).click();
  let scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await ownBubble.hover();
  await ownBubble.getByRole("button", { name: "More emojis" }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
