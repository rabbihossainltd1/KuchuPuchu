import { expect, test } from "@playwright/test";
import { createMockWorker, signIn } from "../e2e-messaging/helpers";

/**
 * Slice I motion rules (parity plan §4.3): the whole UI animates through two
 * tokens, and `prefers-reduced-motion: reduce` must still it — decorations may
 * never make a reader wait, and the global kill-switch in styles.css must hold
 * even for surfaces that forgot the tokens.
 */

/** Chromium may serialise a custom-property time as "0s" or "150ms". */
const toMs = (value: string): number =>
  value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;

test("motion tokens are zero under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await page.goto("/");

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      fast: style.getPropertyValue("--kp-motion-fast").trim(),
      normal: style.getPropertyValue("--kp-motion-normal").trim(),
    };
  });
  expect(toMs(tokens.fast)).toBe(0);
  expect(toMs(tokens.normal)).toBe(0);
});

test("motion tokens keep their durations without the preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await page.goto("/");

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      fast: style.getPropertyValue("--kp-motion-fast").trim(),
      normal: style.getPropertyValue("--kp-motion-normal").trim(),
    };
  });
  expect(toMs(tokens.fast)).toBe(150);
  expect(toMs(tokens.normal)).toBe(220);
});

test("conversation rows are effectively still under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await page.goto("/");

  const row = page.locator(".conversation-row").first();
  await expect(row).toBeVisible();
  const durations = await row.evaluate((element) => {
    const style = getComputedStyle(element);
    const first = (list: string) => list.split(",")[0]?.trim() ?? "";
    return {
      transition: first(style.transitionDuration),
      animation: first(style.animationDuration),
    };
  });
  // The kill-switch allows a cosmetic 0.01ms; anything above that is motion.
  expect(parseFloat(durations.transition)).toBeLessThanOrEqual(0.01);
  expect(parseFloat(durations.animation)).toBeLessThanOrEqual(0.01);
});
