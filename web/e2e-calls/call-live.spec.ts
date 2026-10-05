import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  CALL_ID,
  CHAT_ID,
  PEER,
  createMockCallsWorker,
  signIn,
  type MockCallsWorker,
} from "./helpers";

/**
 * A real call: two browsers, one mocked Worker, actual WebRTC.
 *
 * This is the test the rest of the slice earns. Everything else in the suite can
 * pass with a call that never connects — a painted overlay, a posted offer, a
 * disabled button. Only here does an offer become an answer, ICE become DTLS,
 * and a clock start because THIS device's media came up.
 *
 * The two pages share one mock Worker, which is exactly the shape of the real
 * one: the caller's offer arrives in the callee's `/active` read, the callee's
 * answer in the caller's, and each side's candidates in the other's `/ice`
 * cursor read. No server, no TURN — Chromium's fake media devices and host
 * candidates on loopback are enough for a real peer connection.
 */

const stage = (page: Page) => page.locator(".call-stage");
const status = (page: Page) => page.locator(".call-stage__status");
const control = (page: Page, name: string | RegExp) => stage(page).getByRole("button", { name });
const clock = /^\d+:\d\d$/;

const ME_NAME = "Amar Account";

let worker: MockCallsWorker;
let caller: Page;
let callee: Page;
let callerContext: Awaited<ReturnType<Browser["newContext"]>>;
let calleeContext: Awaited<ReturnType<Browser["newContext"]>>;

test.beforeEach(async ({ browser }) => {
  worker = await createMockCallsWorker();
  // Two contexts, one mock: the caller signs in as me, the callee as the peer.
  callerContext = await browser.newContext();
  calleeContext = await browser.newContext();
  caller = await callerContext.newPage();
  callee = await calleeContext.newPage();
  await worker.install(caller, "me");
  await worker.install(callee, "peer");
  await signIn(caller);
  await signIn(callee);
});

test.afterEach(async () => {
  await callerContext?.close();
  await calleeContext?.close();
});

/** Ring the peer and wait for the ring to reach them. */
const ringPeer = async (kind: "Voice" | "Video") => {
  await caller.goto(`/chats/${CHAT_ID}`);
  await callee.goto("/calls");
  await caller
    .locator(".conversation-actions")
    .getByRole("button", { name: `${kind} call ${PEER.displayName}` })
    .click();
  await expect.poll(() => worker.starts.length).toBe(1);
  // The Worker hides a ring from the callee for its first 1.6 s, so the ring
  // arrives on the callee's next poll after that window — never instantly.
  await expect(stage(callee)).toBeVisible({ timeout: 20_000 });
  // The ring screen names the kind, the way the phone's IncomingCallScreen does.
  await expect(status(callee)).toHaveText(`Incoming ${kind === "Video" ? "video" : "voice"} call…`);
};

/** Accept on the callee and wait for BOTH sides to report a connected call. */
const connect = async () => {
  await control(callee, "Accept").click();
  await expect.poll(() => worker.answers.length).toBe(1);
  // The clock is the only honest proof of a connected call: it starts when this
  // device's own ICE and DTLS come up, never from the server's started_at.
  await expect(status(caller)).toHaveText(clock, { timeout: 30_000 });
  await expect(status(callee)).toHaveText(clock, { timeout: 30_000 });
};

test("a voice call connects both ways and runs a clock", async () => {
  await ringPeer("Voice");
  await connect();

  await expect(stage(caller)).toHaveAttribute("aria-label", `Voice call with ${PEER.displayName}`);
  await expect(stage(callee)).toHaveAttribute("aria-label", `Voice call with ${ME_NAME}`);

  // Both sides exchanged real candidates through the server, both directions.
  const fromCaller = worker.icePosts.filter((post) => post.callId === CALL_ID);
  expect(fromCaller.length).toBeGreaterThan(1);
  expect(fromCaller.some((post) => String(post.candidate.candidate).includes("candidate:"))).toBe(
    true,
  );

  // The clock is running, not stuck at the moment it appeared.
  const first = await status(caller).innerText();
  await expect
    .poll(
      async () => {
        const text = await status(caller).innerText();
        return text === first ? "same" : "advanced";
      },
      { timeout: 20_000 },
    )
    .toBe("advanced");

  // In-call controls are live now, and the labels are the phone's.
  await expect(control(caller, /^Mute$/)).toBeEnabled();
  await expect(control(caller, "End call")).toBeEnabled();
  await expect(control(caller, "Cancel")).toHaveCount(0);
});

