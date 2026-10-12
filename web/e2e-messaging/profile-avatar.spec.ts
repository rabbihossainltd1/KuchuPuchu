/** Profile-photo regressions: show the account photo in a true circular crop. */

import { expect, test, type Page } from "@playwright/test";
import { createMockWorker, signIn } from "./helpers";

const portraitSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="80" viewBox="0 0 48 80"><rect width="48" height="80" fill="#d97706"/><circle cx="24" cy="18" r="11" fill="#fef3c7"/><path d="M4 80c1-22 10-34 20-34s19 12 20 34" fill="#2563eb"/></svg>`;
const profileAvatarUrl = `data:image/svg+xml,${encodeURIComponent(portraitSvg)}`;

async function openAccount(page: Page, options: { profileAvatarRef?: string } = {}) {
  const worker = await createMockWorker({ profileAvatarUrl, ...options });
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
}

async function expectCircularPhoto(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const frame = page.locator(".account-avatar");
  const image = frame.locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(48);
  const geometry = await frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      radius: getComputedStyle(element).borderRadius,
      fit: getComputedStyle(element.querySelector("img")!).objectFit,
    };
  });
  expect(geometry.width).toBe(geometry.height);
  expect(geometry.radius).toBe("50%");
  expect(geometry.fit).toBe("cover");
}

test("the account hero uses a direct profile photo in a circular crop", async ({ page }) => {
  await openAccount(page);
  await expectCircularPhoto(page, { width: 390, height: 844 });
  await expectCircularPhoto(page, { width: 1280, height: 800 });
});

test("the account hero resolves avatarRef when /api/me has no avatarUrl", async ({ page }) => {
  await openAccount(page, { profileAvatarRef: "u_me@v2" });
  await expectCircularPhoto(page, { width: 390, height: 844 });
  await expectCircularPhoto(page, { width: 1280, height: 800 });
});
