import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createMockWorker, signIn } from "../e2e-messaging/helpers";

/**
 * Slice I exit gate: the visual matrix. Every supported breakpoint × both app
 * themes renders the chat list, saves a screenshot artifact and passes axe
 * WCAG 2.1/2.2 A/AA — contrast included, because a theme that fails contrast
 * is not a theme, it is a bug.
 *
 * Breakpoints come from the parity plan §9.1: 390×844 (phone), 768×1024
 * (tablet), 1366×768 and 1920×1080 (desktop-first coexistence).
 */

const BREAKPOINTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;

const THEMES = [
  { name: "dark-blue", storage: "dark_blue", attribute: "dark_blue" },
  { name: "light-cream", storage: "light", attribute: "light" },
] as const;

for (const theme of THEMES) {
  for (const breakpoint of BREAKPOINTS) {
    test(`the chat list renders ${theme.name} at ${breakpoint.name} and passes axe`, async ({
      page,
    }) => {
      await signIn(page);
      // The stored theme must exist BEFORE first paint — main.tsx applies it
      // synchronously at module load.
      await page.addInitScript((value: string) => {
        window.localStorage.setItem("kp.app_theme", value);
      }, theme.storage);

      const worker = await createMockWorker();
      await worker.install(page);
      await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
      await page.goto("/");

      // The attribute is the whole theme contract: tokens re-key off it.
      await expect(page.locator("html")).toHaveAttribute("data-kp-theme", theme.attribute);
      // The mock's direct chat is present — the list really rendered.
      await expect(page.getByText("Rahi").first()).toBeVisible();

      await expect(page).toHaveScreenshot(`list-${theme.name}-${breakpoint.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.01,
      });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
    });
  }
}

for (const theme of THEMES) {
  test(`the open chat renders ${theme.name} on desktop and passes axe`, async ({ page }) => {
    await signIn(page);
    await page.addInitScript((value: string) => {
      window.localStorage.setItem("kp.app_theme", value);
    }, theme.storage);

    const worker = await createMockWorker();
    await worker.install(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");

    await page.getByText("Rahi").first().click();
    await expect(page.locator(".conversation-heading, #conversation-heading")).toBeVisible();

    await expect(page).toHaveScreenshot(`chat-${theme.name}-1366x768.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
  });
}

test("the appearance card lists both themes and switches live", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await page.goto("/account");

  const darkRadio = page.getByRole("radio", { name: /Dark Blue/ });
  const lightRadio = page.getByRole("radio", { name: /Light Cream/ });
  await expect(darkRadio).toBeChecked();

  await lightRadio.check();
  await expect(page.locator("html")).toHaveAttribute("data-kp-theme", "light");
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("kp.app_theme")))
    .toBe("light");

  await darkRadio.check();
  await expect(page.locator("html")).toHaveAttribute("data-kp-theme", "dark_blue");
});
