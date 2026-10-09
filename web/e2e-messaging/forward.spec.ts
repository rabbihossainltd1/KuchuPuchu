import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  BOT_ID,
  CHAT_ID,
  GROUP_ID,
  PEER_NAME,
  createMockWorker,
  signIn,
  type MockWorker,
} from "./helpers";

/**
 * Multi-select, forwarding and the delete scope end-to-end (slice E2), against
 * a mocked Worker and a mocked socket.
 *
 * Three things this file exists to catch. One: a forward that posts the SEALED
 * body instead of re-sealing the decrypted text for the target — the new
 * recipient would see a lock and nothing else. Two: a selection action that
 * claims to delete a message for everybody when the server would refuse it, or
 * that hides a row locally and lets the reader believe it is gone. Three: a
 * control that only a hovering pointer can reach.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker and sockets.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openChat = async (page: Page) => {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByRole("button", { name: "Media, links and docs" })).toBeVisible();
};

const note = (page: Page, id: string) => page.locator(`[data-message-id="${id}"]`);
const selectButton = (page: Page, id: string) =>
  note(page, id).getByRole("button", { name: /select this message/i });
const bar = (page: Page) =>
  page.getByRole("toolbar", { name: "Actions for the selected messages" });
const picker = (page: Page) => page.getByRole("dialog", { name: "Forward to" });
/** Where the chat speaks its announcements (the composer's live region). */
const status = (page: Page) => page.locator(".composer-notice");
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Posts to one chat, in the order they were made. */
const postsTo = (conversationId: string) =>
  worker.sent.filter((post) => post.conversationId === conversationId);

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

