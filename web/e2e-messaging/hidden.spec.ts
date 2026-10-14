import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { CHAT_ID, PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

let worker: MockWorker;
let hideCalls: Array<{ id: string; hidden: number; key?: string }>;
let deleteCalls: Array<{ id: string; forEveryone: boolean }>;

const installHiddenRoutes = async (page: Page) => {
  await page.route("**/api/conversations/*/hide", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3] ?? "");
    const body = route.request().postDataJSON() as { hidden?: number; key?: string };
    hideCalls.push({ id, hidden: Number(body.hidden ?? 0), key: body.key });
    worker.hideOverrides[id] = {
      hidden: Number(body.hidden ?? 0),
      hiddenKey: Number(body.hidden ?? 0) === 1 ? (body.key ?? null) : null,
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/conversations/c_direct", (route) => {
    if (route.request().method() === "DELETE") {
      const body = route.request().postDataJSON() as { forEveryone?: boolean };
      deleteCalls.push({ id: CHAT_ID, forEveryone: body.forEveryone === true });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, forEveryone: body.forEveryone === true }),
      });
    }
    return route.fallback();
  });
};

test.beforeEach(async ({ page }) => {
  hideCalls = [];
  deleteCalls = [];
  worker = await createMockWorker({});
  await signIn(page);
  await worker.install(page);

  await installHiddenRoutes(page);

  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});

  await page.goto("/chats");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
});

test.describe("Web hidden chats", () => {
  test("Hide chat asks for a secret key and stores only its hash", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Hide chat" }).click();

    const keyInput = page.getByLabel("Secret key");
    await expect(keyInput).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide", exact: true })).toBeDisabled();
    await keyInput.fill("pluto");

    await page.getByRole("button", { name: "Hide", exact: true }).click();

    // Only the SHA-256 of the trimmed key reaches the server.
    await expect.poll(() => hideCalls.length).toBe(1);
    expect(hideCalls[0]).toEqual({ id: CHAT_ID, hidden: 1, key: sha256("pluto") });

    // The list drops the chat once the refresh sees hidden=1.
    await expect(page.getByRole("link", { name: new RegExp(PEER_NAME) })).toHaveCount(0);
  });

  test("the key typed in Search reveals the hidden chat; Unhide brings it back", async ({
    page,
  }) => {
    worker.hideOverrides[CHAT_ID] = { hidden: 1, hiddenKey: sha256("mango") };
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();

    // A plain search never lists the hidden chat or its person.
    await page.getByRole("link", { name: "Search" }).click();
    const field = page.getByLabel("Search people, chats and messages");
    await field.fill("rah");
    await expect(page.getByRole("heading", { name: "Hidden" })).toHaveCount(0);
    await expect(page.locator(".search-results")).not.toContainText(PEER_NAME);

    // The key itself reveals it under a Hidden section.
    await field.fill("mango");
    await expect(page.getByRole("heading", { name: "Hidden" })).toBeVisible();
    const hiddenRow = page.locator('ul[aria-label="Hidden chats revealed by this key"] li');
    await expect(hiddenRow).toContainText(PEER_NAME);

    await hiddenRow.getByRole("button", { name: `Unhide ${PEER_NAME}` }).click();
    await expect.poll(() => hideCalls.length).toBe(1);
    expect(hideCalls[0]).toEqual({ id: CHAT_ID, hidden: 0 });

    // Back in the list, the chat is ordinary again.
    await page.getByRole("link", { name: "Chats" }).click();
    await expect(page.getByRole("link", { name: new RegExp(PEER_NAME) })).toBeVisible();
  });

  test("Delete chat is the phone's dialog: forEveryone checkbox over DELETE", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Delete chat" }).click();

    await expect(page.getByText(`Permanently delete the chat with ${PEER_NAME}?`)).toBeVisible();
    const also = page.getByLabel(`Also delete for ${PEER_NAME}`);
    await expect(also).not.toBeChecked();

    await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
    await expect.poll(() => deleteCalls.length).toBe(1);
    expect(deleteCalls[0]).toEqual({ id: CHAT_ID, forEveryone: false });

    // Second chat? one delete is enough to pin the contract; now the tick.
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Delete chat" }).click();
    await page.getByLabel(`Also delete for ${PEER_NAME}`).check();
    await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
    await expect.poll(() => deleteCalls.length).toBe(2);
    expect(deleteCalls[1]).toEqual({ id: CHAT_ID, forEveryone: true });
  });

  test("the Hide chat sheet has no axe violations", async ({ page }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Hide chat" }).click();
    await page.getByLabel("Secret key").fill("axe-key");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
