import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makePng } from "../e2e-messaging/helpers";
import {
  CHAT_ID,
  HIDDEN_AUTHOR_ID,
  HIDDEN_AUTHOR_NAME,
  HIDDEN_TEXT_ID,
  ME,
  MINE_PHOTO_ID,
  MINE_TEXT,
  MINE_TEXT_ID,
  PEER_ID,
  PEER_NAME,
  PEER_PHOTO_ID,
  PEER_TEXT,
  PEER_TEXT_ID,
  PEER_VIDEO_ID,
  SEEN_NAME,
  SEEN_TEXT_ID,
  createMockStatusWorker,
  openFrom,
  signIn,
  type MockStatusWorker,
} from "./helpers";

/**
 * Statuses end-to-end (slice F), against a mocked Worker.
 *
 * The point of this file is the four ways a status surface can lie: drawing a
 * ring for a status the reader may not fetch, running the clock while nobody is
 * watching, reporting a view or a reaction that never reached the server (or
 * reaching it twice), and posting a reply as plaintext into a chat both clients
 * treat as sealed. So the assertions are about what was requested, how many
 * times, and what the surface says while it waits.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker. A clip's bytes here
 * are not a decodable video, so what is tested is the honest failure line and
 * the manual controls — the real player is exercised by the messaging suite's
 * clips.
 */

let worker: MockStatusWorker;

const feed = (page: Page) => page.getByRole("region", { name: "Status updates" });
const viewer = (page: Page) => page.getByRole("dialog", { name: /Status from/ });
const segments = (page: Page) => page.locator(".status-viewer__segment");
const fill = (page: Page, index: number) =>
  page.locator(".status-viewer__segment").nth(index).locator(".status-viewer__fill");
const zone = (page: Page, name: "Previous status" | "Next status") =>
  page.getByRole("button", { name });
const controls = (page: Page) => page.locator(".status-viewer__controls .icon-button");
const replyField = (page: Page) => page.locator("#status-reply");
const sheet = (page: Page, name: string) => page.getByRole("dialog", { name });
const composer = (page: Page, name: string) => page.getByRole("dialog", { name });

