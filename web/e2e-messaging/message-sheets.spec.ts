/** Message options and reaction sheets stay compact and keyboard-accessible. */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PEER_NAME, createMockWorker, ownPlaintextBody, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  const worker = await createMockWorker({});
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/chats");
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByText(ownPlaintextBody())).toBeVisible();
});

test("each message exposes a small three-dot menu beside its bubble", async ({ page }) => {
  const bubbles = page.locator(".bubble:not(.bubble--deleted)");
  const triggers = page.locator(".message-actions-menu__trigger");
  await expect(triggers).toHaveCount(await bubbles.count());
  await expect(page.locator(".bubble__meta .message-actions-menu__trigger")).toHaveCount(
    await triggers.count(),
  );
  const size = await triggers.first().boundingBox();
  expect(size).not.toBeNull();
  expect(size!.width).toBeLessThanOrEqual(24);
  expect(size!.height).toBeLessThanOrEqual(24);

  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.getByRole("button", { name: "Message options" }).click();
  const menu = ownBubble.getByRole("menu", { name: "Message actions" });
  await expect(menu).toBeVisible();
  for (const action of ["Reply", "Copy", "Info", "Forward", "Select this message", "Delete"]) {
    await expect(menu.getByRole("menuitem", { name: action, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole("menuitem", { name: "React thumbs up" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "More emojis" })).toBeVisible();
  await expect(page.locator(".message-actions, .reaction-bar")).toHaveCount(0);
});

test("Message info shows Sent / Delivered / Seen for my message", async ({ page }) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.getByRole("button", { name: "Message options" }).click();
  await ownBubble.getByRole("menuitem", { name: "Info", exact: true }).click();
  await expect(page.getByText("Message info", { exact: true })).toBeVisible();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)/).first()).toBeVisible();
});

test("Message info shows Received for the peer's message", async ({ page }) => {
  const theirsBubble = page.locator(".bubble", {
    hasText: "এই মেসেজটি ফোন থেকে এনক্রিপ্টেড",
  });
  await theirsBubble.getByRole("button", { name: "Message options" }).click();
  await theirsBubble.getByRole("menuitem", { name: "Info", exact: true }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
});

test("More emojis in the bubble menu opens the full reaction picker", async ({ page }) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.getByRole("button", { name: "Message options" }).click();
  await ownBubble.getByRole("menuitem", { name: "More emojis" }).click();
  await expect(page.getByText("React", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "React" }).getByRole("button")).toHaveCount(40);

  await page.getByRole("button", { name: "React 🔥" }).click();
  await expect(page.getByText("React", { exact: true })).toBeHidden();
});

test("the menu supports keyboard navigation, Escape, outside click and scroll dismissal", async ({
  page,
}) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  const trigger = ownBubble.getByRole("button", { name: "Message options" });
  const menu = ownBubble.getByRole("menu", { name: "Message actions" });

  await trigger.focus();
  await trigger.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "React thumbs up" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "React red heart" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByLabel("Message text", { exact: true }).click();
  await expect(menu).toHaveCount(0);

  await trigger.click();
  await expect(menu).toBeVisible();
  const transcript = page.locator(".transcript");
  const bounds = await transcript.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 8, bounds!.y + 12);
  await page.mouse.wheel(0, -160);
  await expect(menu).toHaveCount(0);
});

test("the message menu, info sheet and reaction picker have no axe violations", async ({
  page,
}) => {
  const ownBubble = page.locator(".bubble", { hasText: ownPlaintextBody() });
  await ownBubble.getByRole("button", { name: "Message options" }).click();
  let scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await ownBubble.getByRole("menuitem", { name: "Info", exact: true }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await ownBubble.getByRole("button", { name: "Message options" }).click();
  await ownBubble.getByRole("menuitem", { name: "More emojis" }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
