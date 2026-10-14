import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { GROUP_ID, PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

/**
 * Slice T — the profile / group-info drawer against the mocked Worker.
 * Pins: the person card (username, presence, about), Escape closes, the group
 * member list with roles, owner-only add/remove (two-step), and leave.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker and sockets.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openChat = async (page: Page, name: RegExp) => {
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ ownGroup: true });
  chatSocket = null;
  userSocket = null;

  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, (ws) => {
    chatSocket = ws;
  });
  await page.routeWebSocket(/\/ws\/user/, (ws) => {
    userSocket = ws;
  });

  await page.goto("/chats");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
});

test.describe("Web profile and group info", () => {
  test("the person card shows username, presence and about; Escape closes", async ({ page }) => {
    await openChat(page, new RegExp(PEER_NAME));
    await page.getByRole("button", { name: new RegExp(`Open ${PEER_NAME} profile`) }).click();

    const drawer = page.getByRole("dialog", { name: new RegExp(`${PEER_NAME} profile`) });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("@rahi")).toBeVisible();
    await expect(drawer.getByText("online")).toBeVisible();
    await expect(drawer.getByText("tea & stickers")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Message", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  test("nickname editing is under the profile's three-dot menu, not conversation options", async ({
    page,
  }) => {
    await openChat(page, new RegExp(PEER_NAME));
    await page.getByRole("button", { name: new RegExp(`Open ${PEER_NAME} profile`) }).click();
    const profile = page.getByRole("dialog", { name: new RegExp(`${PEER_NAME} profile`) });
    await profile.getByRole("button", { name: "Close profile" }).click();

    await page.getByRole("button", { name: "More options" }).click();
    const conversationMenu = page.getByRole("dialog", {
      name: `Conversation options for ${PEER_NAME}`,
    });
    await expect(conversationMenu.getByRole("button", { name: "Nicknames" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: new RegExp(`Open ${PEER_NAME} profile`) }).click();
    await profile.getByRole("button", { name: "More profile options" }).click();
    await profile.getByRole("menuitem", { name: "Nicknames" }).click();
    await profile.getByRole("button", { name: PEER_NAME, exact: true }).click();

    const input = page.getByLabel("Nickname", { exact: true });
    const inputBox = await input.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.width).toBeGreaterThan(200);
    await input.fill("Bestie");
    await profile.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() => worker.nicknames)
      .toEqual([{ conversationId: "c_direct", userId: "u_peer", nickname: "Bestie" }]);
    await expect(profile.getByText("Rahi · Bestie")).toBeVisible();
  });

  test("the group card lists members with roles and the owner can remove", async ({ page }) => {
    await openChat(page, /Squad/);
    await page.getByRole("button", { name: /Open Squad profile/ }).click();

    const drawer = page.getByRole("dialog", { name: /Squad profile/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("3 members")).toBeVisible();
    await expect(drawer.getByText("owner", { exact: true })).toBeVisible();

    // Two-step remove reaches the Worker's member route.
    await drawer.getByRole("button", { name: "Remove Third Member from the group" }).click();
    await drawer.getByRole("button", { name: "Remove — confirm" }).click();
    await expect.poll(() => worker.removedMembers).toContain("u_third");

    // Owner-only add-member search offers the directory person.
    await drawer.getByLabel("Search people to add to the group").fill("directory");
    await drawer.getByRole("button", { name: "Add Directory Person to the group" }).click();
    await expect.poll(() => worker.addedMembers).toContain("u_dir");
  });

  test("leave group asks twice and returns to the list", async ({ page }) => {
    await openChat(page, /Squad/);
    await page.getByRole("button", { name: /Open Squad profile/ }).click();

    const drawer = page.getByRole("dialog", { name: /Squad profile/ });
    await drawer.getByRole("button", { name: "Leave Group" }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${GROUP_ID}`));
    await drawer.getByRole("button", { name: "Leave group — confirm" }).click();

    await expect.poll(() => worker.removedMembers).toContain("u_me");
    await expect(page).not.toHaveURL(new RegExp(`/chats/${GROUP_ID}`));
  });

  test("a search person opens the same card before any chat exists", async ({ page }) => {
    await page.getByRole("link", { name: "Search" }).click();
    await page.getByLabel("Search people, chats and messages").fill("directory");
    await page.getByRole("button", { name: "Open Directory Person profile" }).click();

    const drawer = page.getByRole("dialog", { name: /Directory Person profile/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("@dirperson")).toBeVisible();
    await drawer.getByRole("button", { name: "Message", exact: true }).click();
    await expect(page).toHaveURL(/\/chats\/c_dir/);
    expect(worker.createdConversations).toEqual(["u_dir"]);
  });
});
