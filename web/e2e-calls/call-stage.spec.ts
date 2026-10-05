import { expect, test, type Page } from "@playwright/test";
import {
  CALL_ID,
  CHAT_ID,
  PEER,
  createMockCallsWorker,
  signIn,
  type MockCallsWorker,
} from "./helpers";

/**
 * The call overlay, end to end against a mocked Worker.
 *
 * This file covers everything a call surface can get wrong WITHOUT media flowing:
 * the ring it paints while nobody has answered, the refusals it must read out
 * rather than swallow, the controls that have to be disabled until the media is
 * up, the disclosures that stand in for what a browser cannot do, and the two
 * ways out of a ring — Decline, and the phone's "Message" quick reply, which has
 * to seal its body like any other 1:1 message.
 *
 * The connected path (real ICE, real DTLS, a running clock, a camera switched on
 * mid-call) is `call-live.spec.ts`.
 */

let worker: MockCallsWorker;

const stage = (page: Page) => page.locator(".call-stage");
const status = (page: Page) => page.locator(".call-stage__status");
const control = (page: Page, name: string | RegExp) => stage(page).getByRole("button", { name });
const pill = (page: Page) => page.locator(".call-pill");

const startVoiceCall = async (page: Page) => {
  await page.goto(`/chats/${CHAT_ID}`);
  await page
    .locator(".conversation-actions")
    .getByRole("button", { name: `Voice call ${PEER.displayName}` })
    .click();
  await expect(stage(page)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockCallsWorker();
  await worker.install(page);
  await signIn(page);
});

test.describe("an outgoing call", () => {
  test("it opens the overlay, creates the call with the offer, and rings", async ({ page }) => {
    await startVoiceCall(page);

    await expect.poll(() => worker.starts.length).toBe(1);
    expect(worker.starts[0]).toMatchObject({ userId: PEER.id, kind: "AUDIO" });

    // The peer is online in the mock, so the line is the phone's "Ringing…".
    await expect(status(page)).toHaveText("Ringing…");
    await expect(stage(page)).toHaveAttribute("aria-label", `Voice call with ${PEER.displayName}`);
    await expect(stage(page)).toHaveAttribute("aria-modal", "true");
  });

  test("the controls are disabled until the media is actually up", async ({ page }) => {
    await startVoiceCall(page);
    await expect(status(page)).toHaveText("Ringing…");

    await expect(control(page, "Mute")).toBeDisabled();
    await expect(control(page, "Video")).toBeDisabled();
    await expect(control(page, "Share screen")).toBeDisabled();
    // Hanging up is never disabled: it is the way out of a ring that will not end.
    await expect(control(page, "Cancel")).toBeEnabled();
    // The phone's placeholder stays a placeholder, and says so.
    await expect(control(page, "Add call")).toBeDisabled();
    await expect(control(page, "Add call")).toHaveAttribute(
      "title",
      "Adding calls is coming in a future update.",
    );
  });

  test("cancelling ends the row on the server and closes the overlay", async ({ page }) => {
    await startVoiceCall(page);
    await expect.poll(() => worker.starts.length).toBe(1);

    await control(page, "Cancel").click();
    await expect(stage(page)).toHaveCount(0);
    await expect.poll(() => worker.ends).toEqual([CALL_ID]);

    // The Worker's own rule for a caller hanging up on a ring: a MISSED call.
    expect(worker.calls.get(CALL_ID)?.status).toBe("MISSED");

    // And the history cache is dropped at once, so the new row does not wait for
    // the next visit past the 20 s window.
    await page.goto("/calls");
    await expect(page.locator(".call-row")).toContainText("Missed voice call");
  });

  test("minimising keeps the call and says how to get back", async ({ page }) => {
    await startVoiceCall(page);
    await expect.poll(() => worker.starts.length).toBe(1);

    await control(page, "Minimise call").click();
    await expect(stage(page)).toHaveCount(0);
    await expect(pill(page)).toBeVisible();
    await expect(pill(page)).toHaveAttribute("aria-label", `Return to call — ${PEER.displayName}`);
    // The call was not ended by hiding it.
    expect(worker.ends).toHaveLength(0);

    await pill(page).click();
    await expect(stage(page)).toBeVisible();
    await expect(status(page)).toHaveText("Ringing…");
  });

  test("the overlay states what a browser call cannot do", async ({ page }) => {
    await startVoiceCall(page);

    await stage(page).locator(".call-stage__limits summary").click();
    const limits = stage(page).locator(".call-stage__limits");
    await expect(limits).toContainText("What a browser call cannot do");
    await expect(limits).toContainText("no system call UI");
    await expect(limits).toContainText("no foreground service");
    await expect(limits).toContainText("only while this tab is open");
    await expect(limits).toContainText("no earpiece");
    await expect(limits).toContainText("cannot block a screenshot");
    await expect(limits).toContainText("Adding calls is coming in a future update.");
  });

  test("audio output is either a real picker or an honest line, never a dead control", async ({
    page,
  }) => {
    await startVoiceCall(page);

    const picker = stage(page).getByRole("listbox", { name: "Audio output" });
    const honest = stage(page).getByText("no device picker for call audio");
    const hasPicker = (await picker.count()) > 0;
    expect(hasPicker || (await honest.count()) > 0).toBe(true);
    if (hasPicker) {
      // Every option is a labelled, selectable row — no icon-only device list.
      await expect(picker.getByRole("option").first()).toBeVisible();
    }
  });

  test("no encryption is claimed before the call connects", async ({ page }) => {
    await startVoiceCall(page);
    await expect(status(page)).toHaveText("Ringing…");

    await expect(stage(page).locator(".call-stage__e2ee")).toHaveCount(0);
  });
});