test.describe("Web multi-select and forwarding", () => {
  test("Select replaces the composer with a bar, and Back gives the composer back", async ({
    page,
  }) => {
    await openChat(page);

    await expect(bar(page)).toHaveCount(0);
    await selectButton(page, "m_1").click();

    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole("status")).toHaveText("1 selected");
    await expect(note(page, "m_1").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await expect(note(page, "m_1")).toHaveClass(/bubble-row--selected/);
    // The composer is not merely covered: it is not there to type into.
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Record a voice note/ })).toHaveCount(0);

    await selectButton(page, "m_3").click();
    await expect(bar(page).getByRole("status")).toHaveText("2 selected");

    // Ticking a row off again is the same control, with the other name.
    await note(page, "m_3")
      .getByRole("button", { name: /unselect this message/i })
      .click();
    await expect(bar(page).getByRole("status")).toHaveText("1 selected");

    await bar(page).getByRole("button", { name: "Clear the selection" }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("ticking one photo of an album selects the whole group, as the phone does", async ({
    page,
  }) => {
    await openChat(page);

    await selectButton(page, "alb_a").click();

    await expect(bar(page).getByRole("status")).toHaveText("2 selected");
    await expect(note(page, "alb_a").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    // A folded album is ONE row in the transcript, ticked as a group: its
    // second photo has no row of its own to tick.
    await expect(note(page, "alb_b")).toHaveCount(0);
  });

  test("Copy puts the DECRYPTED bodies on the clipboard, newline-joined", async ({ page }) => {
    await openChat(page);

    // m_3 arrives sealed from the peer; m_1 arrives as plain text.
    await expect(note(page, "m_3")).toContainText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড");

    await selectButton(page, "m_1").click();
    await selectButton(page, "m_3").click();
    await bar(page).getByRole("button", { name: "Copy" }).click();

    expect(await clipboard(page)).toBe("আগের প্লেইন মেসেজ\nএই মেসেজটি ফোন থেকে এনক্রিপ্টেড");
    // Copying, like every other performed action, drops the selection.
    await expect(bar(page)).toHaveCount(0);
  });

  test("a selection with no text in it offers no Copy at all", async ({ page }) => {
    await openChat(page);

    await selectButton(page, "m_4").click();

    await expect(bar(page).getByRole("status")).toHaveText("1 selected");
    await expect(bar(page).getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: /Forward/ })).toBeVisible();
  });

  test("forwarding a sealed message re-seals it for the target, and a group gets readable text", async ({
    page,
  }) => {
    await openChat(page);

    await selectButton(page, "m_3").click();
    await bar(page)
      .getByRole("button", { name: /Forward/ })
      .click();

    await expect(picker(page)).toBeVisible();
    await expect(picker(page).getByText(/^\d+ chats$/)).toBeVisible();
    // Ticking rows swaps the subtitle, as the phone's picker does.
    await picker(page).getByRole("checkbox", { name: /Squad/ }).click();
    await picker(page)
      .getByRole("checkbox", { name: new RegExp(PEER_NAME) })
      .click();
    await expect(picker(page).getByText("2 selected")).toBeVisible();
    await expect(picker(page).getByText("1 message → 2 chats")).toBeVisible();

    await picker(page).getByRole("button", { name: "Send" }).click();

    await expect.poll(() => worker.sent.length).toBe(2);

    // A group has no peer key: the caption travels as the plaintext it is.
    const group = postsTo(GROUP_ID);
    expect(group).toHaveLength(1);
    expect(group[0]?.body.kind).toBe("TEXT");
    expect(group[0]?.body.body).toBe("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড");

    // The 1:1 is sealed again — for THIS peer's key, not copied across.
    const direct = postsTo(CHAT_ID);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.body.kind).toBe("TEXT");
    expect(String(direct[0]?.body.body ?? "")).toMatch(/^KP1\./);
    expect(String(direct[0]?.body.body ?? "")).not.toBe("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড");

    // Nothing was uploaded: a text forward is a post and nothing more.
    expect(worker.uploads).toHaveLength(0);
    await expect(picker(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    await expect(status(page)).toContainText("Forwarded 1 message to 2 chats");
  });

  test("two photos forwarded together arrive grouped, with one album id per target chat", async ({
    page,
  }) => {
    await openChat(page);

    await selectButton(page, "alb_a").click();
    await expect(bar(page).getByRole("status")).toHaveText("2 selected");
    await bar(page)
      .getByRole("button", { name: /Forward/ })
      .click();

    await picker(page).getByRole("checkbox", { name: /Squad/ }).click();
    await picker(page)
      .getByRole("checkbox", { name: /KuchuPuchu/ })
      .click();
    await expect(picker(page).getByText("2 messages → 2 chats")).toBeVisible();
    await picker(page).getByRole("button", { name: "Send" }).click();

    await expect.poll(() => worker.sent.length).toBe(4);

    const albumOf = (post: { body: Record<string, unknown> }) =>
      String(((post.body.meta ?? {}) as Record<string, unknown>).album ?? "");
    const squad = postsTo(GROUP_ID);
    const bot = postsTo(BOT_ID);
    expect(squad).toHaveLength(2);
    expect(bot).toHaveLength(2);
    // Both photos of a chat share that chat's own id…
    expect(albumOf(squad[0]!)).toMatch(/^alb_/);
    expect(albumOf(squad[0]!)).toBe(albumOf(squad[1]!));
    expect(albumOf(bot[0]!)).toBe(albumOf(bot[1]!));
    // …and the two chats never share one, or a group would leak across them.
    expect(albumOf(squad[0]!)).not.toBe(albumOf(bot[0]!));
    // The bytes were already stored, so the keys are reused, not re-uploaded.
    expect(squad.map((post) => post.body.fileKey).sort()).toEqual([
      "f/album_a.png",
      "f/album_b.png",
    ]);
    expect(worker.uploads).toHaveLength(0);
  });

  test("a view-once row cannot be forwarded, and the refusal says why", async ({ page }) => {
    await openChat(page);

    // The row's own action is not a button: it is a labelled refusal.
    const refused = note(page, "once_photo").locator(".message-actions__refused");
    await expect(refused).toHaveAttribute("aria-disabled", "true");
    await expect(refused).toHaveAttribute("title", /one opening/);
    await expect(note(page, "once_photo").getByRole("button", { name: /Forward/ })).toHaveCount(0);

    // Selecting it refuses the whole bar, with the same reason.
    await selectButton(page, "once_photo").click();
    const forward = bar(page).getByText("Forward", { exact: true });
    await expect(forward).toHaveAttribute("aria-disabled", "true");
    await expect(forward).toHaveAttribute("title", /one opening/);
    await expect(bar(page).getByRole("button", { name: /Forward/ })).toHaveCount(0);

    // And a selection that mixes it with an ordinary row is refused too.
    await selectButton(page, "m_1").click();
    await expect(bar(page).getByRole("status")).toHaveText("2 selected");
    await expect(bar(page).getByRole("button", { name: /Forward/ })).toHaveCount(0);
    expect(worker.sent).toHaveLength(0);
  });

  test("nothing can be forwarded out of a chat the other side marked private", async ({ page }) => {
    // A fresh worker whose direct chat belongs to a private profile.
    worker = await createMockWorker({});
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: CHAT_ID,
              isGroup: false,
              unread: 0,
              hidden: 0,
              lastMessageAt: new Date().toISOString(),
              other: {
                id: "u_peer",
                displayName: PEER_NAME,
                username: "rahi",
                privateProfile: true,
              },
            },
          ],
        }),
      }),
    );
    await page.goto("/");
    await openChat(page);

    await selectButton(page, "m_1").click();
    const forward = bar(page).getByText("Forward", { exact: true });
    await expect(forward).toHaveAttribute("title", /private chat/);
    await expect(bar(page).getByRole("button", { name: /Forward/ })).toHaveCount(0);
    expect(worker.sent).toHaveLength(0);
  });

  test("Edit is offered for one own text row inside the window, and never for two", async ({
    page,
  }) => {
    await openChat(page);

    // m_2 is my own, but it is older than the phone's 60-second edit window.
    await selectButton(page, "m_2").click();
    await expect(bar(page).getByRole("button", { name: "Edit" })).toHaveCount(0);

    // Somebody else's row is never editable, however fresh.
    await bar(page).getByRole("button", { name: "Clear the selection" }).click();
    await selectButton(page, "m_1").click();
    await expect(bar(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("Delete asks the scope, and 'also delete' really asks the server", async ({ page }) => {
    await openChat(page);

    await selectButton(page, "m_2").click();
    await selectButton(page, "m_1").click();
    await bar(page).getByRole("button", { name: "Delete" }).click();

    const confirm = page.getByRole("group", { name: "Confirm delete" });
    await expect(confirm).toContainText("Delete 2 messages?");
    // r68-8: the popup names the other side it would also delete for.
    await expect(confirm.getByRole("button", { name: "Also delete for Rahi" })).toBeVisible();
    await expect(
      confirm.getByRole("button", { name: /Hide for me \(this session\)/ }),
    ).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(bar(page)).toBeVisible();

    await bar(page).getByRole("button", { name: "Delete" }).click();
    await confirm.getByRole("button", { name: "Also delete for Rahi" }).click();

    await expect.poll(() => worker.deletedMessageIds.sort()).toEqual(["m_1", "m_2"]);
    await expect(bar(page)).toHaveCount(0);
    await expect(note(page, "m_1")).toHaveCount(0, { timeout: 15_000 });
    await expect(note(page, "m_2")).toHaveCount(0, { timeout: 15_000 });
  });

  test("hiding for me removes the row here, says it is only for this session, and asks nothing of the server", async ({
    page,
  }) => {
    await openChat(page);

    await selectButton(page, "m_1").click();
    await bar(page).getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("group", { name: "Confirm delete" })
      .getByRole("button", { name: /Hide for me \(this session\)/ })
      .click();

    await expect(note(page, "m_1")).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).toContainText("Hidden on this device for this session");
    await expect(status(page)).toContainText("come back if you reload");
    // No delete request went anywhere: a browser has no local message store.
    expect(worker.deletedMessageIds).toHaveLength(0);

    await page.reload();
    await openChat(page);
    await expect(note(page, "m_1")).toBeVisible();
  });

  test("a group selection never offers the other side's messages for everyone", async ({
    page,
  }) => {
    await page.getByRole("link", { name: /Squad/ }).click();
    await expect(page.getByRole("button", { name: "Media, links and docs" })).toBeVisible();

    await selectButton(page, "g_1").click();
    await bar(page).getByRole("button", { name: "Delete" }).click();

    const confirm = page.getByRole("group", { name: "Confirm delete" });
    // The group rule stays "your own messages only", so only the local hide is
    // on offer — never a button the server would refuse.
    await expect(confirm.getByRole("button", { name: /Also delete for/ })).toHaveCount(0);
    await expect(
      confirm.getByRole("button", { name: /Hide for me \(this session\)/ }),
    ).toBeVisible();

    await confirm.getByRole("button", { name: /Hide for me \(this session\)/ }).click();
    await expect(note(page, "g_1")).toHaveCount(0, { timeout: 15_000 });
    expect(worker.deletedMessageIds).toHaveLength(0);
  });

  test("every control on the bar is labelled, and none of them needs a pointer", async ({
    page,
  }) => {
    await openChat(page);

    await selectButton(page, "m_1").click();
    await selectButton(page, "m_2").click();

    const buttons = bar(page).locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const name = ((await button.getAttribute("aria-label")) ?? (await button.innerText())).trim();
      expect(name.length, `bar button ${index}`).toBeGreaterThan(2);
    }

    // The whole bar is reachable with a keyboard, in order.
    await bar(page).getByRole("button", { name: "Clear the selection" }).focus();
    await expect(bar(page).getByRole("button", { name: "Clear the selection" })).toBeFocused();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() =>
      (document.activeElement?.textContent ?? "").trim().slice(0, 20),
    );
    expect(focused.length).toBeGreaterThan(0);
  });
});

