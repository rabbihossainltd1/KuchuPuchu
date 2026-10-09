import { expect, test } from "@playwright/test";

/**
 * Slice J exit gate: the service-worker migration that makes the cutover
 * safe for the installs that still carry the RETIRED legacy shell
 * (public/sw.js, kp-shell-v1/v2). A fresh visit must end with exactly one
 * shell cache lineage (kp-web-shell-<build>) and an offline-capable shell.
 */

const seedLegacyCaches = () => {
  // Runs before the app boots: pretend this browser lived through the
  // legacy PWA (both cache generations the retired worker could have left).
  void caches.open("kp-shell-v1").then((cache) => cache.put("/app.js", new Response("legacy v1")));
  void caches
    .open("kp-shell-v2")
    .then((cache) =>
      Promise.all([
        cache.put("/", new Response("legacy shell")),
        cache.put("/app.js", new Response("legacy v2")),
      ]),
    );
};

test("activation deletes every retired legacy shell cache and leaves one current cache", async ({
  page,
}) => {
  await page.addInitScript(seedLegacyCaches);
  await page.goto("/");

  // The prod build registers /sw.js; first visit has no controlling worker,
  // so install+activate run straight through (no skipWaiting needed).
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js") ?? false,
    undefined,
    { timeout: 20_000 },
  );

  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      const legacy = keys.filter((key) => key.startsWith("kp-shell-"));
      const current = keys.filter((key) => key.startsWith("kp-web-shell-"));
      return legacy.length === 0 && current.length === 1;
    },
    undefined,
    { timeout: 20_000 },
  );
});

test("the shell survives a network outage from the precache alone", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js") ?? false,
    undefined,
    { timeout: 20_000 },
  );

  await context.setOffline(true);
  await page.reload();
  // The signed-out production shell still paints its brand and sign-in copy.
  await expect(page.getByText("KuchuPuchu").first()).toBeVisible();
  await context.setOffline(false);
});

test("the precache manifest is the shell plus identity files, never api/ws", async ({ page }) => {
  const response = await page.request.get("/sw.js");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  const match = source.match(/const PRECACHE_URLS = (\[[^;]*\]);/);
  expect(match, "built worker must embed its precache manifest").toBeTruthy();
  const precache = JSON.parse(match?.[1] ?? "[]") as string[];

  expect(precache).toContain("/index.html");
  expect(precache).toContain("/icon.svg");
  expect(precache).toContain("/manifest.webmanifest");
  expect(precache.some((url) => url.startsWith("/assets/") && url.endsWith(".js"))).toBe(true);
  expect(precache.some((url) => url.startsWith("/assets/") && url.endsWith(".css"))).toBe(true);
  expect(precache.every((url) => !/^\/(?:api|ws)(?:\/|$)/.test(url))).toBe(true);
});