const openFeed = async (page: Page) => {
  await page.goto("/statuses");
  await expect(feed(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Media status" })).toBeVisible();
};

/** Open somebody's statuses and stop the clock, so assertions are not racing it. */
const openPaused = async (page: Page, name: string | RegExp) => {
  await page.getByRole("button", { name }).click();
  await expect(viewer(page)).toBeVisible();
  await controls(page).first().click();
  await expect(controls(page).first()).toHaveAttribute("aria-pressed", "true");
};

const fillWidth = async (page: Page, index: number) => {
  const width = await fill(page, index).evaluate((node) => node.getBoundingClientRect().width);
  const box = await fill(page, index)
    .locator("xpath=..")
    .evaluate((node) => node.getBoundingClientRect().width);
  return box > 0 ? width / box : 0;
};

test.beforeEach(async ({ page }) => {
  worker = await createMockStatusWorker();
  await signIn(page);
  await worker.install(page);
});

test.describe("Web statuses", () => {
  test("the feed is my row plus Recent updates, with the phone's own words", async ({ page }) => {
    await openFeed(page);

    const rows = page.locator(".status-row");
    // Mine, then Rahi (three updates), then Nila (one) — hidden author included,
    // because nothing has been hidden in this browser yet.
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator(".status-row__name")).toHaveText("My status");
    await expect(rows.nth(0).locator(".status-row__meta")).toContainText("My updates · ");
    await expect(rows.nth(0).locator(".status-row__meta")).toContainText("3 views");
    await expect(page.locator(".status-feed__section")).toHaveText("Recent updates");
    await expect(rows.nth(1).locator(".status-row__name")).toContainText(PEER_NAME);
    await expect(rows.nth(1).locator(".status-row__meta")).toContainText("3 updates · ");
    // The order is newest-update first: the hidden author posted 20 minutes
    // ago, Nila's single update 30 — so she comes last, not third.
    await expect(rows.nth(2).locator(".status-row__name")).toContainText(HIDDEN_AUTHOR_NAME);
    await expect(rows.nth(3).locator(".status-row__name")).toContainText(SEEN_NAME);
    await expect(rows.nth(3).locator(".status-row__meta")).toContainText("1 update · ");
    // A row of one is singular, exactly as the phone pluralises it.
    expect(await rows.nth(3).locator(".status-row__meta").innerText()).not.toContain("1 updates");

    // Newest update first is a CLIENT sort: Rahi posted 7 minutes ago, Nila 30.

    // Nothing was fetched to draw the list: the feed carries no bytes.
    expect(worker.mediaFetches).toHaveLength(0);
  });

  test("a ring has one segment per status, and it grays only when all are seen", async ({
    page,
  }) => {
    await openFeed(page);

    const rows = page.locator(".status-row");
    await expect(rows.nth(1).locator(".status-ring__svg path")).toHaveCount(3);
    await expect(rows.nth(1).locator(".status-ring")).not.toHaveClass(/status-ring--seen/);
    await expect(rows.nth(3).locator(".status-ring__svg path")).toHaveCount(1);
    await expect(rows.nth(3).locator(".status-ring")).toHaveClass(/status-ring--seen/);
    // A single status draws one arc with no gap in it.
    expect(await rows.nth(2).locator(".status-ring__svg path").first().getAttribute("d")).toMatch(
      /^M [\d.]+ [\d.]+ A /,
    );
    // The ring is decoration; the fact is also in words for a screen reader.
    await expect(rows.nth(1).locator(".sr-only")).toContainText("3 statuses");
    await expect(rows.nth(3).locator(".sr-only")).toContainText("all viewed");
  });

  test("opening a viewer paints the card, the stamp and one segment per status", async ({
    page,
  }) => {
    await openFeed(page);
    await openPaused(page, new RegExp(PEER_NAME));

    await expect(segments(page)).toHaveCount(3);
    await expect(viewer(page)).toHaveAttribute("aria-label", `Status from ${PEER_NAME}`);
    await expect(page.locator(".status-viewer__head strong")).toHaveText(PEER_NAME);
    await expect(page.locator(".status-viewer__who span")).toContainText("Today at ");
    await expect(page.locator(".status-viewer__text")).toHaveText(PEER_TEXT);
    // The ocean gradient the phone's map gives this style.
    // The browser normalises an inline gradient to rgb() triples.
    await expect(page.locator(".status-viewer__card")).toHaveAttribute(
      "style",
      /rgb\(186, 230, 253\) 0%, rgb\(2, 132, 199\)/,
    );
    await expect(fill(page, 0)).toBeVisible();
  });

  test("the clock runs five seconds and then steps on by itself", async ({ page }) => {
    await openFeed(page);
    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect(viewer(page)).toBeVisible();

    // Half a second in, the first segment is partly filled and nothing has moved.
    await page.waitForTimeout(700);
    const partway = await fillWidth(page, 0);
    expect(partway).toBeGreaterThan(0.05);
    expect(partway).toBeLessThan(0.6);
    await expect(page.locator(".status-viewer__text")).toHaveText(PEER_TEXT);

    // Five seconds on, the next status is up and the first segment is full.
    await expect(page.locator(".status-viewer__image")).toBeVisible({ timeout: 8_000 });
    await expect(fill(page, 0)).toHaveCSS("width", /.+/);
    expect(await fillWidth(page, 0)).toBeGreaterThan(0.98);
  });

  test("a view is reported once per status, and never for your own", async ({ page }) => {
    await openFeed(page);

    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect.poll(() => worker.views).toContain(PEER_TEXT_ID);

    // Stepping forward reports the next one; stepping back reports nothing new.
    await zone(page, "Next status").click();
    await expect.poll(() => worker.views).toContain(PEER_PHOTO_ID);
    await zone(page, "Previous status").click();
    await page.waitForTimeout(300);
    expect(worker.views.filter((id) => id === PEER_TEXT_ID)).toHaveLength(1);

    // Walking to the end and one step past it closes the viewer.
    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await expect(viewer(page)).toHaveCount(0);

    // Your own statuses are not views of yourself.
    await page.getByRole("button", { name: "My status" }).click();
    await expect(viewer(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(worker.views).not.toContain(MINE_TEXT_ID);
    expect(worker.views).not.toContain(MINE_PHOTO_ID);
  });

  test("the halves step, the arrows step, and the last status closes the viewer", async ({
    page,
  }) => {
    await openFeed(page);
    await openPaused(page, new RegExp(PEER_NAME));

    await zone(page, "Next status").click();
    await expect(page.locator(".status-viewer__image")).toBeVisible();
    await zone(page, "Previous status").click();
    await expect(page.locator(".status-viewer__text")).toHaveText(PEER_TEXT);

    // The keyboard drives the same two steps.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".status-viewer__image")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".status-viewer__text")).toHaveText(PEER_TEXT);

    // Back on the first status there is nowhere back to.
    await expect(zone(page, "Previous status")).toBeDisabled();

    // Forward off the last one closes, exactly as the phone pops the screen.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // The third status is a clip this browser cannot decode: the honest line,
    // not a black rectangle.
    await expect(page.locator(".status-viewer__waiting")).toContainText(
      "That clip could not be loaded.",
    );
    await page.keyboard.press("ArrowRight");
    await expect(viewer(page)).toHaveCount(0);
    await expect(feed(page)).toBeVisible();
  });

  test("a hold pauses the clock, a sheet pauses it, and the pause button is the keyboard's hold", async ({
    page,
  }) => {
    await openFeed(page);
    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect(viewer(page)).toBeVisible();

    // Finger down on the picture: the clock stops where it is.
    await zone(page, "Next status").hover();
    await page.mouse.down();
    await page.waitForTimeout(500);
    const held = await fillWidth(page, 0);
    await page.waitForTimeout(900);
    expect(await fillWidth(page, 0)).toBeCloseTo(held, 2);
    await page.mouse.up();

    // A sheet pauses it too — nothing advances behind the menu.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(sheet(page, "Status menu")).toBeVisible();
    const withSheet = await fillWidth(page, 0);
    await page.waitForTimeout(900);
    expect(await fillWidth(page, 0)).toBeCloseTo(withSheet, 2);
    await page.keyboard.press("Escape");
    await expect(sheet(page, "Status menu")).toHaveCount(0);

    // And the labelled pause button is the same thing for a keyboard.
    await controls(page).first().click();
    await expect(controls(page).first()).toHaveAttribute("aria-pressed", "true");
    await expect(controls(page).first()).toHaveAttribute("aria-label", "Resume");
    const paused = await fillWidth(page, 0);
    await page.waitForTimeout(900);
    expect(await fillWidth(page, 0)).toBeCloseTo(paused, 2);
    await controls(page).first().click();
    await expect(controls(page).first()).toHaveAttribute("aria-pressed", "false");
  });

  test("a reply is sealed for the author, carries the status it answers, and clears the box", async ({
    page,
  }) => {
    await openFeed(page);
    await openPaused(page, new RegExp(PEER_NAME));

    await replyField(page).fill("সুন্দর ছবি!");
    await page.keyboard.press("Enter");

    // The box clears the moment Send is pressed — the phone's optimistic reply.
    await expect(replyField(page)).toHaveValue("");

    await expect.poll(() => worker.conversationPosts).toEqual([PEER_ID]);
    await expect.poll(() => worker.messages.length).toBe(1);
    const sent = worker.messages[0];
    expect(sent?.conversationId).toBe(CHAT_ID);
    const body = sent?.body ?? {};
    expect(body.kind).toBe("TEXT");
    // Sealed, not plaintext: a personal chat's body never leaves readable.
    expect(String(body.body ?? "")).toMatch(/^KP1\./);
    expect(String(body.body ?? "")).not.toContain("সুন্দর");
    // And it opens with the author's key to the words that were typed.
    expect(await openFrom(String(body.body), worker.peer, worker.me)).toBe("সুন্দর ছবি!");
    // It says which status it answered.
    expect(JSON.stringify((body.meta ?? {}) as Record<string, unknown>)).toContain(PEER_TEXT_ID);
    expect(
      (((body.meta ?? {}) as Record<string, unknown>).status as Record<string, unknown>).id,
    ).toBe(PEER_TEXT_ID);
    // Releasing the field is what un-pauses the clock: the reply bar no longer
    // holds focus, so the pause condition that kept it stopped is gone.
    await expect(replyField(page)).not.toBeFocused();
  });

  test("the seven quick reactions post the emoji, and nothing else can be posted", async ({
    page,
  }) => {
    await openFeed(page);
    await openPaused(page, new RegExp(PEER_NAME));

    const reactions = page.locator(".status-viewer__reaction");
    await expect(reactions).toHaveCount(7);
    await expect(reactions.nth(0)).toHaveAttribute("aria-label", "React ❤️");

    await reactions.nth(0).click();
    await expect.poll(() => worker.reactions.length).toBe(1);
    expect(worker.reactions[0]).toEqual({ id: PEER_TEXT_ID, emoji: "❤️" });

    await reactions.nth(5).click();
    await expect.poll(() => worker.reactions.length).toBe(2);
    expect(worker.reactions[1]?.emoji).toBe("🔥");

    // A reaction never becomes a chat message.
    expect(worker.messages).toHaveLength(0);
  });

  test("your own status shows its real view count and the viewed-by list", async ({ page }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "My status" }).click();
    await expect(viewer(page)).toBeVisible();

    // The first of my two statuses is the text one, which nobody has viewed.
    await expect(page.locator(".status-viewer__views")).toHaveText("0 views");
    await zone(page, "Next status").click();
    await expect(page.locator(".status-viewer__views")).toHaveText("3 views");

    await page.locator(".status-viewer__views").click();
    const viewers = sheet(page, "Viewed by");
    await expect(viewers).toBeVisible();
    await expect(viewers.locator(".status-sheet__viewer")).toHaveCount(2);
    await expect(viewers.locator(".status-sheet__viewer").first()).toContainText(PEER_NAME);
    await expect.poll(() => worker.viewersCalls).toContain(MINE_PHOTO_ID);

    // A viewer row opens the chat with them.
    await viewers.locator(".status-sheet__viewer").first().click();
    await expect.poll(() => worker.conversationPosts).toContain(PEER_ID);
    await expect(viewer(page)).toHaveCount(0);
  });

  test("a photo status fetches its bytes from the status route, with the session header", async ({
    page,
  }) => {
    await openFeed(page);
    expect(worker.mediaFetches).toHaveLength(0);

    await openPaused(page, new RegExp(PEER_NAME));
    // The first status is text: no bytes for it.
    expect(worker.mediaFetches).not.toContain(PEER_TEXT_ID);

    await zone(page, "Next status").click();
    await expect(page.locator(".status-viewer__image")).toBeVisible();
    await expect.poll(() => worker.mediaFetches).toContain(PEER_PHOTO_ID);
    expect(worker.mediaAuthHeaders.at(-1)).toBe("Bearer test-bearer-token");
    await expect(page.locator(".status-viewer__image")).toHaveAttribute(
      "alt",
      `Photo status from ${PEER_NAME}`,
    );
  });

  test("a clip this browser cannot decode says so instead of showing a black frame", async ({
    page,
  }) => {
    await openFeed(page);
    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect(viewer(page)).toBeVisible();

    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await expect.poll(() => worker.mediaFetches).toContain(PEER_VIDEO_ID);
    await expect(page.locator(".status-viewer__waiting")).toContainText(
      "That clip could not be loaded.",
    );
    // The manual controls still work: a stalled clip is not a stuck viewer.
    await zone(page, "Next status").click();
    await expect(viewer(page)).toHaveCount(0);
    expect(worker.views.filter((id) => id === PEER_VIDEO_ID)).toHaveLength(1);
  });

  test("deleting your own status asks first, then really asks the server", async ({ page }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "My status" }).click();
    await expect(viewer(page)).toBeVisible();

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(sheet(page, "Status menu")).toBeVisible();
    await sheet(page, "Status menu").getByRole("button", { name: "Delete status" }).click();

    const confirm = page.getByRole("group", { name: "Confirm delete" });
    await expect(confirm).toContainText("Delete status?");
    await expect(confirm).toContainText("Removed for everyone.");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(confirm).toHaveCount(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await sheet(page, "Status menu").getByRole("button", { name: "Delete status" }).click();
    await confirm.getByRole("button", { name: "Delete" }).click();

    // The viewer leaves at once and the request goes out behind it.
    await expect(viewer(page)).toHaveCount(0);
    await expect.poll(() => worker.deletes).toContain(MINE_TEXT_ID);
    // The feed re-read behind the delete: one status left, so one arc.
    await expect(page.locator(".status-row").first().locator(".status-ring__svg path")).toHaveCount(
      1,
    );
    await expect(page.locator(".status-row__meta").first()).toContainText("My updates");
  });

  test("somebody else's menu offers Message, Hide and Report — and no Delete", async ({ page }) => {
    await openFeed(page);
    await openPaused(page, new RegExp(PEER_NAME));

    await page.getByRole("button", { name: "Menu" }).click();
    const menu = sheet(page, "Status menu");
    await expect(menu.getByRole("button", { name: "Message" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Hide status" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Report" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Delete status" })).toHaveCount(0);

    // Report is an acknowledgement: there is no route for it, and none is faked.
    await menu.getByRole("button", { name: "Report" }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".status-feed p.sr-only")).toContainText("Reported. Thank you.");
    expect(worker.deletes).toHaveLength(0);
  });

  test("hiding an author is this browser's own list, and it survives a reload", async ({
    page,
  }) => {
    await openFeed(page);
    await expect(
      page.locator(".status-row__name").filter({ hasText: HIDDEN_AUTHOR_NAME }),
    ).toHaveCount(1);

    await openPaused(page, new RegExp(HIDDEN_AUTHOR_NAME));
    await page.getByRole("button", { name: "Menu" }).click();
    await sheet(page, "Status menu").getByRole("button", { name: "Hide status" }).click();

    await expect(viewer(page)).toHaveCount(0);
    await expect(
      page.locator(".status-row__name").filter({ hasText: HIDDEN_AUTHOR_NAME }),
    ).toHaveCount(0);
    await expect(page.locator(".status-feed p.sr-only")).toContainText("Status hidden");

    // The list is persisted here, and the server still sends that author.
    const stored = await page.evaluate(() => window.localStorage.getItem("kp.status.hidden"));
    expect(stored).toContain(HIDDEN_AUTHOR_ID);

    await page.reload();
    await openFeed(page);
    await expect(
      page.locator(".status-row__name").filter({ hasText: HIDDEN_AUTHOR_NAME }),
    ).toHaveCount(0);
    await expect(page.locator(".status-row__name").filter({ hasText: PEER_NAME })).toHaveCount(1);
    // The hidden author's status was never fetched.
    expect(worker.mediaFetches).not.toContain(HIDDEN_TEXT_ID);
  });

  test("a text status is composed on a gradient card and posted as the Worker expects", async ({
    page,
  }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "Text status" }).click();

    const dialog = composer(page, "Text status");
    await expect(dialog).toBeVisible();
    // Six backgrounds, as a real radio group with the phone's ids.
    const swatches = dialog.getByRole("radio");
    await expect(swatches).toHaveCount(6);
    await expect(swatches.nth(0)).toHaveAttribute("aria-checked", "true");
    // The browser normalises an inline gradient to rgb() triples.
    await expect(dialog.locator(".status-composer__card")).toHaveAttribute(
      "style",
      /rgb\(253, 230, 138\)/,
    );
    await swatches.nth(5).click();
    await expect(swatches.nth(5)).toHaveAttribute("aria-checked", "true");
    await expect(dialog.locator(".status-composer__card")).toHaveAttribute(
      "style",
      /rgb\(28, 25, 23\)/,
    );

    await expect(dialog.getByRole("button", { name: "Post status" })).toBeDisabled();
    await dialog.locator("#status-text").fill("  শুভ সকাল  ");
    await expect(dialog.locator(".status-composer__preview")).toHaveText("শুভ সকাল");
    await expect(dialog.locator(".status-composer__count")).toContainText("characters left");

    await dialog.getByRole("button", { name: "Post status" }).click();

    await expect.poll(() => worker.posts.length).toBe(1);
    expect(worker.posts[0]).toEqual({ kind: "TEXT", text: "শুভ সকাল", bgStyle: "ink" });
    await expect(dialog).toHaveCount(0);
    // The viewer opens on your own group; the new status is its newest, so it
    // is the LAST segment (the server orders a group oldest first).
    await expect(viewer(page)).toBeVisible();
    await expect(segments(page)).toHaveCount(3);
    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await expect(page.locator(".status-viewer__text")).toHaveText("শুভ সকাল");
  });

  test("a photo status goes through the editor and is posted inside the inline cap", async ({
    page,
  }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "Media status" }).click();

    const dialog = composer(page, "Media status");
    await expect(dialog).toBeVisible();
    // The disclosed limits are on the chooser, before anything is picked.
    await expect(dialog).toContainText("cannot trim or re-encode");
    await expect(dialog.getByRole("button", { name: "Post status" })).toBeDisabled();

    await dialog.locator("input[aria-label='Photo for your status']").setInputFiles({
      name: "sunrise.png",
      mimeType: "image/png",
      buffer: Buffer.from(makePng(1600, 1200, [250, 190, 90])),
    });

    // The phone hands a status photo to its editor; so does this.
    const editor = page.getByRole("dialog", { name: "Edit photo sunrise.png" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Save edit" }).click();

    await expect(dialog.locator(".status-composer__media img")).toBeVisible();
    await expect(dialog.locator(".status-composer__facts")).toContainText("sunrise.png");
    await dialog.getByRole("button", { name: "Post status" }).click();

    await expect.poll(() => worker.posts.length).toBe(1);
    const post = worker.posts[0] ?? {};
    expect(post.kind).toBe("IMAGE");
    expect(String(post.imageData ?? "")).toMatch(/^data:image\/jpeg;base64,/);
    // The Worker refuses an inline photo longer than 450 000 characters.
    expect(String(post.imageData ?? "").length).toBeLessThanOrEqual(450_000);
    expect(String(post.imageData ?? "").length).toBeGreaterThan(1000);
    expect(post.text).toBe("");
    // It fit inline, so nothing was uploaded.
    expect(worker.uploads).toHaveLength(0);
  });

  test("a video status is uploaded whole, with its own seconds, and says why there is no trimmer", async ({
    page,
  }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "Media status" }).click();

    const dialog = composer(page, "Media status");
    await dialog.locator("input[aria-label='Video for your status']").setInputFiles({
      name: "clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from(new Uint8Array(4096).fill(7)),
    });

    await expect(dialog.locator(".status-composer__facts")).toContainText("clip.mp4");
    await expect(dialog.locator(".status-composer__note")).toContainText(
      "cannot trim or re-encode",
    );
    await dialog.getByRole("button", { name: "Post status" }).click();

    await expect.poll(() => worker.uploads.length).toBe(1);
    expect(worker.uploads[0]?.name).toBe("clip.mp4");
    expect(worker.uploads[0]?.type).toBe("video/mp4");

    await expect.poll(() => worker.posts.length).toBe(1);
    const post = worker.posts[0] ?? {};
    expect(post.kind).toBe("VIDEO");
    expect(String(post.fileKey ?? "")).toMatch(/^f\/up\d+\.bin$/);
    // A clip whose metadata never arrives is posted with the phone's minimum.
    expect(post.seconds).toBe(1);
    expect(post.text).toBe("");
  });

  test("the feed says what a browser cannot do, and what a status costs nobody", async ({
    page,
  }) => {
    await openFeed(page);

    const notes = page.locator(".status-notes");
    await expect(notes).toContainText("cannot trim or re-encode");
    await expect(notes).toContainText("120 seconds");
    await expect(notes).toContainText("24 hours");
    await expect(notes).toContainText("this browser only");
    await expect(notes).toContainText("status privacy setting");
    await expect(notes).toContainText("Only you");
    await expect(page.locator(".status-feed__head")).toContainText("24 hours");
  });

  test("a feed that fails says so and offers a retry that works", async ({ page }) => {
    worker = await createMockStatusWorker({ feedFails: true });
    await signIn(page);
    await worker.install(page);
    await openFeed(page);

    await expect(page.locator(".status-feed__state--error")).toBeVisible();
    await expect(page.locator(".status-feed__state--error")).toContainText(
      "temporarily unavailable",
    );

    // The retry re-reads; with the same failing mock it fails again, honestly.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".status-feed__state--error")).toBeVisible();
    expect(worker.posts).toHaveLength(0);
  });

  test("an empty feed invites a first status instead of showing a blank pane", async ({ page }) => {
    // No statuses of mine and every other author hidden: the reader's list is
    // empty even though the server has rows to send.
    worker = await createMockStatusWorker({ withoutMine: true });
    await signIn(page);
    await worker.install(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "kp.status.hidden",
        JSON.stringify({ ids: ["u_peer", "u_seen", "u_hidden"] }),
      );
    });
    await openFeed(page);

    await expect(page.locator(".status-row")).toHaveCount(1);
    await expect(page.locator(".status-row__meta")).toHaveText("Tap to add a status update");
    await expect(page.locator(".status-feed__empty")).toContainText("No status updates yet.");
  });

  test("the feed and the viewer have no axe violations", async ({ page }) => {
    await openFeed(page);
    const feedResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(feedResults.violations).toEqual([]);

    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect(viewer(page)).toBeVisible();
    const viewerResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(viewerResults.violations).toEqual([]);
  });

  test("no control on these surfaces is unlabeled or hover-only", async ({ page }) => {
    await openFeed(page);

    for (const selector of [".status-row", ".status-feed__actions button"]) {
      const nodes = page.locator(selector);
      const count = await nodes.count();
      expect(count, selector).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const node = nodes.nth(index);
        const name = ((await node.getAttribute("aria-label")) ?? (await node.innerText())).trim();
        expect(name.length, `${selector} #${index}`).toBeGreaterThan(2);
      }
    }

    await page.getByRole("button", { name: new RegExp(PEER_NAME) }).click();
    await expect(viewer(page)).toBeVisible();
    const buttons = viewer(page).locator("button");
    const total = await buttons.count();
    expect(total).toBeGreaterThan(10);
    for (let index = 0; index < total; index += 1) {
      const button = buttons.nth(index);
      const name = ((await button.getAttribute("aria-label")) ?? (await button.innerText())).trim();
      expect(name.length, `viewer button #${index}`).toBeGreaterThan(1);
    }
    // The two tap zones are named, and the reply field has a label.
    await expect(zone(page, "Previous status")).toHaveCount(1);
    await expect(zone(page, "Next status")).toHaveCount(1);
    await expect(page.locator("label[for='status-reply']")).toHaveCount(1);
    await expect(viewer(page)).toContainText("Reply to");
    // Walking off the end closes the viewer.
    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await zone(page, "Next status").click();
    await expect(viewer(page)).toHaveCount(0);
    await expect(feed(page)).toBeVisible();
    await page.getByRole("button", { name: "My status" }).click();
    await expect(page.locator(".status-viewer__head strong")).toHaveText(ME.displayName);
    await expect(page.locator(".status-viewer__views")).toBeVisible();
    // A reply bar is not drawn for your own status.
    await expect(replyField(page)).toHaveCount(0);
    await expect(page.locator(".status-viewer__reaction")).toHaveCount(0);
  });
});
