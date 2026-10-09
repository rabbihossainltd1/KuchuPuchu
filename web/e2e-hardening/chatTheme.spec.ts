import { expect, test, type Page, type Route } from "@playwright/test";
import { CHAT_ID, createMockWorker, signIn } from "../e2e-messaging/helpers";

/**
 * Slice I per-chat themes: the five Android palettes (darkblue/default/mint/
 * rose/night), stored server-side via the existing PATCH route, applied to the
 * pane through CSS custom properties — with an honest lock for non-owner
 * groups.
 */

async function captureThemePatches(page: Page) {
  const patches: Array<{ conversationId: string; theme: string }> = [];
  await page.route("**/api/conversations/*", async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    patches.push({
      conversationId: new URL(route.request().url()).pathname.split("/").pop() ?? "",
      theme: String(body.theme ?? ""),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  return patches;
}

test("picking a chat theme repaints the pane and PATCHes the server once", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  const patches = await captureThemePatches(page);

  await page.goto("/");
  await page.getByText("Rahi").first().click();
  const pane = page.locator("main.conversation-pane");
  await expect(pane).toHaveAttribute("data-chat-theme", "darkblue");

  await page.getByText("Theme · থিম").click();
  await page.getByRole("radio", { name: /Mint/ }).click();

  await expect(pane).toHaveAttribute("data-chat-theme", "mint");
  // The wallpaper variable really re-paints the transcript.
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.querySelector(".transcript")!).backgroundColor),
    )
    .toBe("rgb(12, 26, 21)"); // mint wallpaper in dark-blue mode (#0C1A15)

  expect(patches).toEqual([{ conversationId: CHAT_ID, theme: "mint" }]);

  // Choosing the same theme again is a no-op — no second PATCH.
  await page.getByRole("radio", { name: /Mint/ }).click();
  expect(patches).toHaveLength(1);

  // Night switches both the wallpaper and the own-bubble gradient endpoints.
  await page.getByRole("radio", { name: /Night/ }).click();
  await expect(pane).toHaveAttribute("data-chat-theme", "night");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.querySelector("main.conversation-pane")!).getPropertyValue(
          "--chat-mine-from",
        ),
      ),
    )
    .toBe("#818cf8");
  expect(patches.at(-1)).toEqual({ conversationId: CHAT_ID, theme: "night" });
});

test("a refused theme save rolls back and explains", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await page.route("**/api/conversations/*", async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Only the group owner can change these settings." }),
    });
  });

  await page.goto("/");
  await page.getByText("Rahi").first().click();
  const pane = page.locator("main.conversation-pane");

  await page.getByText("Theme · থিম").click();
  await page.getByRole("radio", { name: /Rose/ }).click();

  // The optimistic flip is undone…
  await expect(pane).toHaveAttribute("data-chat-theme", "darkblue");
  // …and the refusal is announced, not swallowed.
  await expect(page.getByText(/could not be saved/i)).toBeVisible();
});

test("a non-owner group says who may change the theme instead of showing a picker", async ({
  page,
}) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);

  await page.goto("/");
  await page.getByText("Squad").first().click();

  await expect(page.getByText(/Only the group owner can change this chat's theme/)).toBeVisible();
  await expect(page.locator(".chat-theme-menu")).toHaveCount(0);
});

test("all five Android themes apply distinct wallpapers", async ({ page }) => {
  await signIn(page);
  const worker = await createMockWorker();
  await worker.install(page);
  await captureThemePatches(page);

  await page.goto("/");
  await page.getByText("Rahi").first().click();
  await page.getByText("Theme · থিম").click();

  const expected: Array<[RegExp, string]> = [
    [/Mint/, "rgb(12, 26, 21)"],
    [/Rose/, "rgb(35, 20, 26)"],
    [/Night/, "rgb(11, 18, 32)"],
    [/Classic Cream/, "rgb(13, 21, 36)"], // default theme keeps the dark-blue app wallpaper
    [/Dark Blue/, "rgb(13, 21, 36)"],
  ];

  for (const [name, background] of expected) {
    await page.getByRole("radio", { name }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.querySelector(".transcript")!).backgroundColor,
        ),
      )
      .toBe(background);
  }
});
