import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAT_ID,
  PEER_NAME,
  VOICE_ONCE_ID,
  VOICE_OWN_ID,
  VOICE_PEER_ID,
  createMockWorker,
  makeWav,
  signIn,
  type MockWorker,
} from "./helpers";

/**
 * Voice notes end-to-end (slice E2), against a mocked Worker and a mocked
 * WebSocket but a REAL microphone: Chromium's fake capture device feeds a WAV
 * file into a genuine MediaStream, so MediaRecorder produces genuine webm/opus
 * bytes and the whole send path — upload, post, echo, confirmed row — runs.
 *
 * What this file is for is the three ways a voice surface can lie: drawing a
 * bubble whose bytes never arrive, spending a view-once opening the reader did
 * not ask for, and claiming a note was sent when the recorder produced nothing.
 *
 * Honest scope: Chromium, synthetic pointer events, mocked Worker and sockets.
 * Safari's missing MediaRecorder.pause and an mp4 container are contract-tested
 * in case 59, not here.
 */

/** Chromium's fake capture device needs a 16-bit PCM WAV on disk. */
const FAKE_MIC_WAV = join(tmpdir(), "kp-fake-microphone.wav");
writeFileSync(FAKE_MIC_WAV, Buffer.from(makeWav(4, 48_000)));

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

let worker: MockWorker;
let chatSocket: WebSocketRoute | null = null;
let userSocket: WebSocketRoute | null = null;

const openChat = async (page: Page) => {
  await page.getByRole("link", { name: new RegExp(PEER_NAME) }).click();
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();
};

/** The bubble for one seeded note. */
const note = (page: Page, id: string) => page.locator(`[data-message-id="${id}"]`);
const playButton = (page: Page, id: string) =>
  note(page, id).getByRole("button", { name: /voice message|Play once/ });
const wave = (page: Page, id: string) => note(page, id).getByRole("slider");
const speed = (page: Page, id: string) =>
  note(page, id).getByRole("button", { name: /Playback speed/ });
/** Where the chat speaks its announcements (the composer's live region). */
const status = (page: Page) => page.locator(".composer-notice");
const recorderPanel = (page: Page) => page.getByRole("group", { name: "Voice recording" });
const micButton = (page: Page) => page.getByRole("button", { name: /Record a voice note/ });

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({ withVoice: true });
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