test("the remote audio reaches exactly one element on each side", async () => {
  await ringPeer("Voice");
  await connect();

  for (const page of [caller, callee]) {
    const bound = await page.evaluate(() => {
      const elements = [...document.querySelectorAll("audio, video")];
      return elements
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          hasStream: Boolean((element as HTMLMediaElement).srcObject),
          muted: (element as HTMLMediaElement).muted,
        }))
        .filter((entry) => entry.hasStream);
    });
    // One element carries the sound; every video surface is muted, because two
    // elements bound to one stream would double the audio.
    expect(bound).toHaveLength(1);
    expect(bound[0]?.tag).toBe("audio");
    expect(bound[0]?.muted).toBe(false);
  }
});

test("mute is a track state, not a renegotiation", async () => {
  await ringPeer("Voice");
  await connect();

  const reoffersBefore = worker.reoffers.length;
  await control(caller, /^Mute$/).click();
  await expect(control(caller, /^Unmute$/)).toBeVisible();
  await expect(control(caller, /^Mute$/)).toHaveCount(0);

  await control(caller, /^Unmute$/).click();
  await expect(control(caller, /^Mute$/)).toBeVisible();
  // Muting is `track.enabled`; nothing was renegotiated to do it.
  expect(worker.reoffers).toHaveLength(reoffersBefore);
});

test("a camera switched on mid-call converts the row to VIDEO", async () => {
  await ringPeer("Voice");
  await connect();

  await expect(stage(caller)).not.toHaveClass(/call-stage--video/);
  await control(caller, "Video").click();

  // The server converts the row, so BOTH sides and the call log agree.
  await expect.poll(() => worker.mediaPosts.some((post) => post.camera === true)).toBe(true);
  await expect.poll(() => worker.calls.get(CALL_ID)?.kind).toBe("VIDEO");

  await expect(stage(caller)).toHaveClass(/call-stage--video/);
  // The callee learns it from the row, not from a guess: their media flags say
  // the camera is on, so the peer's video surface is expected.
  await expect.poll(() => worker.mediaPosts.filter((post) => post.camera === true).length).toBe(1);
  // A mid-call camera needs no renegotiation: the video m-line was pre-added.
  expect(worker.reoffers).toHaveLength(0);
});

test("the safety code is the same string on both ends", async () => {
  await ringPeer("Voice");
  await connect();

  const line = caller.locator(".call-stage__e2ee");
  await expect(line).toContainText("End-to-end encrypted");

  // Plain until tapped, exactly like the phone; the code then replaces the line.
  await line.click();
  await expect(line).toContainText(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  const callerCode = (await line.innerText()).trim();

  const calleeLine = callee.locator(".call-stage__e2ee");
  await expect(calleeLine).toContainText("End-to-end encrypted");
  await calleeLine.click();
  const calleeCode = (await calleeLine.innerText()).trim();

  // Order-independent by construction: the caller and the callee hash the sorted
  // pair of fingerprints, so they must read the same code aloud.
  expect(calleeCode).toBe(callerCode);
});

test("the verify sheet opens, and Escape closes the sheet rather than the call", async () => {
  await ringPeer("Voice");
  await connect();

  const line = caller.locator(".call-stage__e2ee");
  await line.click();
  await line.click();
  const sheet = caller.getByRole("dialog", { name: "End-to-end encrypted" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Read this code aloud with");
  await expect(sheet.locator(".call-sheet__code")).toContainText(
    /^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/,
  );

  await caller.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // The call survived the sheet: the clock is still running.
  await expect(status(caller)).toHaveText(clock);
  await expect(control(caller, "End call")).toBeEnabled();
});

test("hanging up ends the row and closes both overlays", async () => {
  await ringPeer("Voice");
  await connect();

  await control(callee, "End call").click();
  await expect.poll(() => worker.ends).toEqual([CALL_ID]);
  await expect(stage(callee)).toHaveCount(0);

  // The caller learns from the row on its next poll, not from a guess.
  await expect(stage(caller)).toHaveCount(0, { timeout: 20_000 });
  expect(worker.calls.get(CALL_ID)?.status).toBe("ENDED");

  // And the finished call is in the history at once, with its duration.
  await caller.goto("/calls");
  await expect(caller.locator(".call-row").first()).toContainText("Voice call ·");
});

test("a screen share that cannot be granted is reported and changes nothing", async () => {
  await ringPeer("Voice");
  await connect();

  // Headless Chromium has no picker to grant, so `getDisplayMedia` refuses. What
  // matters is that the refusal is SPOKEN and the call carries on: a voice call
  // stays a voice call, and no media flag is posted for a share that never
  // started.
  await expect(control(caller, "Share screen")).toBeEnabled();
  await control(caller, "Share screen").click();

  await expect(stage(caller).locator(".call-stage__notice, .call-stage__error")).toContainText(
    /screen/i,
  );
  expect(worker.mediaPosts.some((post) => post.screen === true)).toBe(false);
  expect(worker.calls.get(CALL_ID)?.kind).toBe("AUDIO");
  await expect(status(caller)).toHaveText(clock);
});
