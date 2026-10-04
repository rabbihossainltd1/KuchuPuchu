import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  CHAT_ID,
  DOC_OWN_ID,
  DOC_PDF_ID,
  DOC_SVG_ID,
  DOC_SVG_SCRIPT,
  DOC_TEXT_FIRST_LINE,
  DOC_TEXT_ID,
  DOC_TIFF_ID,
  DOC_ZIP_ID,
  GROUP_ID,
  PEER_NAME,
  createMockWorker,
  signIn,
  type MockWorker,
} from "./helpers";

/**
 * Documents end-to-end (slice E2), against a mocked Worker and a mocked socket.
 *
 * The phone has a document reader with a PDF renderer, a TIFF decoder, an
 * archive lister and an offline WebView. A browser has some of those and not
 * others, so the rule this file enforces is the honest one: whatever the reader
 * can do, it does for real; whatever it cannot, it says so in words and offers
 * the download — and markup another person uploaded is shown as SOURCE and
 * never rendered on this origin.
 *
 * Honest scope: Chromium, mocked Worker and sockets. Chromium's PDF viewer is
 * the one the iframe hands the bytes to; an engine without one gets the
 * "open in a new tab" branch, which case 60 pins.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openChat = async (page: Page) => {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByRole("button", { name: "Media, links and docs" })).toBeVisible();
};

const note = (page: Page, id: string) => page.locator(`[data-message-id="${id}"]`);
const previewButton = (page: Page, id: string, name: string) =>
  note(page, id).getByRole("button", { name: `Open ${name} in the document reader` });
const reader = (page: Page, name: string) => page.getByRole("dialog", { name: `Document ${name}` });
const notice = (page: Page) => page.locator(".doc-viewer__notice").first();
/** Where the chat speaks its announcements (the composer's live region). */
const status = (page: Page) => page.locator(".composer-notice");

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ withDocuments: true });
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

