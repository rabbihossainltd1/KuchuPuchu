import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import {
  CHAT_ID,
  PEER_NAME,
  createMockWorker,
  makePng,
  openFrom,
  signIn,
  type MockWorker,
} from "./helpers";

/**
 * Attachments end-to-end: the attach sheet, the composer strip, the photo
 * editor, stickers and received media — against a mocked Worker, a mocked
 * WebSocket and real PNG bytes.
 *
 * The PNGs are genuine images, not text files with an image extension, so the
 * browser's decode → shrink → JPEG re-encode path really runs. Everything the
 * phone does before upload is asserted here: the 2048 px long edge, the
 * JPEG magic bytes, `meta` facts, the album id and the sealed caption.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker and sockets. This is
 * not physical-device, cross-browser or real Worker↔Web↔Android QA.
 */

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((value, index) => bytes[index] === value);

/** The hidden `input[type=file]` belonging to one attach tile. */
const tileInput = (page: Page, label: string): Locator =>
  page
    .locator(".attach-tile", { has: page.getByRole("button", { name: label, exact: true }) })
    .locator('input[type="file"]');

const openChat = async (page: Page) => {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByText("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড")).toBeVisible();
};

const openAttachMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Attach a photo, video or document" }).click();
  await expect(page.getByRole("group", { name: "Attach something" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ withAttachment: true });
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
  await openChat(page);
});

