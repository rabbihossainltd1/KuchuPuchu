import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { CHAT_ID, PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

/**
 * Slice S — global search, new chat and in-chat search against the mocked
 * Worker. Pins: the three result groups, sealed bodies previewing as the
 * category word (never ciphertext), a message hit landing on its row, an
 * older-than-loaded hit saying so aloud, and New chat opening the 1:1 as a
 * message request the way a username search does on the phone.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker and sockets.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openSearch = async (page: Page) => {
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByLabel("Search people, chats and messages")).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ withAttachment: true, withOnce: true });
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

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
});

test.describe("Web global search", () => {
  test("one field answers people, chats and message text", async ({ page }) => {
    await openSearch(page);
    const field = page.getByLabel("Search people, chats and messages");

    // Under two characters nothing fires.
    await field.fill("p");
    await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);

    await field.fill("pineapple");
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await expect(page.getByText("pineapple parcel arrives friday")).toBeVisible();
    // A sealed hit previews as its category word — ciphertext never renders.
    await expect(page.getByText("KP1.")).toHaveCount(0);
    await expect(page.getByText("Message", { exact: true }).first()).toBeVisible();

    await field.fill("squad");
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await page.getByRole("link", { name: new RegExp("Squad") }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/`));

    await openSearch(page);
    await page.getByLabel("Search people, chats and messages").fill("directory");
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByText("@dirperson")).toBeVisible();
  });

  test("a message hit opens its chat and lands on the row", async ({ page }) => {
    await openSearch(page);
    await page.getByLabel("Search people, chats and messages").fill("pineapple");
    await page
      .getByRole("button", { name: new RegExp(PEER_NAME) })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`/chats/${CHAT_ID}`));
    await expect(page.getByText("pineapple parcel arrives friday")).toBeVisible();
  });

  test("a hit older than the loaded history says so instead of pretending", async ({ page }) => {
    await openChat(page);
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Search in chat" }).click();
    await page.getByLabel("Search messages in this chat").fill("pineapple");

    // The sealed match is offered, previews as its category word, and picking
    // it discloses that the row is not in the loaded page.
    await expect(page.getByText("KP1.")).toHaveCount(0);
    const sealed = page
      .locator(".chat-menu__find-results .chat-menu__row")
      .filter({ hasText: "Message" })
      .first();
    await sealed.click();
    await expect(page.getByText(/older than the loaded history/)).toBeVisible();
  });

  test("New chat opens the directory person as a message request", async ({ page }) => {
    // The list header's plus is live now, and lands on the search pane.
    await page.getByRole("button", { name: "New chat" }).click();
    const field = page.getByLabel("Search people, chats and messages");
    await expect(field).toBeFocused();
    await field.fill("directory");

    await page.getByRole("button", { name: "Message Directory Person" }).click();
    await expect(page).toHaveURL(/\/chats\/c_dir/);
    expect(worker.createdConversations).toEqual(["u_dir"]);
    await expect(page.getByRole("heading", { name: "Directory Person" }).first()).toBeVisible();
  });

  test("in-chat search finds a loaded row and the transcript scrolls to it", async ({ page }) => {
    await openChat(page);
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Search in chat" }).click();

    const field = page.getByLabel("Search messages in this chat");
    await expect(field).toBeFocused();
    await field.fill("pineapple");
    await expect(page.getByText("pineapple parcel arrives friday")).toBeVisible();

    await page
      .locator(".chat-menu__find-results .chat-menu__row")
      .filter({ hasText: "pineapple" })
      .click();

    // The sheet closes and the row stays put in the transcript.
    await expect(page.getByLabel("Search messages in this chat")).toHaveCount(0);
    await expect(page.getByText("pineapple parcel arrives friday").first()).toBeVisible();
  });
});

async function openChat(page: Page) {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();
}