test.describe("Web document reader", () => {
  test("a document row is a card with a real Preview button, and no bytes move until it is pressed", async ({
    page,
  }) => {
    await openChat(page);

    const row = note(page, DOC_TEXT_ID);
    await expect(row).toContainText("notes.txt");
    await expect(previewButton(page, DOC_TEXT_ID, "notes.txt")).toBeVisible();
    await expect(row.locator(".attachment__download")).toBeVisible();
    expect(worker.fileDownloads).not.toContain("f/notes.txt");

    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();

    await expect(reader(page, "notes.txt")).toBeVisible();
    await expect.poll(() => worker.fileDownloads).toContain("f/notes.txt");
    expect(worker.mediaAuthHeaders.at(-1)).toBe("Bearer test-bearer-token");
  });

  test("a text document is shown whole, selectable, as the text it is", async ({ page }) => {
    await openChat(page);
    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();

    const text = reader(page, "notes.txt").locator(".doc-viewer__text");
    await expect(text).toContainText(DOC_TEXT_FIRST_LINE);
    await expect(text).toContainText("the second line");
    await expect(notice(page)).toContainText("Plain text, selectable, first 400 KB");
    // The stamp carries the phone's own size reading.
    await expect(reader(page, "notes.txt").locator(".doc-viewer__stamp")).toContainText("B · ");
    // Somebody else's document: the footer says where the bytes really live.
    await expect(reader(page, "notes.txt").locator(".doc-viewer__foot")).toContainText(
      "stored on the account's media bucket",
    );
  });

  test("Save is a real download of the fetched bytes, and the reader says so", async ({ page }) => {
    await openChat(page);
    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();

    const save = reader(page, "notes.txt").getByRole("link", { name: /Save/ });
    await expect(save).toHaveAttribute("href", /^blob:/);
    await expect(save).toHaveAttribute("download", "notes.txt");
    await expect(
      reader(page, "notes.txt").getByRole("link", { name: "Open in a new tab" }),
    ).toHaveAttribute("href", /^blob:/);

    await save.click();
    await expect(status(page)).toContainText("Saved to your downloads");
  });

  test("a PDF goes to the browser's own viewer, in a frame with no privileges left", async ({
    page,
  }) => {
    await openChat(page);
    await previewButton(page, DOC_PDF_ID, "report.pdf").click();

    const frame = reader(page, "report.pdf").locator(".doc-viewer__frame");
    await expect(notice(page)).toContainText("browser's own PDF viewer");
    if ((await frame.count()) > 0) {
      await expect(frame).toHaveAttribute("src", /^blob:/);
      await expect(frame).toHaveAttribute("title", "PDF report.pdf");
      // The engine's viewer is already a sandbox; the frame is denied the rest.
      await expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-popups");
    } else {
      // An engine with no PDF viewer gets the honest branch instead.
      await expect(reader(page, "report.pdf")).toContainText("no PDF viewer");
      await expect(
        reader(page, "report.pdf").getByRole("link", { name: "Open the PDF in a new tab" }),
      ).toHaveAttribute("href", /^blob:/);
    }
  });

  test("an SVG is shown as source and is never drawn on this origin", async ({ page }) => {
    await openChat(page);

    // If any markup were rendered, its script would run and land here.
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await previewButton(page, DOC_SVG_ID, "drawing.svg").click();

    const body = reader(page, "drawing.svg");
    await expect(notice(page)).toContainText("never drawn");
    await expect(body.locator(".doc-viewer__text")).toContainText(DOC_SVG_SCRIPT);
    await expect(body.locator(".doc-viewer__text")).toContainText("<svg");
    // The markup is text, not nodes: nothing was parsed into the document.
    // The markup is text, not nodes: nothing in the pane that holds a
    // stranger's bytes was parsed into an element. (The header's own icons are
    // inline SVGs, which is why this is scoped to the text pane.)
    const pane = body.locator(".doc-viewer__text");
    await expect(pane.locator("svg")).toHaveCount(0);
    await expect(pane.locator("rect")).toHaveCount(0);
    await expect(pane.locator("script")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(dialogs).toHaveLength(0);
  });

  test("a TIFF and an archive get the phone's card, and say a browser cannot open them", async ({
    page,
  }) => {
    await openChat(page);

    await previewButton(page, DOC_TIFF_ID, "scan.tif").click();
    const tiff = reader(page, "scan.tif");
    await expect(notice(page)).toContainText("No browser can decode a TIFF");
    await expect(tiff.locator(".doc-viewer__badge")).toHaveText("TIF");
    await expect(tiff.locator(".doc-viewer__name")).toHaveText("scan.tif");
    await expect(tiff.locator(".doc-viewer__facts")).toContainText("image/tiff");
    await expect(tiff.getByRole("link", { name: /Download/ })).toHaveAttribute("href", /^blob:/);
    await expect(tiff.locator("img")).toHaveCount(0);
    await tiff.getByRole("button", { name: "Close document" }).click();
    await expect(tiff).toHaveCount(0);

    await previewButton(page, DOC_ZIP_ID, "bundle.zip").click();
    const zip = reader(page, "bundle.zip");
    await expect(notice(page)).toContainText("download-only");
    await expect(zip.locator(".doc-viewer__badge")).toHaveText("ZIP");
    await expect(zip.locator(".doc-viewer__note")).toContainText("archive bytes");
    await expect(zip.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "download",
      "bundle.zip",
    );
  });

  test("the reader forwards a document to another chat, reusing the stored key", async ({
    page,
  }) => {
    await openChat(page);
    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();

    await reader(page, "notes.txt").getByRole("button", { name: "Forward" }).click();

    const picker = page.getByRole("dialog", { name: "Forward to" });
    await expect(picker).toBeVisible();
    // The reader closed behind the picker: one surface at a time.
    await expect(reader(page, "notes.txt")).toHaveCount(0);

    await picker.getByRole("checkbox", { name: /Squad/ }).click();
    await expect(picker.getByText("1 message → 1 chat")).toBeVisible();
    await picker.getByRole("button", { name: "Send" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    expect(worker.sent[0]?.conversationId).toBe(GROUP_ID);
    const body = worker.sent[0]?.body ?? {};
    expect(body.kind).toBe("FILE");
    // The stored key is reused: the bytes are not downloaded and re-uploaded.
    expect(body.fileKey).toBe("f/notes.txt");
    expect(body.fileName).toBe("notes.txt");
    expect(body.fileType).toBe("text/plain");
    expect(((body.meta ?? {}) as Record<string, unknown>).document).toBe(true);
    expect(worker.uploads).toHaveLength(0);

    await expect(picker).toHaveCount(0);
    await expect(status(page)).toContainText("Forwarded 1 message");
  });

  test("my own document can be deleted for everyone, through an inline confirm", async ({
    page,
  }) => {
    await openChat(page);
    await previewButton(page, DOC_OWN_ID, "mine.txt").click();

    const own = reader(page, "mine.txt");
    await expect(own.locator(".doc-viewer__foot")).toContainText("You sent this document");
    await own.getByRole("button", { name: "Delete" }).click();

    const confirm = page.getByRole("group", { name: "Confirm delete" });
    await expect(confirm).toContainText("Delete this document for everyone?");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(own).toBeVisible();

    await own.getByRole("button", { name: "Delete" }).click();
    await confirm.getByRole("button", { name: "Delete for everyone" }).click();

    await expect.poll(() => worker.deletedMessageIds).toContain(DOC_OWN_ID);
    await expect(own).toHaveCount(0);
  });

  test("closing the reader leaves the chat exactly as it was", async ({ page }) => {
    await openChat(page);
    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();
    await expect(reader(page, "notes.txt")).toBeVisible();

    await reader(page, "notes.txt").getByRole("button", { name: "Close document" }).click();

    await expect(reader(page, "notes.txt")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Media, links and docs" })).toBeVisible();
    // One fetch, and no second one on the way out.
    expect(worker.fileDownloads.filter((key) => key === "f/notes.txt")).toHaveLength(1);

    // Escape closes it too, which is the keyboard reader's way out.
    await previewButton(page, DOC_TEXT_ID, "notes.txt").click();
    await expect(reader(page, "notes.txt")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reader(page, "notes.txt")).toHaveCount(0);
    // Reopening fetches again — the reader keeps no cache of its own.
    expect(worker.fileDownloads.filter((key) => key === "f/notes.txt")).toHaveLength(2);
  });

  test("the chat's own notes say what this reader can and cannot do", async ({ page }) => {
    await openChat(page);

    const notes = page.locator(".chat-notes");
    await expect(notes).toContainText("PDF");
    await expect(notes).toContainText("400 KB");
    await expect(notes).toContainText("source");
    await expect(notes).toContainText("download");
    await expect(notes).toContainText("arrive in a later slice");
    // The chat is the direct one, so the reader's own chat id is the one asked.
    expect(worker.sharedMediaCalls.every((call) => call.includes(CHAT_ID) || call === "")).toBe(
      true,
    );
  });
});