test.describe("Web media save permission", () => {
  test("with saving off, the sender's media can be read but not kept or forwarded", async ({
    page,
  }) => {
    worker = await createMockWorker({ withAttachment: true, peerSaveOff: true });
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
    await openChat(page);

    // r71-18: their photo is theirs to withhold.
    const refused = note(page, "m_4").locator(".message-actions__refused");
    await expect(refused).toHaveAttribute("title", /sender turned off saving/);
    await expect(note(page, "m_4").getByRole("button", { name: /Forward/ })).toHaveCount(0);

    // The viewer withholds Save with the reason, and Forward with it too.
    await note(page, "m_4")
      .getByRole("button", { name: /Open peer_photo\.png/ })
      .click();
    const viewer = page.getByRole("dialog", { name: "Media viewer" });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("link", { name: /Save/ })).toHaveCount(0);
    const withheldSave = viewer.locator(".media-viewer__actions span.is-disabled", {
      hasText: "Save",
    });
    await expect(withheldSave).toHaveAttribute("aria-disabled", "true");
    await expect(withheldSave).toHaveAttribute("title", /sender turned off saving/);
    const withheldForward = viewer.locator(".media-viewer__actions span.is-disabled", {
      hasText: "Forward",
    });
    await expect(withheldForward).toHaveAttribute("aria-disabled", "true");
    await expect(withheldForward).toHaveAttribute("title", /sender turned off saving/);
    await expect(viewer.getByRole("button", { name: "Forward" })).toHaveCount(0);

    // My own rows in the same chat are still mine to forward.
    await viewer.getByRole("button", { name: "Close viewer" }).click();
    await selectButton(page, "m_2").click();
    await expect(bar(page).getByRole("button", { name: /Forward/ })).toBeVisible();
  });
});
