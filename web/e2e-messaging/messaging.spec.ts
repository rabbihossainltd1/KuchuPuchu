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

  await page.goto("/");
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

    await expect(
      page.getByRole("link", { name: new RegExp(`${PEER_NAME}, 2 unread`) }),
    ).toBeVisible();
    await expect(page.getByText("2 unread").first()).toBeVisible();

    // The sealed preview is a lock, never ciphertext.
    await expect(page.getByText("KP1.")).toHaveCount(0);
    await expect(page.getByText("এনক্রিপ্টেড মেসেজ").first()).toBeVisible();

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
    await expect(page.getByText("Direct chat · times shown in Dhaka time")).toBeVisible();

    // Opening marks the conversation read.
    await expect.poll(() => worker.readCalls.length).toBeGreaterThan(0);

    // The transcript contains no ciphertext.
    await expect(page.locator(".transcript")).not.toContainText("KP1.");
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

    // Two peer rows both offer "Reply to <peer>"; the first is enough here.
    const replyButton = page
      .getByRole("button", { name: new RegExp(`Reply to ${PEER_NAME}`) })
      .first();
    await replyButton.focus();
    await replyButton.press("Enter");

    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toBeVisible();
    await page.getByRole("button", { name: "Cancel reply" }).click();
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toHaveCount(0);

    // Escape also cancels a reply.
    await replyButton.press("Enter");
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toBeVisible();
    await page.getByLabel("Message text").press("Escape");
    await expect(page.getByText(`Replying to ${PEER_NAME}`)).toHaveCount(0);

    // Copy is a real clipboard write, and the copy is confirmed aloud.
    await page
      .getByRole("button", { name: new RegExp(`Copy message from ${PEER_NAME}`) })
      .first()
      .click();
    await expect(page.getByText("Message text copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("আগের প্লেইন মেসেজ");

    // An existing reaction is shown with a spoken label, not colour alone.
    await expect(page.getByText("You reacted").first()).toBeAttached();

    // A peer's message offers a quick reaction that reaches the Worker.
    await page.getByRole("button", { name: "React red heart" }).first().click();
    await expect.poll(() => worker.reactions.length).toBe(1);
    expect(worker.reactions[0]!.emoji).toBe("\u2764\uFE0F");

    // Delete asks before it acts, and only the sender's rows offer it.
    const ownRow = page.locator(".bubble-row--own").first();
    await ownRow.getByRole("button", { name: "Delete your message" }).click();
    await expect(page.getByText("Delete for everyone?")).toBeVisible();
    await page.getByRole("button", { name: "Keep message" }).click();
    await expect(page.getByText("Delete for everyone?")).toHaveCount(0);
    expect(worker.deletedMessageIds.length).toBe(0);

    await ownRow.getByRole("button", { name: "Delete your message" }).click();
    await page.getByRole("button", { name: "Delete for everyone" }).click();
    await expect.poll(() => worker.deletedMessageIds.length).toBe(1);
  });

  test("a one-way notification account cannot be replied to", async ({ page }) => {
    await page.getByRole("link", { name: /KuchuPuchu/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${BOT_ID}`));

    await expect(page.getByText("Notification account · one-way")).toBeVisible();
    const composer = page.getByLabel("This account does not accept replies");
    await expect(composer).toBeDisabled();
    await expect(page.getByRole("button", { name: "Replies are not accepted" })).toBeDisabled();
    await expect(page.getByText("One-way notification account.")).toBeVisible();

    expect(worker.sent.length).toBe(0);
  });

  test("group chats stay plaintext and label their sender", async ({ page }) => {
    await page.getByRole("link", { name: /Squad/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${GROUP_ID}`));
    await expect(page.getByText("Group chat")).toBeVisible();
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
    await expect(page.getByText("টাইপ করছে… typing")).toBeVisible();

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

    // Heartbeats keep flowing; the mock simply receives them.
    await expect(page.locator(".socket-pill")).toHaveText("Live");
  });

  test("browser-only limitations are disclosed in the chat surface", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    // The disclosure is keyboard reachable and its contents are real text, not
    // a tooltip that only exists on hover.
    const summary = page.locator(".chat-notes summary");
    await summary.focus();
    await summary.press("Enter");

    await expect(page.getByText(/cannot block or detect screenshots/)).toBeVisible();
    await expect(
      page.getByText(/Media bytes are account-controlled, not end-to-end encrypted/),
    ).toBeVisible();
    await expect(page.locator(".chat-notes")).toContainText("arrive in a later slice");

    // Attaching is live now; what is still missing is stated, not stubbed.
    await expect(
      page.getByRole("button", { name: "Attach a photo, video or document" }),
    ).toBeEnabled();
  });

  test("attach tiles that cannot work in a browser say why", async ({ page }) => {
    await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
    await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();

    await page.getByRole("button", { name: "Attach a photo, video or document" }).click();

    // The live tiles open a real file input.
    for (const label of ["Gallery", "Camera", "Video", "Document"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
    }

    // The inert ones are disabled AND carry a spoken reason: an icon that does
    // nothing is the failure mode this guards against.
    const inert: [string, RegExp][] = [
      ["Location", /location provider/],
      ["Contact", /contacts app/],
      ["Poll", /coming soon on Android too/],
      ["Event", /coming soon on Android too/],
      ["AI images", /coming soon on Android too/],
    ];
    for (const [label, reason] of inert) {
      const tile = page.getByRole("button", { name: label, exact: true });
      await expect(tile).toBeDisabled();
      const describedBy = await tile.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`#${describedBy}`)).toHaveText(reason);
    }

    await expect(page.getByText("Send as a document")).toBeVisible();
    await page.getByRole("button", { name: "Close attach menu" }).click();
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
    await fresh.goto("/");
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
