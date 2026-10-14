import AxeBuilder from "@axe-core/playwright";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import {
  BOT_ID,
  CHAT_ID,
  GROUP_ID,
  HIDDEN_ID,
  ME,
  PEER_NAME,
  createMockWorker,
  openFrom,
  ownPlaintextBody,
  signIn,
  type MockWorker,
} from "./helpers";

/**
 * Messaging end-to-end: chat list, transcript, sealed send, drafts, message
 * actions, one-way accounts and live socket frames — against a mocked Worker
 * and a mocked WebSocket.
 *
 * Honest scope: Chromium with synthetic events and mocked media. This is not
 * physical-device, cross-browser or real Worker↔Web↔Android QA.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker();
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

test.describe("Web messaging", () => {
  test("loads the chat list, keeps hidden chats out and counts unread", async ({ page }) => {
    await expect(page.getByRole("link", { name: new RegExp(PEER_NAME) })).toBeVisible();
    await expect(page.getByRole("link", { name: /Squad/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /KuchuPuchu/ })).toBeVisible();

    // A hidden chat must not leak into the list, its labels or its counts.
    await expect(page.getByText("Hidden Person")).toHaveCount(0);
    expect(page.url()).not.toContain(HIDDEN_ID);

    const directRow = page.getByRole("link", { name: new RegExp(`${PEER_NAME}, 2 unread`) });
    await expect(directRow).toBeVisible();
    await expect(directRow.locator(".conversation-row__badge")).toHaveCount(0);
    await expect(page.locator(".list-header__count")).toHaveCount(0);
    const chatsNav = page.getByRole("link", { name: /Chats, 1 unread chats/ });
    await expect(chatsNav).toBeVisible();
    const badge = page.locator(".primary-nav .nav-unread-badge");
    await expect(badge).toBeVisible();
    const badgeBox = await badge.boundingBox();
    const iconBox = await chatsNav.locator(".nav-button__icon-wrap").boundingBox();
    expect(badgeBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    expect(badgeBox!.x + badgeBox!.width).toBeGreaterThan(iconBox!.x + iconBox!.width / 2);
    expect(badgeBox!.y).toBeLessThan(iconBox!.y + iconBox!.height / 2);

    // The sealed preview is the plain category word, never ciphertext.
    await expect(page.getByText("KP1.")).toHaveCount(0);
    await expect(page.getByText("Message").first()).toBeVisible();

    // The list footer reports the /ws/user connection; the open chat reports
    // its own /ws/chat connection separately.
    await expect(page.locator(".list-footer")).toContainText("Live");
    await expect(userSocket, "the list socket should be connected").not.toBeNull();
  });

  test("opening a chat loads history and decrypts sealed bodies", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${CHAT_ID}`));

    await expect(page.getByRole("heading", { level: 2, name: PEER_NAME })).toBeVisible();

    // The sealed row opens with the adopted identity; a failure would show the
    // lock placeholder instead, so this asserts real interoperation.
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();
    await expect(page.getByText("আগের প্লেইন মেসেজ")).toBeVisible();
    await expect(page.getByText(ownPlaintextBody())).toBeVisible();

    await expect(page.getByText("Today").first()).toBeVisible();
    // The header subtitle is the phone's presence line — the mock peer is online.
    await expect(page.getByText("online")).toBeVisible();

    // Opening marks the conversation read.
    await expect.poll(() => worker.readCalls.length).toBeGreaterThan(0);

    // The transcript contains no ciphertext.
    await expect(page.locator(".transcript")).not.toContainText("KP1.");
  });

  test("scrolling to the top loads the next older history page", async ({ page }) => {
    const oldestFirst = Array.from({ length: 75 }, (_, index) => ({
      id: `history_${String(index).padStart(3, "0")}`,
      senderId: "u_peer",
      senderName: PEER_NAME,
      kind: "TEXT",
      body: `history-${String(index).padStart(3, "0")}`,
      // Three messages share each timestamp; the page boundary therefore
      // exercises the `(created_at, rowid)` cursor instead of time alone.
      createdAt: new Date(Date.now() - Math.floor((74 - index) / 3) * 1_000).toISOString(),
      rowid: index + 1,
    }));
    const pageCursors: Array<{ before: string; beforeRowid: number }> = [];
    let releaseOlderPage: (() => void) | null = null;

    await page.route(`**/api/conversations/${CHAT_ID}/messages*`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const url = new URL(route.request().url());
      const before = url.searchParams.get("before") ?? "";
      const beforeRowid = Number(url.searchParams.get("beforeRowid") ?? 0);
      pageCursors.push({ before, beforeRowid });
      if (before && pageCursors.length === 2) {
        await new Promise<void>((resolve) => {
          releaseOlderPage = resolve;
        });
      }
      const eligible = oldestFirst.filter(
        (row) =>
          !before ||
          row.createdAt < before ||
          (row.createdAt === before && row.rowid < beforeRowid),
      );
      const newestFirst = [...eligible].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt) || right.rowid - left.rowid,
      );
      const selectedPage = newestFirst.slice(0, 50);
      const oldest = selectedPage.at(-1);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [...selectedPage].reverse(),
          readAt: "",
          typingAt: "",
          typingKind: "",
          marker: `history-${pageCursors.length}`,
          oldest: oldest ? { createdAt: oldest.createdAt, rowid: oldest.rowid } : null,
          hasMore: eligible.length > selectedPage.length,
          priv: {},
        }),
      });
    });

    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.locator('[data-message-id="history_074"]')).toBeAttached();
    await expect(page.locator('[data-message-id="history_000"]')).toHaveCount(0);
    expect(pageCursors).toHaveLength(1);

    await page.locator(".transcript").evaluate((list) => {
      list.scrollTop = 0;
    });

    await expect.poll(() => pageCursors.length).toBe(2);
    expect(pageCursors[1]?.beforeRowid).toBeGreaterThan(0);
    const currentOldest = page.locator('[data-message-id="history_025"]');
    const yBefore = (await currentOldest.boundingBox())!.y;
    expect(releaseOlderPage).not.toBeNull();
    releaseOlderPage!();

    await expect(page.locator('[data-message-id="history_000"]')).toBeAttached();
    await expect(page.locator('[data-message-id^="history_"]')).toHaveCount(75);
    const yAfter = (await currentOldest.boundingBox())!.y;
    expect(Math.abs(yAfter - yBefore)).toBeLessThan(3);

    await page.locator(".transcript").evaluate((list) => {
      list.scrollTop = 0;
    });
    await expect(page.getByText("history-000")).toBeVisible();
  });

  test("older-history failures stay visible and the cursor can be retried", async ({ page }) => {
    const history = Array.from({ length: 4 }, (_, index) => ({
      id: `retry_history_${index}`,
      senderId: "u_peer",
      senderName: PEER_NAME,
      kind: "TEXT",
      body: `retry-history-${index}`,
      createdAt: new Date(Date.now() - (4 - index) * 1_000).toISOString(),
      rowid: index + 1,
      replyTo: null,
      fileName: null,
      fileType: null,
      fileSize: null,
      fileKey: null,
      meta: null,
    }));
    let olderAttempts = 0;

    await page.route(`**/api/conversations/${CHAT_ID}/messages*`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const before = new URL(route.request().url()).searchParams.get("before") ?? "";
      if (!before) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [history[3], history[2]],
            readAt: "",
            typingAt: "",
            typingKind: "",
            marker: "history-newer",
            oldest: { createdAt: history[2]!.createdAt, rowid: history[2]!.rowid },
            hasMore: true,
            priv: {},
          }),
        });
      }
      olderAttempts += 1;
      if (olderAttempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Temporarily unavailable" } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [history[1], history[0]],
          readAt: "",
          typingAt: "",
          typingKind: "",
          marker: "history-older",
          oldest: { createdAt: history[0]!.createdAt, rowid: history[0]!.rowid },
          hasMore: false,
          priv: {},
        }),
      });
    });

    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.locator('[data-message-id="retry_history_3"]')).toBeAttached();
    await page.getByRole("button", { name: "Load older messages" }).click();
    await expect.poll(() => olderAttempts).toBe(1);
    await expect(page.locator(".transcript__more-error")).toContainText(
      "The service is temporarily unavailable",
    );

    await page.getByRole("button", { name: "Retry loading older messages" }).click();
    await expect.poll(() => olderAttempts).toBe(2);
    await expect(page.locator('[data-message-id="retry_history_0"]')).toBeAttached();
    await expect(page.locator('[data-message-id^="retry_history_"]')).toHaveCount(4);
    await expect(page.locator(".transcript__more-error")).toHaveCount(0);
  });

  test("the send button posts a sealed message and renders its echo", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    const plaintext = "button send works from the browser";
    await page.getByLabel("Message text", { exact: true }).fill(plaintext);
    await page.getByRole("button", { name: /Send message, or hold to schedule/ }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    expect(String(worker.sent[0]!.body.body ?? "").startsWith("KP1.")).toBe(true);
    await expect(page.getByText(plaintext)).toBeVisible();
    await expect(page.getByLabel("Message text", { exact: true })).toHaveValue("");
  });

  test("a sent text is sealed before it leaves the browser", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    const composer = page.getByLabel("Message text", { exact: true });
    const plaintext = "নতুন মেসেজ from the browser 🔒";
    await composer.fill(plaintext);
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await composer.press("Enter");

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    expect(sent.conversationId).toBe(CHAT_ID);

    const body = String(sent.body.body ?? "");
    expect(body.startsWith("KP1.")).toBe(true);
    expect(body).not.toBe(plaintext);
    expect(String(sent.body.clientId ?? "").startsWith("c_w")).toBe(true);
    expect(sent.body.kind).toBe("TEXT");

    // The peer can actually open it — the same scheme the phone uses.
    expect(await openFrom(body, worker.peer, worker.me)).toBe(plaintext);

    // The optimistic echo is replaced by the server row, not duplicated.
    await expect(page.getByText(plaintext)).toHaveCount(1);
    await expect(page.locator(".bubble--failed")).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });

  test("slash suggestions stack vertically and /magic animates only message text", async ({
    page,
  }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("/");

    const suggestions = ["silent", "magic", "vanish"].map((name) =>
      page.getByRole("button", { name: new RegExp(`Insert /${name}:`) }),
    );
    for (const suggestion of suggestions) await expect(suggestion).toBeVisible();
    const boxes = await Promise.all(suggestions.map((suggestion) => suggestion.boundingBox()));
    expect(boxes.every((box) => box !== null)).toBe(true);
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);

    await composer.fill("/magic bright text");
    await composer.press("Enter");
    await expect.poll(() => worker.sent.length).toBe(1);
    expect(await openFrom(String(worker.sent[0]!.body.body), worker.me, worker.peer)).toBe(
      "bright text",
    );
    expect((worker.sent[0]!.body.meta as Record<string, unknown>)?.magic).toBe(true);
    const magicText = page.locator(".bubble__body--magic").last();
    await expect(magicText).toContainText("bright text");
    expect(await magicText.evaluate((el) => getComputedStyle(el).animationName)).toContain(
      "message-magic-text",
    );
    expect(
      await magicText.evaluate((el) => getComputedStyle(el.closest(".bubble")!).animationName),
    ).not.toContain("message-magic-text");
  });

  test("@ filters chat members and inserts the selected username", async ({ page }) => {
    await page.getByRole("link", { name: /Squad/ }).click();
    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("@ra");

    await expect(page.getByLabel("Mention people")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mention Rahi (@rahi)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mention Third Member (@third)" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Mention Rahi (@rahi)" }).click();
    await expect(composer).toHaveValue("@rahi ");
    await composer.press("Enter");
    await expect.poll(() => worker.sent.length).toBe(1);
    expect(worker.sent[0]!.body.body).toBe("@rahi");
    const clickableMention = page.getByRole("button", { name: "Open chat with @rahi" });
    await expect(clickableMention).toBeVisible();
    await expect(clickableMention).toHaveAttribute("type", "button");
  });

  test("**bold** is visible in the composer before the message is sent", async ({ page }) => {
    await page.getByRole("link", { name: /Squad/ }).click();
    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("**hi** ");
    await expect(composer).toHaveValue("**hi** ");
    await expect(page.locator(".composer__format-preview strong")).toHaveText("hi");
    expect(worker.sent.length).toBe(0);

    await composer.press("Enter");
    await expect.poll(() => worker.sent.length).toBe(1);
    expect(worker.sent[0]!.body.body).toBe("**hi**");
    await expect(page.locator(".bubble__body strong").last()).toHaveText("hi");
    await expect(page.locator(".bubble__body").last()).not.toContainText("**");
  });

  test("an unsent draft survives a page reload", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("টাইপ করে পাঠাইনি");
    await expect.poll(() => worker.typingCalls.some((call) => call.kind === "text")).toBe(true);

    await page.reload();
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByLabel("Message text", { exact: true })).toHaveValue("টাইপ করে পাঠাইনি");

    // Nothing was sent while it sat in the composer.
    expect(worker.sent.length).toBe(0);
  });

  test("message actions are reachable by keyboard and reversible", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("আগের প্লেইন মেসেজ")).toBeVisible();

    // Keyboard-open the compact menu, then activate Reply from its options.
    const peerBubble = page.locator(".bubble", { hasText: "আগের প্লেইন মেসেজ" }).first();
    const peerOptions = peerBubble.getByRole("button", { name: "Message options" });
    await peerOptions.focus();
    await peerOptions.press("Enter");
    await peerBubble.getByRole("menuitem", { name: "Reply", exact: true }).press("Enter");

    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toBeVisible();
    await page.getByRole("button", { name: "Cancel reply" }).click();
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toHaveCount(0);

    // Escape also cancels a reply.
    await peerOptions.press("Enter");
    await peerBubble.getByRole("menuitem", { name: "Reply", exact: true }).press("Enter");
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toBeVisible();
    await page.getByLabel("Message text").press("Escape");
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toHaveCount(0);

    // Copy is a real clipboard write, and the copy is confirmed aloud.
    await peerOptions.click();
    await peerBubble.getByRole("menuitem", { name: "Copy", exact: true }).click();
    await expect(page.getByText("Message text copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("আগের প্লেইন মেসেজ");

    // An existing reaction is shown with a spoken label, not colour alone.
    await expect(page.getByText("You reacted").first()).toBeAttached();

    // A peer's message offers a quick reaction inside its options menu.
    await peerOptions.click();
    await peerBubble.getByRole("menuitem", { name: "React red heart" }).click();
    await expect.poll(() => worker.reactions.length).toBe(1);
    expect(worker.reactions[0]!.emoji).toBe("\u2764\uFE0F");

    // Delete asks before it acts, and only the sender's rows offer it.
    const ownRow = page.locator(".bubble-row--own").first();
    const ownBubble = ownRow.locator(".bubble");
    const ownOptions = ownBubble.getByRole("button", { name: "Message options" });
    await ownOptions.click();
    await ownBubble.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Delete for everyone?")).toBeVisible();
    await page.getByRole("button", { name: "Keep message" }).click();
    await expect(page.getByText("Delete for everyone?")).toHaveCount(0);
    expect(worker.deletedMessageIds.length).toBe(0);

    await ownOptions.click();
    await ownBubble.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete for everyone" }).click();
    await expect.poll(() => worker.deletedMessageIds.length).toBe(1);
  });

  test("mobile message options stay in one viewport-fitted menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    const row = page.locator('[data-message-id="m_1"]');
    const bubble = row.locator(".bubble");
    await expect(bubble).toBeVisible();

    const trigger = bubble.getByRole("button", { name: "Message options" });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.width).toBeLessThanOrEqual(24);
    expect(triggerBox!.height).toBeLessThanOrEqual(24);
    await trigger.click();

    const menu = bubble.getByRole("menu", { name: "Message actions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "React thumbs up" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(844);
    await expect(row.locator(".message-actions, .reaction-bar")).toHaveCount(0);
  });

  test("a one-way notification account cannot be replied to", async ({ page }) => {
    await page.getByRole("link", { name: /KuchuPuchu/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${BOT_ID}`));

    await expect(page.getByText("Official account")).toBeVisible();
    const composer = page.getByLabel("This account does not accept replies");
    await expect(composer).toBeDisabled();
    await expect(page.getByRole("button", { name: "Replies are not accepted" })).toBeDisabled();

    expect(worker.sent.length).toBe(0);
  });

  test("group chats stay plaintext and label their sender", async ({ page }) => {
    await page.getByRole("link", { name: /Squad/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${GROUP_ID}`));
    await expect(page.getByText(/members/)).toBeVisible();
    await expect(page.locator(".transcript").getByText("group plaintext")).toBeVisible();
    await expect(page.locator(".bubble__sender").first()).toContainText(PEER_NAME);

    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("group body");
    await composer.press("Enter");
    await expect.poll(() => worker.sent.length).toBe(1);
    // A group body is never sealed: the server holds group plaintext today.
    expect(String(worker.sent[0]!.body.body)).toBe("group body");
  });

  test("live socket frames drive the transcript and the header", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();
    expect(chatSocket, "the chat socket should be connected").not.toBeNull();

    const at = new Date().toISOString();

    // A typing frame lights the header; it is not the only indicator.
    chatSocket!.send(JSON.stringify({ type: "typing", userId: "u_peer", at, kind: "text" }));
    await expect(page.getByText("typing…")).toBeVisible();

    // An incoming sealed message is decrypted and appended once.
    const { sealFor } = await import("./helpers");
    const sealed = await sealFor("সরাসরি ফ্রেমে এল", worker.peer, worker.me);
    chatSocket!.send(
      JSON.stringify({
        type: "message",
        conversationId: CHAT_ID,
        message: {
          id: "live_1",
          senderId: "u_peer",
          senderName: PEER_NAME,
          kind: "TEXT",
          body: sealed,
          createdAt: new Date().toISOString(),
          rowid: 900,
        },
      }),
    );
    await expect(page.getByText("সরাসরি ফ্রেমে এল")).toHaveCount(1);
    await expect(page.locator(".transcript")).not.toContainText("KP1.");

    // A frame for another conversation must not appear here.
    chatSocket!.send(
      JSON.stringify({
        type: "message",
        conversationId: "c_other",
        message: {
          id: "other_1",
          senderId: "u_peer",
          kind: "TEXT",
          body: "wrong room",
          createdAt: new Date().toISOString(),
          rowid: 901,
        },
      }),
    );
    await expect(page.getByText("wrong room")).toHaveCount(0);

    // A delivery frame upgrades an unstamped outgoing row's tick, and the tick
    // carries a spoken label rather than relying on colour alone.
    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("ডেলিভারি পরীক্ষা");
    await composer.press("Enter");
    await expect.poll(() => worker.sent.length).toBe(1);
    // The ack must land first: the delivered frame keys the row by its
    // server id, which only exists once the POST response remaps it.
    await expect(
      page.locator(".bubble", { hasText: "ডেলিভারি পরীক্ষা" }).locator(".bubble__tick--sent"),
    ).toBeVisible();
    chatSocket!.send(
      JSON.stringify({ type: "delivered", messageIds: ["srv_1"], at: new Date().toISOString() }),
    );
    await expect(page.locator(".bubble__tick--delivered").first()).toBeVisible();
    await expect(page.getByText("Delivered").first()).toBeAttached();

    // A tombstone removes the bubble instead of blanking it.
    chatSocket!.send(
      JSON.stringify({
        type: "message",
        conversationId: CHAT_ID,
        message: { id: "live_1", kind: "DELETED", body: null, createdAt: at, rowid: 900 },
      }),
    );
    await expect(page.getByText("সরাসরি ফ্রেমে এল")).toHaveCount(0);

    // A conv frame on the user socket refreshes the list without a page reload.
    userSocket!.send(JSON.stringify({ type: "conv", conversationId: CHAT_ID }));
    await expect(page.getByRole("link", { name: new RegExp(PEER_NAME) })).toBeVisible();

    // Heartbeats keep flowing; the mock simply receives them. The live state
    // rides the list footer's indicator now, not a header pill.
    await expect(page.locator(".list-footer")).toContainText("Live");
  });

  test("browser-only limitations are disclosed in the chat surface", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    // The disclosure lives in the ⋮ sheet's Privacy notes view.
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Privacy notes" }).click();

    await expect(page.getByText(/cannot block or detect screenshots/)).toBeVisible();
    await expect(
      page.getByText(/Media bytes are account-controlled, not end-to-end encrypted/),
    ).toBeVisible();
    await expect(page.locator(".chat-menu__notes")).toContainText("arrive in a later slice");

    // Attaching is live now; what is still missing is stated, not stubbed.
    await expect(
      page.getByRole("button", { name: "Attach a photo, video or document" }),
    ).toBeEnabled();
  });

  test("surfaces that cannot work in a browser say why, and the picker is direct", async ({
    page,
  }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    // The attach button hands straight to the device picker — no tile sheet.
    await page.getByRole("button", { name: "Attach a photo, video or document" }).click();
    await expect(page.getByRole("group", { name: "Attach something" })).toHaveCount(0);
    await expect(page.locator('input[data-attach="picker"]')).toHaveCount(1);
    await expect(page.locator('input[data-attach="camera"]')).toHaveAttribute(
      "capture",
      "environment",
    );

    // The surfaces that need the phone are disclosed out loud instead of being
    // stubbed: one screen-reader note keeps every reason the old tiles carried.
    const note = page.locator(".attach-limits");
    const reasons: RegExp[] = [
      /location provider/,
      /contacts app/,
      /coming soon on Android too/,
      /2048 px/,
      /2 GB video/,
      /5 GB document/,
    ];
    for (const reason of reasons) {
      await expect(note).toContainText(reason);
    }
  });

  test("the signed-out shell makes no conversation requests", async ({ page, context }) => {
    // A second, storage-isolated page with no token: the messaging flag is on,
    // so the app must gate on the session rather than fetch private data.
    const fresh = await context.newPage();
    const calls: string[] = [];
    await fresh.route("**/api/**", (route) => {
      calls.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await fresh.goto("/chats");
    await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();
    expect(calls.filter((path) => path.startsWith("/api/conversations"))).toEqual([]);
  });

  test("list and open chat have no axe WCAG 2.1/2.2 A/AA violations", async ({ page }) => {
    const listScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(listScan.violations).toEqual([]);

    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    const chatScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(chatScan.violations).toEqual([]);
  });

  test("a narrow viewport keeps the composer and back control reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();

    await expect(page.getByRole("link", { name: "Back to Chats" })).toBeVisible();
    const composer = page.getByLabel("Message text", { exact: true });
    await expect(composer).toBeVisible();
    // An empty composer shows the microphone (slice E2); typing swaps it for
    // Send. Both have to be reachable at 390px.
    await expect(page.getByRole("button", { name: /Record a voice note/ })).toBeVisible();
    await composer.fill("hello");
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    // The fixed mobile navigation must not cover the composer.
    const box = await composer.boundingBox();
    const nav = await page.locator(".mobile-nav").boundingBox();
    expect(box).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y + 1);
  });

  test("the account identity shown matches the signed-in user", async ({ page }) => {
    // The rail chip is an image role with a spoken label, not visible text.
    await expect(page.locator(".account-chip")).toHaveAttribute(
      "aria-label",
      new RegExp(`${ME.displayName} account signed in`),
    );
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText(new RegExp(`Signed in as ${ME.displayName}`))).toBeAttached();
  });
});
