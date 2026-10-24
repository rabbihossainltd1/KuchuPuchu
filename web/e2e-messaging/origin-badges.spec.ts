import { expect, test } from "@playwright/test";
import { createMockWorker, signIn, PEER_NAME } from "./helpers";

for (const realm of ["kp", "vx", "unknown"]) {
  test(`original ${realm} origin artwork beside names, independent of verification choice`, async ({
    page,
  }) => {
    const worker = await createMockWorker({
      peerRealm: realm,
      peerBadges: { badge: "none", verified: true },
    });
    await signIn(page);
    await worker.install(page);
    await page.routeWebSocket(/\/ws\//, () => {});
    await page.goto("/chats");
    const row = page.getByRole("link", { name: new RegExp(PEER_NAME) }).first();
    await expect(row).toBeVisible();
    const badge = row.locator(".realm-badge");
    if (realm === "unknown") {
      await expect(badge).toHaveCount(0);
    } else {
      await expect(badge).toHaveAttribute("alt", `${realm.toUpperCase()} account origin`);
      expect(
        await badge.evaluate((node) => {
          const img = node as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
      ).toBe(true);
      const box = await badge.boundingBox();
      expect(box?.width).toBe(16);
      expect(box?.height).toBe(16);
      await expect(row.locator(".badge-seal")).toHaveCount(0);
    }
    await row.click();
    const heading = page.locator("#conversation-heading");
    await expect(heading).toContainText(PEER_NAME);
    await expect(heading.locator(".realm-badge")).toHaveCount(realm === "unknown" ? 0 : 1);
  });
}