test.describe("Web attachments", () => {
  test("a photo is shrunk to a 2048 px long edge and uploaded as JPEG", async ({ page }) => {
    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles({
      name: "big.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(3000, 2000, [210, 60, 60])),
    });

    // The composer strip shows what will actually be sent: the pick is decoded
    // and shrunk immediately, so the chip already reports 2048×1365 and the
    // send itself does no image work.
    const chip = page.locator(".composer-attachment");
    await expect(chip).toHaveCount(1);
    await expect(chip.locator("strong")).toHaveText("big.png");
    await expect(chip.locator(".composer-attachment__copy span").first()).toContainText(
      "2048×1365",
    );
    await expect(chip.locator(".composer-attachment__thumb")).toHaveAttribute("src", /^blob:/);
    await expect(page.getByRole("button", { name: "Send 1 attachment" })).toBeEnabled();

    await page.getByRole("button", { name: "Send 1 attachment" }).click();

    await expect.poll(() => worker.uploads.length).toBe(1);
    const upload = worker.uploads[0]!;
    expect(upload.path).toBe("single");
    expect(upload.type).toBe("image/jpeg");
    expect(startsWith(upload.bytes, JPEG_MAGIC)).toBe(true);
    expect(upload.bytes.length).toBeGreaterThan(1000);

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    expect(sent.conversationId).toBe(CHAT_ID);
    expect(sent.body.kind).toBe("FILE");
    expect(sent.body.fileType).toBe("image/jpeg");
    expect(sent.body.fileSize).toBe(upload.bytes.length);
    expect(String(sent.body.fileKey ?? "")).toMatch(/^f\/up\d+\.bin$/);
    expect(String(sent.body.fileName ?? "")).toMatch(/^photo_\d+\.jpg$/);
    expect(String(sent.body.clientId ?? "").startsWith("c_w")).toBe(true);
    expect(sent.body.body).toBe("");

    // Same long edge the phone produces: 3000×2000 → 2048×1365.
    const meta = sent.body.meta as {
      w?: number;
      h?: number;
      album?: string;
      document?: boolean;
    };
    expect(meta.w).toBe(2048);
    expect(meta.h).toBeGreaterThanOrEqual(1360);
    expect(meta.h).toBeLessThanOrEqual(1370);
    expect(meta.album).toBeFalsy();
    expect(meta.document).toBeFalsy();

    // The optimistic bubble previews the local blob, so nothing waits on the
    // network to be visible.
    const mine = page.locator(".bubble--own .attachment__image").first();
    await expect(mine).toHaveAttribute("src", /^blob:/);
    await expect(page.locator(".bubble--failed")).toHaveCount(0);
    await expect(page.locator(".composer-attachment")).toHaveCount(0);
  });

  test("a caption is sealed while the media metadata stays readable", async ({ page }) => {
    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles({
      name: "small.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(400, 300, [30, 140, 90])),
    });

    // The composer renames itself and states the sealing rule honestly.
    const caption = page.getByLabel("Caption for the attached files", { exact: true });
    await expect(caption).toHaveAttribute(
      "placeholder",
      "Add a caption… (optional, sealed in a personal chat)",
    );
    const plaintext = "ছবিটা গতকালের 🔒";
    await caption.fill(plaintext);
    await page.getByRole("button", { name: "Send 1 attachment" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    const body = String(sent.body.body ?? "");
    expect(body.startsWith("KP1.")).toBe(true);
    expect(body).not.toContain(plaintext);
    expect(await openFrom(body, worker.peer, worker.me)).toBe(plaintext);

    // E2EE is precise: the caption is sealed, the file pointer is not. Media
    // bytes travel as ordinary R2 objects, which the UI never claims otherwise.
    expect(String(sent.body.fileKey ?? "").startsWith("f/")).toBe(true);
    // A 400×300 pick already fits inside the 2048 long edge, so no pixels
    // change and the row keeps the file the user actually chose. The moment the
    // image is scaled or edited it becomes photo_<ms>.jpg / image/jpeg — the
    // first test and the editor test pin that half of the rule.
    expect(sent.body.fileName).toBe("small.png");
    expect(sent.body.fileType).toBe("image/png");
    const meta = sent.body.meta as { w?: number; h?: number };
    expect(meta.w).toBe(400);
    expect(meta.h).toBe(300);
    expect(Number(sent.body.fileSize ?? 0)).toBeGreaterThan(0);
  });

  test("several photos share one album id and one send", async ({ page }) => {
    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles([
      {
        name: "a.png",
        mimeType: "image/png",
        buffer: Buffer.from(makePng(300, 200, [200, 40, 40])),
      },
      {
        name: "b.png",
        mimeType: "image/png",
        buffer: Buffer.from(makePng(200, 300, [40, 40, 200])),
      },
    ]);

    await expect(page.locator(".composer-attachment")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Send 2 attachments" })).toBeEnabled();
    await page.getByRole("button", { name: "Send 2 attachments" }).click();

    await expect.poll(() => worker.sent.length).toBe(2);
    expect(worker.uploads.length).toBe(2);
    expect(worker.uploads.every((upload) => upload.path === "single")).toBe(true);
    expect(worker.uploads.map((upload) => upload.name)).toEqual(["a.png", "b.png"]);
    expect(worker.uploads.every((upload) => startsWith(upload.bytes, PNG_MAGIC))).toBe(true);

    const albums = worker.sent.map((sent) => (sent.body.meta as { album?: string }).album ?? "");
    expect(albums[0]).toBeTruthy();
    expect(albums[0]).toBe(albums[1]);
    expect(worker.sent.every((sent) => sent.body.kind === "FILE")).toBe(true);
    // Distinct client ids, or the Worker would treat the second as a duplicate.
    const clientIds = worker.sent.map((sent) => String(sent.body.clientId ?? ""));
    expect(new Set(clientIds).size).toBe(2);
  });

  test("a document keeps its own name, type and bytes", async ({ page }) => {
    await openAttachMenu(page);
    const notes = Buffer.from("KuchuPuchu release notes\n");
    await tileInput(page, "Document").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: notes,
    });

    const chip = page.locator(".composer-attachment");
    await expect(chip).toHaveCount(1);
    await expect(chip.locator("strong")).toHaveText("notes.txt");
    // No thumbnail is invented for a document.
    await expect(chip.locator(".composer-attachment__thumb")).toHaveCount(0);
    await expect(chip.locator(".composer-attachment__icon")).toHaveText("📄");
    // There is no photo editor for a document either.
    await expect(page.getByRole("button", { name: /^Edit photo/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Send 1 attachment" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    expect(sent.body.kind).toBe("FILE");
    expect(sent.body.fileName).toBe("notes.txt");
    expect(sent.body.fileType).toBe("text/plain");
    expect(sent.body.fileSize).toBe(notes.length);
    // A document reports no pixel or duration facts, only that it is one.
    expect(sent.body.meta).toEqual({ document: true });
    expect(Buffer.from(worker.uploads[0]!.bytes).equals(notes)).toBe(true);
    expect(worker.uploads[0]!.type).toBe("text/plain");
  });

  test("'send as a document' uploads a photo's original bytes, unre-encoded", async ({ page }) => {
    await openAttachMenu(page);
    await page.getByText("Send as a document").click();
    await expect(page.getByRole("checkbox", { name: /Send as a document/ })).toBeChecked();

    const png = makePng(2600, 1800, [10, 90, 160]);
    await tileInput(page, "Document").setInputFiles({
      name: "camera.png",
      mimeType: "image/png",
      buffer: Buffer.from(png),
    });

    await expect(page.locator(".composer-attachment strong")).toHaveText("camera.png");
    await page.getByRole("button", { name: "Send 1 attachment" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    expect(worker.uploads[0]!.type).toBe("image/png");
    expect(startsWith(worker.uploads[0]!.bytes, PNG_MAGIC)).toBe(true);
    expect(worker.uploads[0]!.bytes.length).toBe(png.length);
    expect(sent.body.fileName).toBe("camera.png");
    expect(sent.body.fileType).toBe("image/png");
    expect(sent.body.fileSize).toBe(png.length);
    const meta = sent.body.meta as { document?: boolean; w?: number; viewOnce?: unknown };
    expect(meta.document).toBe(true);
    // A document send reports no pixel facts — Android behaves the same.
    expect(meta.w).toBeFalsy();
    expect(meta.viewOnce).toBeFalsy();
  });

  test("the photo editor rotates what is actually uploaded", async ({ page }) => {
    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(1200, 800, [240, 180, 40])),
    });

    await expect(page.locator(".composer-attachment__copy span").first()).toContainText("1200×800");
    await page.getByRole("button", { name: "Edit photo wide.png" }).click();

    const editor = page.getByRole("dialog", { name: "Edit photo wide.png" });
    await expect(editor).toBeVisible();
    await expect(editor.locator(".photo-editor__dims")).toContainText("Sends at 1200 × 800");

    await editor.getByRole("button", { name: "Rotate right" }).click();
    await expect(editor.getByText("Current rotation 90°")).toBeVisible();
    await expect(editor.locator(".photo-editor__dims")).toContainText("Sends at 800 × 1200");

    await editor.getByRole("button", { name: "Save edit" }).click();
    await expect(editor).toHaveCount(0);

    const chip = page.locator(".composer-attachment");
    await expect(chip).toHaveCount(1);
    await expect(chip.locator(".composer-attachment__copy span").first()).toContainText("800×1200");
    await expect(chip.locator(".composer-attachment__copy span").first()).toContainText("edited");
    const editAgain = page.getByRole("button", { name: "Edit photo wide.png" });
    await expect(editAgain).toBeVisible();
    await expect(editAgain).toHaveText("Edit again");

    await page.getByRole("button", { name: "Send 1 attachment" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const meta = worker.sent[0]!.body.meta as { w?: number; h?: number };
    expect(meta.w).toBe(800);
    expect(meta.h).toBe(1200);
    expect(worker.uploads[0]!.type).toBe("image/jpeg");
    expect(startsWith(worker.uploads[0]!.bytes, JPEG_MAGIC)).toBe(true);
  });

  test("removing an attachment before sending drops it from the message", async ({ page }) => {
    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles([
      { name: "keep.png", mimeType: "image/png", buffer: Buffer.from(makePng(120, 90, [1, 2, 3])) },
      { name: "drop.png", mimeType: "image/png", buffer: Buffer.from(makePng(90, 120, [4, 5, 6])) },
    ]);
    await expect(page.locator(".composer-attachment")).toHaveCount(2);

    await page.getByRole("button", { name: "Remove drop.png from this message" }).click();
    await expect(page.locator(".composer-attachment")).toHaveCount(1);
    await expect(page.locator(".composer-attachment strong")).toHaveText("keep.png");
    await expect(page.getByRole("button", { name: "Send 1 attachment" })).toBeEnabled();

    await page.getByRole("button", { name: "Remove keep.png from this message" }).click();
    await expect(page.locator(".composer-attachment")).toHaveCount(0);
    // With nothing left to send the composer returns to its plain-text state.
    await expect(page.getByLabel("Message text", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(worker.uploads.length).toBe(0);
    expect(worker.sent.length).toBe(0);
  });

  test("a sticker is sent as a STICKER row and uploads nothing", async ({ page }) => {
    await page.getByRole("button", { name: "Send a sticker" }).click();

    const picker = page.getByRole("group", { name: "Stickers" });
    await expect(picker).toBeVisible();
    // The catalog is derived from the phone's StickerSheet.kt: 8 packs, and the
    // first pack is Smileys & People with 132 glyphs.
    await expect(picker.getByRole("tab")).toHaveCount(8); // the phone's 8 packs
    await expect(picker.locator(".sticker-picker__count")).toHaveText("Smileys & People · 132");

    const first = picker.locator(".sticker-picker__cell").first();
    const label = (await first.getAttribute("aria-label")) ?? "";
    const glyph = label.replace("Send sticker ", "");
    expect(glyph.length).toBeGreaterThan(0);
    await first.click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    expect(sent.conversationId).toBe(CHAT_ID);
    expect(sent.body.kind).toBe("STICKER");
    const body = String(sent.body.body ?? "");
    expect(body.startsWith("KP1.")).toBe(true);
    expect(await openFrom(body, worker.peer, worker.me)).toBe(glyph);
    // A sticker is text: no file, no upload, no meta.
    expect(worker.uploads.length).toBe(0);
    expect(sent.body.fileKey).toBeFalsy();
    expect(picker).toHaveCount(0);
    await expect(page.locator(".sticker-message").first()).toBeVisible();
  });

  test("a received photo is downloaded with the bearer token", async ({ page }) => {
    const received = page.locator(".bubble-row:not(.bubble-row--own) .attachment__image").first();
    await expect(received).toBeVisible();
    await expect(received).toHaveAttribute("src", /^blob:/);

    // FILE rows carry no public mediaUrl, so the bytes come from /api/files
    // with the same header-only auth the REST surface is pinned to.
    await expect.poll(() => worker.fileDownloads.length).toBeGreaterThan(0);
    expect(worker.fileDownloads).toContain("f/peer_photo.png");
    expect(worker.mediaAuthHeaders.every((header) => header.startsWith("Bearer "))).toBe(true);
    expect(page.url()).not.toContain("token=");

    await expect(page.locator(".attachment--photo").first()).toBeVisible();
    await expect(page.locator(".attachment__once")).toHaveCount(0);
  });

  test("a one-way account cannot attach or send stickers", async ({ page }) => {
    await page.getByRole("link", { name: /KuchuPuchu/ }).click();
    await expect(page.locator(".transcript")).toContainText("welcome");

    const attach = page.getByRole("button", { name: "Attach a photo, video or document" });
    await expect(attach).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send a sticker" })).toBeDisabled();
    await expect(page.getByRole("group", { name: "Attach something" })).toHaveCount(0);
  });

  test("the attach sheet, sticker picker and editor have no axe violations", async ({ page }) => {
    await openAttachMenu(page);
    const menuResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(menuResults.violations).toEqual([]);
    await page.getByRole("button", { name: "Close attach menu" }).click();

    await page.getByRole("button", { name: "Send a sticker" }).click();
    const stickerResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(stickerResults.violations).toEqual([]);
    await page.getByRole("button", { name: "Close stickers" }).click();

    await openAttachMenu(page);
    await tileInput(page, "Gallery").setInputFiles({
      name: "axe.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(600, 400, [80, 80, 200])),
    });
    await page.getByRole("button", { name: "Edit photo axe.png" }).click();
    await expect(page.getByRole("dialog", { name: "Edit photo axe.png" })).toBeVisible();
    const editorResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(editorResults.violations).toEqual([]);
  });

  test("view once can be sent, and it is the only thing that can be", async ({ page }) => {
    await openAttachMenu(page);

    // The two options contradict each other, so the sheet resolves it instead of
    // letting the reader pick something the Worker would silently drop.
    await page.getByRole("checkbox", { name: /View once/ }).check();
    await page.getByRole("checkbox", { name: /Send as a document/ }).check();
    await expect(page.getByRole("checkbox", { name: /View once/ })).not.toBeChecked();
    await page.getByRole("checkbox", { name: /Send as a document/ }).uncheck();
    await page.getByRole("checkbox", { name: /View once/ }).check();

    await tileInput(page, "Gallery").setInputFiles({
      name: "once.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(500, 400, [120, 30, 160])),
    });

    // The chip says what is about to be sent, out loud.
    await expect(page.locator(".composer-attachment").locator(".sr-only")).toContainText(
      "view once",
    );

    await page.getByRole("button", { name: "Send 1 attachment" }).click();
    await expect.poll(() => worker.sent.length).toBe(1);
    const sent = worker.sent[0]!;
    const meta = sent.body.meta as { viewOnce?: boolean; album?: string; w?: number };
    expect(meta.viewOnce).toBe(true);
    expect(meta.album).toBeFalsy();
    expect(meta.w).toBe(500);
    // Android sends the flag in both places; the Worker reads `meta`.
    expect(sent.body.viewOnce).toBe(true);

    // The sender keeps a preview of their own once-message, blurred like the
    // recipient's, until the other side opens it.
    await expect(page.locator(".bubble--own .attachment__image--once")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "View once — open" })).toBeVisible();
    // Opening your own send is not an opening to report.
    expect(worker.viewOnceReports).toEqual([]);
  });

  test("the attach sheet states its limits instead of hiding them", async ({ page }) => {
    await openAttachMenu(page);
    await expect(page.locator(".attach-menu__note")).toContainText("2048 px");
    await expect(page.locator(".attach-menu__note")).toContainText("2 GB video");
    await expect(page.locator(".attach-menu__note")).toContainText("5 GB document");
    // The camera tile is a browser substitute and says so through its input.
    await expect(tileInput(page, "Camera")).toHaveAttribute("capture", "environment");
    await expect(tileInput(page, "Gallery")).toHaveAttribute("multiple", "");
    // Deferred surfaces point at the roadmap rather than pretending to work.
    await expect(page.locator(".chat-notes")).toContainText("arrive in a later slice");
  });
});
