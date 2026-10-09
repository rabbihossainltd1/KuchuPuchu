import { expect, test, type Page } from "@playwright/test";
import { createMockWorker, signIn } from "../e2e-messaging/helpers";

/**
 * Slice I account isolation: the IndexedDB outbox/draft database belongs to
 * ONE login. Signing out must drop the whole database — the phone enforces the
 * same wall, and an outbox surviving an account switch is a cross-account data
 * leak by construction.
 */

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    if (typeof indexedDB === "undefined" || !("databases" in indexedDB)) return [];
    const infos = await indexedDB.databases();
    return infos.map((info) => info.name ?? "");
  });
}

test("signing out deletes the messaging database", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);

  await page.goto("/");
  await page.getByText("Rahi").first().click();

  // Create a durable draft so the database really exists.
  const composer = page.locator("#composer, textarea").first();
  await composer.click();
  await composer.fill("a draft that must not survive logout");
  await expect.poll(async () => databaseNames(page)).toContain("kp-web-messaging");

  // Sign out from the account page.
  await page.goto("/account");
  await page.getByRole("button", { name: /Sign out/i }).click();

  // The database is gone — not just emptied, DELETED.
  await expect
    .poll(async () => databaseNames(page), { timeout: 10_000 })
    .not.toContain("kp-web-messaging");
  // And the token with it.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("kp.token"))).toBeNull();
});

test("a 401-forced sign-out wipes the database too", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);

  await page.goto("/");
  await page.getByText("Rahi").first().click();
  const composer = page.locator("#composer, textarea").first();
  await composer.click();
  await composer.fill("another draft");
  await expect.poll(async () => databaseNames(page)).toContain("kp-web-messaging");

  // The session restore now answers 401 — the same path a revoked token
  // takes. The forced clear must wipe the database exactly like a manual
  // sign-out does.
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.reload();

  await expect
    .poll(async () => databaseNames(page), { timeout: 10_000 })
    .not.toContain("kp-web-messaging");
});