test.describe("Web voice notes", () => {
  test("a note is a voice bubble, not a file row, and it draws the recorded bars", async ({
    page,
  }) => {
    await openChat(page);

    const bubble = note(page, VOICE_PEER_ID);
    await expect(bubble.locator(".voice-note")).toBeVisible();
    // No document furniture: a note never offers Preview or a download link.
    await expect(bubble.locator(".attachment__preview")).toHaveCount(0);
    await expect(bubble.locator(".attachment__download")).toHaveCount(0);

    // The bars are the ones the sender recorded, carried in meta.waveform.
    await expect(bubble.locator(".voice-wave__bar")).toHaveCount(12);
    await expect(bubble.locator(".voice-note__time")).toHaveText("0:04");
    await expect(playButton(page, VOICE_PEER_ID)).toHaveAccessibleName("Play voice message");
    await expect(speed(page, VOICE_PEER_ID)).toHaveText("1x");

    // Nothing was fetched to draw it: the wave travels in the message meta.
    expect(worker.fileDownloads).not.toContain("f/voice_peer.wav");
  });

  test("playing fetches the bytes once, with the session token, and pauses where it stopped", async ({
    page,
  }) => {
    await openChat(page);

    await playButton(page, VOICE_PEER_ID).click();

    await expect(playButton(page, VOICE_PEER_ID)).toHaveAccessibleName("Pause voice message");
    await expect
      .poll(() => worker.fileDownloads.filter((k) => k === "f/voice_peer.wav").length)
      .toBe(1);
    expect(worker.mediaAuthHeaders.at(-1)).toBe("Bearer test-bearer-token");

    // The transport really moved: the slider's value climbs, the bars behind it
    // fill in, and the clock counts the position instead of the length.
    const slider = wave(page, VOICE_PEER_ID);
    await expect
      .poll(async () => Number(await slider.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    expect(Number(await slider.getAttribute("aria-valuemax"))).toBe(100);
    await expect(
      note(page, VOICE_PEER_ID).locator(".voice-wave__bar--played").first(),
    ).toBeVisible();
    await expect(note(page, VOICE_PEER_ID).locator(".voice-note__time")).not.toHaveText("0:04");

    await playButton(page, VOICE_PEER_ID).click();
    await expect(playButton(page, VOICE_PEER_ID)).toHaveAccessibleName("Play voice message");
    const held = await note(page, VOICE_PEER_ID).getByRole("slider").getAttribute("aria-valuenow");
    await page.waitForTimeout(600);
    await expect(note(page, VOICE_PEER_ID).getByRole("slider")).toHaveAttribute(
      "aria-valuenow",
      held ?? "0",
    );
  });

  test("one note's speed is its own: 1x → 2x → 3x → 4x → 1x, and the other note never moves", async ({
    page,
  }) => {
    await openChat(page);

    await speed(page, VOICE_PEER_ID).click();
    await expect(speed(page, VOICE_PEER_ID)).toHaveText("2x");
    await expect(speed(page, VOICE_PEER_ID)).toHaveAccessibleName(
      "Playback speed 2 times normal. Activate for the next speed.",
    );
    // r76-16: the owner's complaint was that one note's 2x made every note 2x.
    await expect(speed(page, VOICE_OWN_ID)).toHaveText("1x");

    await speed(page, VOICE_PEER_ID).click();
    await speed(page, VOICE_PEER_ID).click();
    await expect(speed(page, VOICE_PEER_ID)).toHaveText("4x");
    await speed(page, VOICE_PEER_ID).click();
    await expect(speed(page, VOICE_PEER_ID)).toHaveText("1x");
    await expect(speed(page, VOICE_OWN_ID)).toHaveText("1x");
  });

  test("the wave is a real slider: a keyboard can seek a note it can see", async ({ page }) => {
    await openChat(page);

    const slider = wave(page, VOICE_PEER_ID);
    await expect(slider).toHaveAttribute("aria-valuemin", "0");
    await expect(slider).toHaveAttribute("aria-valuemax", "100");
    await slider.focus();
    await expect(slider).toHaveAttribute("aria-valuenow", "0");

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const afterArrows = Number((await slider.getAttribute("aria-valuenow")) ?? "0");
    expect(afterArrows).toBeGreaterThan(0);

    // Re-focus before each key: playback-state repaints can move focus in the
    // headless shell, and the contract under test is "the slider answers the
    // keyboard while focused", not "focus never moves".
    await slider.focus();
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");

    // Seeking a paused note downloads it; the fetch is the same single one.
    expect(worker.fileDownloads.filter((k) => k === "f/voice_peer.wav").length).toBeLessThanOrEqual(
      1,
    );
  });

  test("a view-once note cannot be seeked, and its single opening is the play", async ({
    page,
  }) => {
    await openChat(page);

    const once = note(page, VOICE_ONCE_ID);
    await expect(playButton(page, VOICE_ONCE_ID)).toHaveAccessibleName(
      "Play once — this is its single opening",
    );
    await expect(once.locator(".voice-note__once")).toBeVisible();
    // No seeking on a once note: the slider is disabled and not focusable.
    await expect(wave(page, VOICE_ONCE_ID)).toHaveAttribute("aria-disabled", "true");
    await expect(wave(page, VOICE_ONCE_ID)).toHaveAttribute(
      "aria-label",
      "View-once voice message (cannot be seeked)",
    );
    // No speed control either — the once mark sits in its seat.
    await expect(once.getByRole("button", { name: /Playback speed/ })).toHaveCount(0);

    // Merely drawing the bubble burned nothing.
    expect(worker.messageMediaFetches).not.toContain(VOICE_ONCE_ID);
    expect(worker.viewOnceReports).not.toContain(VOICE_ONCE_ID);

    await playButton(page, VOICE_ONCE_ID).click();

    // The fetch went through the message route — that route IS the opening.
    await expect.poll(() => worker.messageMediaFetches).toContain(VOICE_ONCE_ID);
    expect(worker.messageMediaFetches).not.toContain("f/voice_once.wav");
    await expect.poll(() => worker.viewOnceReports).toContain(VOICE_ONCE_ID);

    // A second press reports nothing new: one opening, de-duplicated here.
    await playButton(page, VOICE_ONCE_ID).click();
    await page.waitForTimeout(400);
    expect(worker.viewOnceReports.filter((id) => id === VOICE_ONCE_ID)).toHaveLength(1);

    // The row leaves when the server says it is gone — the same VANISHED frame
    // a spent photo arrives with. A client never deletes it on its own say-so.
    expect(chatSocket, "the chat socket should be connected").not.toBeNull();
    chatSocket!.send(
      JSON.stringify({
        type: "message",
        conversationId: CHAT_ID,
        message: { id: VOICE_ONCE_ID, senderId: "u_peer", kind: "VANISHED" },
      }),
    );
    await expect(note(page, VOICE_ONCE_ID)).toHaveCount(0, { timeout: 15_000 });
    // The marker is an instruction, never a bubble of its own.
    await expect(page.locator(".transcript")).not.toContainText("VANISHED");
  });

  test("the sender's own note previews from its file key and spends nothing", async ({ page }) => {
    await openChat(page);

    await playButton(page, VOICE_OWN_ID).click();
    await expect(playButton(page, VOICE_OWN_ID)).toHaveAccessibleName("Pause voice message");
    await expect.poll(() => worker.fileDownloads).toContain("f/voice_own.wav");
    expect(worker.messageMediaFetches).not.toContain(VOICE_OWN_ID);
    expect(worker.viewOnceReports).toHaveLength(0);
  });

  test("a click on the mic arms the locked panel, and Send posts a real voice note", async ({
    page,
  }) => {
    await openChat(page);

    // With nothing typed the circle is a microphone, not a send button.
    await expect(micButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);

    await micButton(page).click();

    // The tap-is-lock rule (r76-19): the panel is up without a drag.
    await expect(recorderPanel(page)).toBeVisible();
    await expect(recorderPanel(page).locator(".recorder__clock")).toContainText("0:0");
    await expect(
      recorderPanel(page).getByRole("button", { name: "Send the voice note" }),
    ).toBeVisible();
    await expect(
      recorderPanel(page).getByRole("button", { name: "Pause recording" }),
    ).toBeVisible();
    await expect(
      recorderPanel(page).getByRole("button", { name: "Delete the recording" }),
    ).toBeVisible();
    await expect(
      recorderPanel(page).getByRole("button", { name: /Send as view once/ }),
    ).toBeVisible();
    // The live strip is drawing real samples from the fake microphone.
    await expect
      .poll(() => recorderPanel(page).locator(".recorder__wave-bar").count())
      .toBeGreaterThan(8);

    // While a take runs the chat says it is recording, not typing.
    await expect
      .poll(() => worker.typingCalls.filter((call) => call.kind === "voice").length)
      .toBeGreaterThan(0);
    expect(worker.typingCalls.every((call) => call.conversationId === CHAT_ID)).toBe(true);

    // Let the take pass the one-second floor, then send it.
    await expect(recorderPanel(page).locator(".recorder__clock")).not.toHaveText("0:00", {
      timeout: 15_000,
    });
    await recorderPanel(page).getByRole("button", { name: "Send the voice note" }).click();

    await expect.poll(() => worker.uploads.length).toBe(1);
    expect(worker.uploads[0]?.type).toBe("audio/webm");
    expect(worker.uploads[0]?.name).toMatch(/^voice_\d+\.webm$/);
    expect(worker.uploads[0]?.bytes.byteLength ?? 0).toBeGreaterThan(1000);

    await expect.poll(() => worker.sent.length).toBe(1);
    const body = worker.sent[0]?.body ?? {};
    expect(worker.sent[0]?.conversationId).toBe(CHAT_ID);
    expect(body.kind).toBe("FILE");
    expect(body.fileName).toMatch(/^voice_\d+\.webm$/);
    expect(body.fileType).toBe("audio/webm");
    expect(String(body.fileKey ?? "")).toMatch(/^f\//);
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    expect(meta.voice).toBe(true);
    expect(Number(meta.seconds)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(meta.waveform)).toBe(true);
    expect((meta.waveform as number[]).length).toBeGreaterThan(0);
    expect((meta.waveform as number[]).every((bar) => bar >= 0 && bar <= 100)).toBe(true);
    expect(typeof meta.clientId).toBe("string");

    // The transcript shows the note as its own bubble, not as a document.
    const echo = page.locator(".bubble-row--own .voice-note").last();
    await expect(echo).toBeVisible();
    await expect(echo.locator(".voice-wave__bar").first()).toBeVisible();

    // The recorder is gone and the composer is back to a microphone.
    await expect(recorderPanel(page)).toHaveCount(0);
    await expect(micButton(page)).toBeVisible();
  });

  test("a take under a second is thrown away, and the composer says so", async ({ page }) => {
    await openChat(page);

    await micButton(page).click();
    await expect(recorderPanel(page)).toBeVisible();
    await recorderPanel(page).getByRole("button", { name: "Send the voice note" }).click();

    await expect(page.locator('.composer__error[role="alert"]')).toContainText("too short");
    await expect(status(page)).toContainText("too short");
    expect(worker.sent).toHaveLength(0);
    expect(worker.uploads).toHaveLength(0);
    await expect(recorderPanel(page)).toHaveCount(0);
  });

  test("Delete in the panel throws the take away without posting anything", async ({ page }) => {
    await openChat(page);

    await micButton(page).click();
    await expect(recorderPanel(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await recorderPanel(page).getByRole("button", { name: "Delete the recording" }).click();

    await expect(recorderPanel(page)).toHaveCount(0);
    expect(worker.sent).toHaveLength(0);
    expect(worker.uploads).toHaveLength(0);
    await expect(micButton(page)).toBeVisible();
  });

  test("Pause freezes the clock and the wave, and Resume continues the same take", async ({
    page,
  }) => {
    await openChat(page);

    await micButton(page).click();
    await expect(recorderPanel(page)).toBeVisible();
    await expect(recorderPanel(page).locator(".recorder__clock")).not.toHaveText("0:00", {
      timeout: 15_000,
    });

    await recorderPanel(page).getByRole("button", { name: "Pause recording" }).click();
    const frozen = await recorderPanel(page).locator(".recorder__clock").innerText();
    await expect(
      recorderPanel(page).getByRole("button", { name: "Resume recording" }),
    ).toBeVisible();
    await expect(recorderPanel(page).locator(".recorder__clock--paused")).toBeVisible();
    await page.waitForTimeout(900);
    await expect(recorderPanel(page).locator(".recorder__clock")).toHaveText(frozen);

    await recorderPanel(page).getByRole("button", { name: "Resume recording" }).click();
    await expect(
      recorderPanel(page).getByRole("button", { name: "Pause recording" }),
    ).toBeVisible();
    await recorderPanel(page).getByRole("button", { name: "Send the voice note" }).click();

    await expect.poll(() => worker.sent.length).toBe(1);
    // The paused stretch is not counted: seconds are what was spoken.
    expect(
      Number(((worker.sent[0]?.body.meta ?? {}) as Record<string, unknown>).seconds),
    ).toBeLessThan(20);
  });

  test("view once can be armed in the panel, and the post carries the flag", async ({ page }) => {
    await openChat(page);

    await micButton(page).click();
    await expect(recorderPanel(page)).toBeVisible();
    await recorderPanel(page)
      .getByRole("button", { name: /Send as view once/ })
      .click();
    await expect(recorderPanel(page).locator(".recorder__once--on")).toBeVisible();
    await expect(recorderPanel(page).locator(".recorder__clock")).not.toHaveText("0:00", {
      timeout: 15_000,
    });

    await recorderPanel(page)
      .getByRole("button", { name: "Send the voice note as view once" })
      .click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const body = worker.sent[0]?.body ?? {};
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    // The Worker's viewOnceFlag reads META, so the flag has to be in both
    // places: a note stored without meta.viewOnce is not a once note at all.
    expect(body.viewOnce).toBe(true);
    expect(meta.viewOnce).toBe(true);
    expect(meta.voice).toBe(true);
  });

  test("the recorder notice tells the reader what a browser can and cannot do", async ({
    page,
  }) => {
    await openChat(page);

    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Privacy notes" }).click();
    const notes = page.locator(".chat-menu__notes");
    await expect(notes).toContainText("voice notes");
    await expect(notes).toContainText("100 MB");
    await expect(notes).toContainText("Safari");
    // And the capability line still says what is NOT here yet.
    await expect(notes).toContainText("arrive in a later slice");
  });

  test("the transcript keeps no unlabeled or hover-only voice control", async ({ page }) => {
    await openChat(page);

    // Every control in a voice bubble has an accessible name.
    for (const id of [VOICE_PEER_ID, VOICE_OWN_ID]) {
      const buttons = note(page, id).locator("button");
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const name = (
          (await button.getAttribute("aria-label")) ?? (await button.innerText())
        ).trim();
        expect(name.length, `button ${index} in ${id}`).toBeGreaterThan(2);
      }
    }

    // The mic button is reachable by keyboard and says what it does.
    await micButton(page).focus();
    await expect(micButton(page)).toBeFocused();
    await expect(micButton(page)).toHaveAttribute(
      "title",
      /Hold and release to send · click to lock the panel · drag left to cancel/,
    );
  });
});