test.describe("refusals", () => {
  test("a busy callee is read out on the calling surface, then clears", async ({ page }) => {
    worker.options.lineBusy = true;
    await startVoiceCall(page);

    // 486 is not a generic failure: the phone paints its own line for one beat.
    await expect(stage(page).locator(".call-stage__error")).toContainText(
      "Line busy — on another call right now.",
    );
    await expect.poll(() => worker.starts.length).toBe(1);
    // Nothing was left ringing on the server, and the microphone was released.
    expect(worker.calls.size).toBe(0);

    await expect(stage(page)).toHaveCount(0, { timeout: 6_000 });
  });

  test("a blocked peer is named as a block", async ({ page }) => {
    worker.options.blocked = true;
    await startVoiceCall(page);

    await expect(stage(page).locator(".call-stage__error")).toContainText(
      "They blocked you, so this call cannot go through.",
    );
    await expect(stage(page)).toHaveCount(0, { timeout: 6_000 });
  });

  test("a video call asks for a camera and starts one", async ({ page }) => {
    await page.goto(`/chats/${CHAT_ID}`);
    await page
      .locator(".conversation-actions")
      .getByRole("button", { name: `Video call ${PEER.displayName}` })
      .click();

    await expect.poll(() => worker.starts.length).toBe(1);
    expect(worker.starts[0]).toMatchObject({ kind: "VIDEO" });
    await expect(stage(page)).toHaveAttribute("aria-label", `Video call with ${PEER.displayName}`);
  });
});

test.describe("an incoming call", () => {
  test.beforeEach(async ({ page }) => {
    worker = await createMockCallsWorker({ withIncomingRing: true });
    await worker.install(page);
    await signIn(page);
    await page.goto("/calls");
    await expect(stage(page)).toBeVisible();
  });

  test("the ring names the kind and offers three labelled ways out", async ({ page }) => {
    await expect(stage(page)).toHaveAttribute("aria-label", "Incoming video call…");
    await expect(status(page)).toHaveText("Incoming video call…");
    await expect(stage(page).locator("h2")).toHaveText(PEER.displayName);

    await expect(control(page, "Accept")).toBeEnabled();
    await expect(control(page, "Decline")).toBeEnabled();
    await expect(control(page, "Message")).toBeEnabled();
    // The phone's "Remind me" is AlarmManager; the browser says so instead of
    // drawing a button that cannot work.
    await expect(stage(page).locator(".call-stage__quick-note")).toContainText(
      "Reminders live on the phone",
    );
    // No in-call controls while ringing: nothing is connected yet.
    await expect(control(page, "Mute")).toHaveCount(0);
    await expect(control(page, "Minimise call")).toBeDisabled();
  });

  test("declining refuses the row and closes the overlay", async ({ page }) => {
    await control(page, "Decline").click();

    await expect.poll(() => worker.declines).toEqual([CALL_ID]);
    await expect(stage(page)).toHaveCount(0);
    expect(worker.calls.get(CALL_ID)?.status).toBe("DECLINED");

    // A declined call is not picked up again by the next poll.
    await page.waitForTimeout(2_000);
    await expect(stage(page)).toHaveCount(0);
  });

  test("Message declines and sends the canned reply, sealed, into the chat", async ({ page }) => {
    await control(page, "Message").click();

    await expect.poll(() => worker.declines).toEqual([CALL_ID]);
    // The reply opens the pair chat first, exactly like a status reply does.
    await expect.poll(() => worker.conversationPosts).toEqual([PEER.id]);
    await expect.poll(() => worker.messages.length).toBe(1);

    const body = String(worker.messages[0]?.body.body ?? "");
    // A 1:1 text body is sealed with the same KP1 scheme the phone uses; the
    // quick reply is not exempt just because the user did not type it.
    expect(body.startsWith("KP1.")).toBe(true);
    expect(body).not.toContain("Can't talk right now");

    // And the reader lands in the chat the reply went to.
    await expect(page).toHaveURL(new RegExp(`/chats/${CHAT_ID}`));
    await expect(stage(page)).toHaveCount(0);
  });

  test("accepting answers the row with an SDP", async ({ page }) => {
    await control(page, "Accept").click();

    await expect.poll(() => worker.answers.length).toBe(1);
    expect(worker.answers[0]?.callId).toBe(CALL_ID);
    expect(worker.answers[0]?.answerSdp).toContain("v=0");
    expect(worker.calls.get(CALL_ID)?.status).toBe("ACTIVE");
    // Until the media is up the honest line is "Connecting…", never a clock.
    await expect(status(page)).toHaveText("Connecting…");
  });
});
