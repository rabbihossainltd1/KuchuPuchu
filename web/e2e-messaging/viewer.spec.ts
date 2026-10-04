import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { CHAT_ID, GROUP_ID, PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

/**
 * Viewers, shared media and view-once end-to-end (slice E1), against a mocked
 * Worker and a mocked WebSocket.
 *
 * The point of this file is the two ways a media surface can lie: claiming a
 * viewer works when the bytes never arrive, and burning a view-once opening the
 * reader never asked for. So the assertions are about what was requested, how
 * many times, and what the surface says while it waits.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker and sockets. Pointer
 * drag and wheel zoom are exercised through their keyboard equivalents, which
 * are the ones a desktop reader actually has.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openChat = async (page: Page, name: RegExp = new RegExp(PEER_NAME)) => {
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: "Media, links and docs" })).toBeVisible();
};

const openGallery = async (page: Page) => {
  await page.getByRole("button", { name: "Media, links and docs" }).click();
  await expect(page.getByRole("dialog", { name: "Media, links, and docs" })).toBeVisible();
};

const viewer = (page: Page) => page.getByRole("dialog", { name: "Media viewer" });
const zoomLabel = (page: Page) => page.locator(".media-viewer__zoom span");

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({
    withAttachment: true,
    withOnce: true,
    withSharedMedia: true,
  });
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

test.describe("Web media viewers", () => {
  test("the shared-media panel has the phone's three tabs and real rows", async ({ page }) => {
    await openChat(page);
    await openGallery(page);

    expect(worker.sharedMediaCalls).toContain(CHAT_ID);
    await expect(page.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab")).toHaveCount(3);

    // Photos and clips share one grid, newest first.
    await expect(page.locator(".gallery-tile")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Open Photo shared_photo.png" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Video shared_clip.mp4" })).toBeVisible();

    await page.getByRole("tab", { name: "Docs" }).click();
    await expect(page.locator(".gallery-row")).toHaveCount(1);
    await expect(page.locator(".gallery-row__copy strong")).toHaveText("report.pdf");
    const download = page.getByRole("link", { name: "Download" });
    await expect(download).toHaveAttribute("download", "report.pdf");
    await expect(download).toHaveAttribute("href", /^blob:/);

    await page.getByRole("tab", { name: "Links" }).click();
    await expect(page.locator(".gallery-row__copy strong")).toHaveText(
      "https://kuchupuchu.app/privacy",
    );
    const open = page.getByRole("link", {
      name: "Open https://kuchupuchu.app/privacy in a new tab",
    });
    await expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await expect(open).toHaveAttribute("target", "_blank");

    await page.getByRole("button", { name: "Close media panel" }).click();
    await expect(page.getByRole("dialog", { name: "Media, links, and docs" })).toHaveCount(0);
  });

  test("a private group's gallery is refused with the reason, not left spinning", async ({
    page,
  }) => {
    await openChat(page, /Squad/);
    await openGallery(page);

    expect(worker.sharedMediaCalls).toContain(GROUP_ID);
    await expect(page.locator(".media-gallery__error")).toContainText(
      "This group is private, so it has no shared-media gallery.",
    );
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator(".gallery-tile")).toHaveCount(0);
  });

  test("an empty gallery uses the phone's own empty states", async ({ page }) => {
    worker = await createMockWorker();
    await worker.install(page);
    await openChat(page);
    await openGallery(page);

    await expect(page.locator(".media-gallery__empty-title")).toHaveText("No media");
    await expect(page.locator(".media-gallery__empty-body")).toHaveText(
      "Photos and videos sent in this chat show up here",
    );
    await page.getByRole("tab", { name: "Docs" }).click();
    await expect(page.locator(".media-gallery__empty-title")).toHaveText("No documents yet.");
    await page.getByRole("tab", { name: "Links" }).click();
    await expect(page.locator(".media-gallery__empty-title")).toHaveText("No links yet.");
  });

  test("a photo opens full screen and zooms by keyboard within the phone's clamp", async ({
    page,
  }) => {
    await openChat(page);
    await page.getByRole("button", { name: "Open peer_photo.png full screen" }).click();

    await expect(viewer(page)).toBeVisible();
    await expect(zoomLabel(page)).toHaveText("100%");
    await expect(page.locator(".media-viewer__image")).toHaveAttribute("src", /^blob:/);
    await expect(page.locator(".media-viewer__title")).toHaveText("peer_photo.png");

    await page.keyboard.press("+");
    await expect(zoomLabel(page)).toHaveText("125%");
    await page.keyboard.press("+");
    await expect(zoomLabel(page)).toHaveText("156%");
    await page.keyboard.press("0");
    await expect(zoomLabel(page)).toHaveText("100%");

    // The phone clamps pinch at 6×; the keyboard must not escape that either.
    for (let press = 0; press < 14; press += 1) await page.keyboard.press("+");
    await expect(zoomLabel(page)).toHaveText("600%");
    for (let press = 0; press < 20; press += 1) await page.keyboard.press("-");
    await expect(zoomLabel(page)).toHaveText("100%");

    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoomLabel(page)).toHaveText("125%");
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expect(zoomLabel(page)).toHaveText("100%");

    await page.keyboard.press("Escape");
    await expect(viewer(page)).toHaveCount(0);
  });

  test("an album folds into one bubble and the viewer pages through it", async ({ page }) => {
    await openChat(page);

    // Two photos, one album id, one sender: a single row with two thumbs.
    const album = page.locator(".album-grid");
    await expect(album).toHaveCount(1);
    await expect(album.locator(".album-grid__cell")).toHaveCount(2);
    await expect(album).toHaveAttribute("aria-label", "2 photos sent together");

    await album.getByRole("button", { name: "Open album_b.png full screen" }).click();
    await expect(viewer(page)).toBeVisible();
    await expect(page.locator(".media-viewer__stamp")).toContainText("2 of 2");

    // While zoomed, an arrow key pans — it never flips the page by accident.
    // The phone holds the gesture for exactly this reason ("a zoomed photo
    // holds the gesture (no accidental page flip)").
    await page.keyboard.press("+");
    await expect(zoomLabel(page)).toHaveText("125%");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".media-viewer__stamp")).toContainText("2 of 2");

    // At 100% the same key pages, and zoom is already 1 on the new page.
    await page.keyboard.press("0");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".media-viewer__stamp")).toContainText("1 of 2");
    await expect(page.locator(".media-viewer__title")).toHaveText("album_a.png");
    await expect(zoomLabel(page)).toHaveText("100%");

    // Zoom resets on every flip, exactly as the phone does (round 34, item 6).
    await page.keyboard.press("+");
    await expect(zoomLabel(page)).toHaveText("125%");
    await page.getByRole("button", { name: "Next item" }).click();
    await expect(page.locator(".media-viewer__stamp")).toContainText("2 of 2");
    await expect(zoomLabel(page)).toHaveText("100%");
    await page.keyboard.press("Home");
    await expect(page.locator(".media-viewer__stamp")).toContainText("1 of 2");
  });

  test("a view-once photo stays blurred until the reader opens it", async ({ page }) => {
    await openChat(page);

    const blurred = page.locator(".attachment__image--once");
    await expect(blurred).toHaveCount(1);
    await expect(blurred).toHaveAttribute("alt", /blurred until you open it/);
    const open = page.getByRole("button", { name: "View once — open" });
    await expect(open).toBeVisible();

    // Nothing has been reported yet: rendering a transcript must not spend it.
    expect(worker.viewOnceReports).toEqual([]);

    await open.click();
    await expect(viewer(page)).toBeVisible();
    await expect(page.locator(".media-viewer__stamp")).toContainText("View once");

    await expect.poll(() => worker.viewOnceReports).toEqual(["once_photo"]);
    // Paging, zooming and re-rendering must not report a second opening.
    await page.keyboard.press("+");
    await page.keyboard.press("Escape");
    await expect.poll(() => worker.viewOnceReports).toEqual(["once_photo"]);
  });

  test("a view-once clip fetches no bytes until it is opened", async ({ page }) => {
    await openChat(page);

    const card = page.locator(".attachment__once-card");
    await expect(card).toContainText("View once video");
    await expect(card).toContainText("Opens once, then it is gone for both of you.");
    expect(worker.fileDownloads).not.toContain("f/once_clip.mp4");

    await card.getByRole("button", { name: "Open it now" }).click();
    await expect(viewer(page)).toBeVisible();
    await expect.poll(() => worker.fileDownloads).toContain("f/once_clip.mp4");
    await expect.poll(() => worker.viewOnceReports).toEqual(["once_clip"]);
  });

  test("a VANISHED frame takes the row out of the transcript", async ({ page }) => {
    await openChat(page);
    await expect(page.locator(".attachment__image--once")).toHaveCount(1);
    expect(chatSocket, "the chat socket should be connected").not.toBeNull();

    chatSocket!.send(
      JSON.stringify({
        type: "message",
        conversationId: CHAT_ID,
        message: { id: "once_photo", senderId: "u_peer", kind: "VANISHED" },
      }),
    );

    await expect(page.locator(".attachment__image--once")).toHaveCount(0);
    // The marker is an instruction, never a bubble of its own.
    await expect(page.locator(".transcript")).not.toContainText("VANISHED");
    await expect(page.getByRole("button", { name: "View once — open" })).toHaveCount(0);
  });

  test("a view-once text reveals for five seconds and then reports", async ({ page }) => {
    await openChat(page);

    const veil = page.getByRole("button", { name: /View once message/ });
    await expect(veil).toBeVisible();
    await expect(page.locator(".transcript")).not.toContainText("গোপন মেসেজ");

    await veil.click();
    await expect(page.getByText("গোপন মেসেজ")).toBeVisible();
    await expect(page.locator(".once-text__count")).toContainText("5s left");

    await expect
      .poll(() => worker.viewOnceReports, { timeout: 12_000, intervals: [500] })
      .toEqual(["once_text"]);
    await expect(page.locator(".once-text__count")).toContainText("gone");
  });

  test("the viewer saves for real, and says why forwarding is not there", async ({ page }) => {
    await openChat(page);
    await openGallery(page);
    await page.getByRole("button", { name: "Open Video shared_clip.mp4" }).click();

    await expect(viewer(page)).toBeVisible();
    const save = viewer(page).getByRole("link", { name: /Save/ });
    await expect(save).toHaveAttribute("href", /^blob:/);
    await expect(save).toHaveAttribute("download", "shared_clip.mp4");

    const forward = viewer(page).getByText("Forward", { exact: true });
    await expect(forward).toHaveAttribute("aria-disabled", "true");
    await expect(forward).toHaveAttribute("title", /later slice/);

    // Deleting uses an inline confirm, never window.confirm.
    await viewer(page).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("group", { name: "Confirm delete" })).toContainText(
      "Delete this video for everyone?",
    );
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("group", { name: "Confirm delete" })).toHaveCount(0);
    await expect(viewer(page)).toBeVisible();
  });

  test("the gallery and the viewer have no axe violations", async ({ page }) => {
    await openChat(page);
    await openGallery(page);
    const galleryResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(galleryResults.violations).toEqual([]);

    await page.getByRole("button", { name: "Open Photo shared_photo.png" }).click();
    await expect(viewer(page)).toBeVisible();
    const viewerResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(viewerResults.violations).toEqual([]);
  });

  test("the transcript still discloses what is not built yet", async ({ page }) => {
    await openChat(page);
    await expect(page.locator(".chat-notes")).toContainText("Voice-note recording");
    await expect(page.locator(".chat-notes")).toContainText("arrive in a later slice");
  });
});
