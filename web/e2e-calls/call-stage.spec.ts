import { expect, test, type Page } from "@playwright/test";
import {
  CALLS_MOCK_AVATAR,
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

    // The picker renders as a labelled trigger with a listbox contract; the
    // listbox itself only exists once the trigger is open, so the trigger is
    // what proves the control on a closed stage.
    const picker = stage(page).getByRole("button", { name: "Audio output" });
    const honest = stage(page).getByText("no device picker for call audio");
    const hasPicker = (await picker.count()) > 0;
    const hasHonest = (await honest.count()) > 0;
    expect(hasPicker || hasHonest).toBe(true);
    // Never both at once: a browser either moves the audio itself or says so.
    expect(hasPicker && hasHonest).toBe(false);
    if (hasPicker) {
      await expect(picker).toHaveAttribute("aria-haspopup", "listbox");
    } else {
      await expect(honest.first()).toBeVisible();
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

  test("the ring resolves the peer's avatarRef token into the real picture", async ({ page }) => {
    // The active-call payload is LIGHT (avatarUrl null + `u_peer@v1`), exactly
    // like the Worker's; the stage must trade the token at the avatar
    // resolver instead of rendering it as a broken <img src>.
    const img = stage(page).locator(".call-stage__avatar img");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", CALLS_MOCK_AVATAR);
    expect(await stage(page).locator(".call-stage__avatar").innerHTML()).not.toContain("@v1");
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

/**
 * The desktop ring has to FIT the window it is drawn in.
 *
 * Owner round 36 (2026-10-19): on a 1280x1024 desktop the call screen pushed
 * its last two rows (the quick reply and the limits) below the fold, so the
 * "Message" button was half cut off, and the negative margin that centred
 * each glyph on its circle dropped the glyph onto its own label. The phone
 * stacks its call screens over whatever is open and nothing is ever cut off;
 * the browser may not be smaller than that.
 */
test.describe("the call screen fits the desktop window", () => {
  const windowSizes = [
    { width: 1280, height: 1024 },
    { width: 1366, height: 860 },
    { width: 1440, height: 900 },
  ];

  test.beforeEach(async ({ page }) => {
    // A seeded ring: the screen with the most on it (the two circles, the
    // quick reply and the limits).
    worker = await createMockCallsWorker({ withIncomingRing: true });
    await worker.install(page);
    await signIn(page);
  });

  test("the ring, its labels and the rows under it all stay on the screen", async ({ page }) => {
    for (const size of windowSizes) {
      await page.setViewportSize(size);
      await page.goto("/calls");
      await expect(stage(page)).toBeVisible();
      await page.waitForTimeout(250);

      const boxes = await page.evaluate(() => {
        const read = (selector: string) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const body = document.querySelector(".call-stage__body") as HTMLElement | null;
        const ring = document.querySelector(".call-stage__ring") as HTMLElement | null;
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollHeight: body?.scrollHeight ?? 0,
          clientHeight: body?.clientHeight ?? 0,
          ring: read(".call-stage__ring"),
          decline: read(".call-circle--decline"),
          declineGlyph: read(".call-circle--decline svg"),
          declineLabel: read(".call-circle--decline span"),
          quick: read(".call-stage__quick"),
          foot: read(".call-stage__foot"),
          declineAria:
            ring?.querySelector(".call-circle--decline")?.getAttribute("aria-label") ?? "",
          acceptAria: ring?.querySelector(".call-circle--accept")?.getAttribute("aria-label") ?? "",
        };
      });

      // The stage itself never scrolls: everything is on the screen at once.
      expect(
        boxes.scrollHeight,
        `the stage scrolls at ${size.width}x${size.height}`,
      ).toBeLessThanOrEqual(boxes.clientHeight);
      // Nothing hangs below the window.
      for (const key of ["ring", "quick", "foot"] as const) {
        const box = boxes[key];
        expect(box, `${key} is missing`).not.toBeNull();
        expect(box!.bottom, `${key} runs past the window`).toBeLessThanOrEqual(
          boxes.viewportHeight,
        );
      }
      // The phone's look: each glyph is CENTRED on its circle, and NOTHING is
      // drawn under the circle — no caption can fall onto the window edge.
      const circle = boxes.decline!;
      const glyph = boxes.declineGlyph!;
      expect(glyph.top, "the glyph starts above its circle").toBeGreaterThanOrEqual(circle.top);
      expect(glyph.bottom, "the glyph runs past its circle").toBeLessThanOrEqual(circle.bottom);
      expect(glyph.top + glyph.bottom, "the glyph's middle is not the circle's middle").toBeCloseTo(
        circle.top + circle.bottom,
        6,
      );
      expect(boxes.declineLabel, "a caption is drawn under the circle").toBeNull();
      // The two circles sit at the ring's far edges, like the phone's SpaceBetween row.
      const ring = boxes.ring!;
      expect(
        boxes.decline!.left - ring.left,
        "decline is not at the ring's left edge",
      ).toBeLessThanOrEqual(40);
      // The action is still NAMEABLE for keyboards and screen readers.
      expect(boxes.declineAria).toBe("Decline");
      expect(boxes.acceptAria).toBe("Accept");
    }
  });
});

/**
 * Multi-device rules (owner 2026-10-19): one account, two machines.
 *
 * - A call DIALLED from the phone shows the outgoing screen only on the phone.
 *   The web session of the same account polls the same row but only watches —
 *   it never pops a calling screen of its own ("app a call dile desktop a o
 *   calling screen open hoye jacche").
 * - A ring ANSWERED on the phone retires the web's ring of its own — from the
 *   user's seat nothing ended, they are just already on the call ("jekono device
 *   accept korle onno device a ar call screen dekhabe na").
 */
test.describe("multi-device rings", () => {
  test("an outgoing call made on another device draws no calling screen here", async ({ page }) => {
    worker = await createMockCallsWorker();
    // Seed an OUTGOING row the phone just created: callerId is ME, the web
    // engine knows it did not dial here, so it must stay silent.
    worker.calls.set(CALL_ID, {
      id: CALL_ID,
      kind: "AUDIO",
      status: "RINGING",
      callerId: "u_me",
      calleeId: PEER.id,
      conversationId: CHAT_ID,
      offerSdp: "v=0\r\n",
      answerSdp: "",
      startedAt: null,
      endedAt: null,
      createdAt: new Date(Date.now() - 4_000).toISOString(),
      media: {},
      ice: [],
    });
    await worker.install(page);
    await signIn(page);
    await page.goto("/calls");
    // Two poll windows: a bug would have popped the stage by now.
    await page.waitForTimeout(3_200);
    await expect(stage(page)).toHaveCount(0);
  });

  test("answering on another device retires the adopted ring quietly", async ({ page }) => {
    worker = await createMockCallsWorker({ withIncomingRing: true });
    await worker.install(page);
    await signIn(page);
    await page.goto("/calls");
    await expect(stage(page)).toBeVisible();

    // The phone answered: status flips to ACTIVE with an SDP the web never wrote.
    const row = worker.calls.get(CALL_ID)!;
    row.status = "ACTIVE";
    row.answerSdp = "v=0\r\na=msid:peer peer-video\r\n";
    row.startedAt = new Date().toISOString();

    await expect(stage(page)).toHaveCount(0, { timeout: 6_500 });
    // No second wave either: the retired row stays retired on later reads.
    await page.waitForTimeout(2_000);
    await expect(stage(page)).toHaveCount(0);
  });
});
