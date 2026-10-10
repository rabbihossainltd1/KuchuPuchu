import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  BLOCKED_CHAT_ID,
  BOT_CHAT_ID,
  CALL_ID,
  CANCELLED_CALL_ID,
  CHAT_ID,
  GROUP_CALL_ID,
  GROUP_ID,
  MISSED_CALL_ID,
  MUTED_CHAT_ID,
  PEER,
  REQUEST_CHAT_ID,
  VOICE_CALL_ID,
  createMockCallsWorker,
  signIn,
  type MockCallsWorker,
} from "./helpers";

/**
 * The Calls tab and the chat header's call gate, end to end against a mocked
 * Worker.
 *
 * What this file is for: the four ways a call history can lie. A row that says
 * the wrong thing about a call that happened (a missed call that reads as a
 * normal one, a duration the server never reported, a day section cut in the
 * wrong time zone), a call-back button that starts the wrong kind of call or
 * silently does nothing on a group, a chat header that offers a call the server
 * would refuse, and a limit the phone has that the browser does not — hidden
 * behind a control instead of stated.
 *
 * Honest scope: Chromium, synthetic events, mocked Worker, no media. The live
 * media path is `call-live.spec.ts`; this file never lets a call connect.
 */

let worker: MockCallsWorker;

const tab = (page: Page) => page.locator("section.calls-tab");
const rows = (page: Page) => page.locator(".call-row");
const dayHeadings = (page: Page) => page.locator(".calls-tab__day");
const stage = (page: Page) => page.getByRole("dialog", { name: /call/i });
const chatHeader = (page: Page) => page.locator(".conversation-actions");

const openTab = async (page: Page) => {
  await page.goto("/calls");
  await expect(tab(page)).toBeVisible();
};

const openChat = async (page: Page, conversationId: string) => {
  await page.goto(`/chats/${conversationId}`);
  await expect(chatHeader(page)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockCallsWorker({ withHistory: true });
  await worker.install(page);
  await signIn(page);
});

test.describe("the history list", () => {
  test("it lists finished calls in day sections, newest first", async ({ page }) => {
    await openTab(page);

    await expect(rows(page)).toHaveCount(4);
    // The Worker returns newest first and the client only groups, never re-sorts.
    const names = await rows(page).locator(".call-row__name").allTextContents();
    expect(names).toEqual([PEER.displayName, PEER.displayName, PEER.displayName, "Class of 2026"]);

    const days = await dayHeadings(page).allTextContents();
    expect(days[0]).toBe("Today");
    expect(days[1]).toBe("Yesterday");
    // Nine days back is past the weekday window, so it reads day-and-month.
    expect(days[2]).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  test("a missed call is named and coloured as missed", async ({ page }) => {
    await openTab(page);

    const missed = page.locator(`.call-row:has(.call-row__name)`).filter({
      has: page.locator(".call-row__line", { hasText: "Missed video call" }),
    });
    await expect(missed).toHaveCount(1);
    await expect(missed).toHaveClass(/call-row--missed/);
    // The phone folds DECLINED in with MISSED; the row says so in the same words.
    await expect(missed.locator(".call-row__line")).toContainText("Missed video call");
  });

  test("a connected call carries the duration the server reported", async ({ page }) => {
    await openTab(page);

    const connected = rows(page).first();
    // Seeded 90 minutes ago, ended 83 minutes ago: seven minutes on the clock.
    await expect(connected.locator(".call-row__line")).toContainText("Voice call · 7:00");
  });

  test("a call that never connected has no duration at all", async ({ page }) => {
    await openTab(page);

    const cancelled = rows(page).filter({ hasText: "Cancelled voice call" });
    await expect(cancelled).toHaveCount(1);
    await expect(cancelled.locator(".call-row__line")).not.toContainText("·  0:00");
    expect(await cancelled.locator(".call-row__line").innerText()).not.toMatch(/\d+:\d\d/);
  });

  test("a group row says Group and keeps its own label", async ({ page }) => {
    await openTab(page);

    const group = rows(page).filter({ hasText: "Class of 2026" });
    await expect(group.locator(".call-row__line")).toContainText("Group voice call · 10:00");
  });

  test("a row opens the chat it belongs to", async ({ page }) => {
    await openTab(page);

    await rows(page)
      .first()
      .getByRole("button", { name: `Open the chat with ${PEER.displayName}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/chats/${CHAT_ID}`));
    await expect(chatHeader(page)).toBeVisible();
  });

  test("a group row opens the group chat", async ({ page }) => {
    await openTab(page);

    await rows(page)
      .filter({ hasText: "Class of 2026" })
      .getByRole("button", { name: "Open the chat with Class of 2026" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/chats/${GROUP_ID}`));
  });

  test("the call-back button names the peer and the kind, and calls", async ({ page }) => {
    await openTab(page);

    const missed = rows(page).filter({ hasText: "Missed video call" });
    const back = missed.getByRole("button", {
      name: `Call ${PEER.displayName} back on video`,
    });
    // Not an icon-only control: the kind is written on it.
    await expect(back).toContainText("Video");

    await back.click();
    await expect(stage(page)).toBeVisible();
    // The stage paints at "dialing", before the create request lands, so the
    // assertion waits for the request rather than for the paint.
    await expect.poll(() => worker.starts.length).toBe(1);
    expect(worker.starts[0]).toMatchObject({ userId: PEER.id, kind: "VIDEO" });
    // The offer travels WITH the create request, so the callee's ring carries it.
    expect(worker.starts[0]?.offerSdp).toContain("v=0");
    // Real candidates followed it, which only happens if the peer connection's
    // event plumbing is live.
    await expect.poll(() => worker.icePosts.length).toBeGreaterThan(0);
    expect(worker.icePosts[0]?.callId).toBe(CALL_ID);
  });

  test("a voice call-back starts a voice call", async ({ page }) => {
    await openTab(page);

    await rows(page)
      .first()
      .getByRole("button", { name: `Call ${PEER.displayName} back on voice` })
      .click();
    await expect.poll(() => worker.starts.length).toBe(1);
    expect(worker.starts[0]).toMatchObject({ userId: PEER.id, kind: "AUDIO" });
  });

  test("a group row refuses the call-back with the reason, and asks nothing", async ({ page }) => {
    await openTab(page);

    const group = rows(page).filter({ hasText: "Class of 2026" });
    const back = group.getByRole("button", {
      name: "Group voice call is not available on the Web",
    });
    await expect(back).toHaveAttribute(
      "title",
      "Group calls are not on the Web yet — start them from the phone.",
    );

    const before = worker.starts.length;
    await back.click();
    // The refusal is spoken, not swallowed: the tab's live region carries it.
    await expect(page.locator(".calls-tab__notice")).toContainText(
      "Group calls are not on the Web yet",
    );
    expect(worker.starts).toHaveLength(before);
    // The seeded group row is untouched, and no call row of any kind was made.
    expect(worker.calls.get(GROUP_CALL_ID)?.status).toBe("ENDED");
    expect(worker.calls.size).toBe(4);
    await expect(page.locator(".call-stage")).toHaveCount(0);
  });

  test("an empty history invites a call instead of showing a blank pane", async ({ page }) => {
    worker.calls.clear();
    await openTab(page);

    await expect(page.locator(".calls-tab__empty")).toContainText("No calls yet");
    await expect(page.locator(".calls-tab__empty")).toContainText(
      "Start a voice or video call from any chat",
    );
    await expect(rows(page)).toHaveCount(0);
  });

  test("a failed history read is reported with a way to retry", async ({ page }) => {
    worker.options.historyFails = true;
    await openTab(page);

    // The server's own line is shown; `CALL_COPY.historyError` is the fallback
    // for a failure that carries no message at all.
    await expect(page.locator(".calls-tab__error")).toContainText("temporarily unavailable");
    await expect(page.locator(".calls-tab__error")).toHaveAttribute("role", "alert");
    await expect(rows(page)).toHaveCount(0);
    const reads = worker.historyReads;

    worker.options.historyFails = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(rows(page)).toHaveCount(4);
    expect(worker.historyReads).toBeGreaterThan(reads);
  });

  test("the tab states what it cannot do, rather than implying parity", async ({ page }) => {
    await openTab(page);

    // A hidden chat's calls move to a Hidden screen on the phone; this browser
    // has no Hidden screen, and the tab says so instead of quietly listing them.
    await expect(page.locator(".calls-tab__note")).toContainText("no Hidden list yet");

    await page.locator(".calls-tab__foot details summary").click();
    const limits = page.locator(".calls-tab__foot details");
    await expect(limits).toContainText("What a browser call cannot do");
    await expect(limits).toContainText("screenshot");
    await expect(limits).toContainText("only while this tab is open");
    await expect(limits).toContainText("Group calls");
  });

  test("the history is read once and not re-read while the tab sits open", async ({ page }) => {
    await openTab(page);
    await expect(rows(page)).toHaveCount(4);
    await expect.poll(() => worker.historyReads).toBe(1);

    // The call poll may run; the history list must not be re-fetched behind it.
    await page.waitForTimeout(4_000);
    expect(worker.requests).toContain("GET /api/calls/active");
    expect(worker.historyReads).toBe(1);

    // The header's Refresh is an explicit ask, and it is honoured.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => worker.historyReads).toBe(2);
  });

  test("the tab has no axe violations", async ({ page }) => {
    await openTab(page);
    await expect(rows(page)).toHaveCount(4);

    const results = await new AxeBuilder({ page })
      .include(".calls-tab")
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the chat header's call gate", () => {
  test("a live 1:1 chat gets both buttons, labelled with the peer", async ({ page }) => {
    await openChat(page, CHAT_ID);

    const voice = chatHeader(page).getByRole("button", { name: `Voice call ${PEER.displayName}` });
    const video = chatHeader(page).getByRole("button", { name: `Video call ${PEER.displayName}` });
    await expect(voice).toBeEnabled();
    await expect(video).toBeEnabled();

    await video.click();
    await expect(stage(page)).toBeVisible();
    await expect.poll(() => worker.starts.length).toBe(1);
    expect(worker.starts[0]).toMatchObject({ userId: PEER.id, kind: "VIDEO" });
  });

  test("a group chat gets the pair drawn but disabled, with the reason", async ({ page }) => {
    await openChat(page, GROUP_ID);

    const voice = chatHeader(page).getByRole("button", {
      name: "Group voice call is not available on the Web",
    });
    const video = chatHeader(page).getByRole("button", {
      name: "Group video call is not available on the Web",
    });
    await expect(voice).toBeDisabled();
    await expect(video).toBeDisabled();
    await expect(voice).toHaveAttribute(
      "title",
      "Group calls are not on the Web yet — start them from the phone.",
    );

    const before = worker.starts.length;
    await voice.click({ force: true });
    expect(worker.starts).toHaveLength(before);
    await expect(stage(page)).toHaveCount(0);

    // And the chat's own notes say why, in the ⋮ sheet's Privacy notes view.
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Privacy notes" }).click();
    await expect(page.locator(".chat-menu__notes")).toContainText(
      "Group calls stay on the phone: the Web runs no group mesh yet.",
    );
  });

  test("a call-muted chat has no call buttons at all", async ({ page }) => {
    await openChat(page, MUTED_CHAT_ID);

    await expect(chatHeader(page).getByRole("button", { name: /Voice call/ })).toHaveCount(0);
    await expect(chatHeader(page).getByRole("button", { name: /Video call/ })).toHaveCount(0);
    // The reason is disclosed where the reader can find it.
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Privacy notes" }).click();
    await expect(page.locator(".chat-menu__notes")).toContainText("Calls are muted for this chat");
  });

  test("a bot chat offers no call", async ({ page }) => {
    await openChat(page, BOT_CHAT_ID);

    await expect(chatHeader(page).getByRole("button", { name: /call/i })).toHaveCount(0);
  });

  test("an open message request offers no call", async ({ page }) => {
    await openChat(page, REQUEST_CHAT_ID);

    await expect(chatHeader(page).getByRole("button", { name: /Voice call/ })).toHaveCount(0);
    expect(worker.starts).toHaveLength(0);
  });

  test("a blocked chat offers no call", async ({ page }) => {
    await openChat(page, BLOCKED_CHAT_ID);

    await expect(chatHeader(page).getByRole("button", { name: /Voice call/ })).toHaveCount(0);
  });

  test("no call request is made by merely opening a chat", async ({ page }) => {
    await openChat(page, CHAT_ID);
    await expect(chatHeader(page)).toBeVisible();

    expect(worker.requests.filter((entry) => entry === "POST /api/calls")).toHaveLength(0);
    // The poll for an active call is allowed; creating one is not.
    expect(worker.starts).toHaveLength(0);
  });
});
