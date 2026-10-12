/** The Web must not fork a phone's identity or ship a plaintext fallback. */

import { expect, test } from "@playwright/test";
import { CHAT_ID, createMockWorker, signIn, type MockWorker } from "./helpers";

let worker: MockWorker;

async function mountMessaging(
  page: Parameters<typeof signIn>[0],
  options: {
    noE2eeBackup?: boolean;
    omitPeerKeyFromList?: boolean;
  } = {},
) {
  worker = await createMockWorker(options);
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Rahi/ })).toBeVisible();
}

test.describe("secure identity gate", () => {
  test.beforeEach(async ({ page }) => {
    await mountMessaging(page, { noE2eeBackup: true });
  });

  test("without the phone key, old sealed messages stay locked and Send explains the gate", async ({
    page,
  }) => {
    await page.getByRole("link", { name: /^Rahi/ }).click();
    await expect(
      page.getByText("Secure chat keys are not on this browser", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Open in the app", { exact: true }).first()).toBeVisible();

    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("keep this until I unlock the phone key");
    const send = page.getByRole("button", { name: "Unlock secure chat to send" });
    await expect(send).toBeDisabled();

    await composer.press("Enter");
    await expect(composer).toHaveValue("keep this until I unlock the phone key");
    await expect(page.getByText(/Waiting for secure chat/)).toBeVisible();
    expect(worker.sent).toHaveLength(0);
    expect(page.url()).toContain(`/chats/${CHAT_ID}`);
  });
});

test.describe("permanent send refusal", () => {
  test.beforeEach(async ({ page }) => {
    await mountMessaging(page);
  });

  test("a refused send restores the plaintext draft without sending a fallback", async ({
    page,
  }) => {
    let postedBody = "";
    await page.route(`**/api/conversations/${CHAT_ID}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      postedBody = String(payload.body ?? "");
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "BLOCKED", message: "Send refused" } }),
      });
    });

    await page.getByRole("link", { name: /^Rahi/ }).click();
    const composer = page.getByLabel("Message text", { exact: true });
    const plaintext = "keep this draft after the server refuses it";
    await composer.fill(plaintext);
    await page.getByRole("button", { name: /Send message, or hold to schedule/ }).click();

    await expect(page.locator(".bubble__error")).toContainText("BLOCKED");
    await expect(composer).toHaveValue(plaintext);
    expect(postedBody.startsWith("KP1.")).toBe(true);
    expect(postedBody).not.toContain(plaintext);
    expect(worker.sent).toHaveLength(0);
  });

  test("a late refusal saves that chat's draft without replacing the selected chat's composer", async ({
    page,
  }) => {
    let postedBody = "";
    let releaseRefusal = () => {};
    const holdRefusal = new Promise<void>((resolve) => {
      releaseRefusal = resolve;
    });
    await page.route(`**/api/conversations/${CHAT_ID}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      postedBody = String(payload.body ?? "");
      await holdRefusal;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "BLOCKED", message: "Send refused" } }),
      });
    });

    const refusedResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/conversations/${CHAT_ID}/messages`) &&
        response.request().method() === "POST" &&
        response.status() === 403,
    );
    const plaintext = "restore this only to its original conversation";
    await page.getByRole("link", { name: /^Rahi/ }).click();
    const directComposer = page.getByLabel("Message text", { exact: true });
    await directComposer.fill(plaintext);
    await page.getByRole("button", { name: /Send message, or hold to schedule/ }).click();
    await expect.poll(() => postedBody).not.toBe("");

    await page.getByRole("link", { name: /^Squad/ }).click();
    const groupComposer = page.getByLabel("Message text", { exact: true });
    const otherDraft = "keep this other chat draft untouched";
    await groupComposer.fill(otherDraft);
    releaseRefusal();
    await refusedResponse;
    await expect(groupComposer).toHaveValue(otherDraft);

    await page.getByRole("link", { name: /^Rahi/ }).click();
    await expect(page.getByLabel("Message text", { exact: true })).toHaveValue(plaintext);
    expect(postedBody.startsWith("KP1.")).toBe(true);
    expect(postedBody).not.toContain(plaintext);
    expect(worker.sent).toHaveLength(0);
  });
});

test.describe("compact conversation rows", () => {
  test.beforeEach(async ({ page }) => {
    await mountMessaging(page, { omitPeerKeyFromList: true });
  });

  test("fetches the peer key from conversation details before sending", async ({ page }) => {
    await page.getByRole("link", { name: /^Rahi/ }).click();
    const composer = page.getByLabel("Message text", { exact: true });
    await composer.fill("secure send after detail-key lookup");
    const send = page.getByRole("button", { name: /Send message, or hold to schedule/ });

    await expect(send).toBeEnabled();
    await send.click();

    await expect.poll(() => worker.sent.length).toBe(1);
    const outgoing = String(worker.sent[0]?.body.body ?? "");
    expect(outgoing.startsWith("KP1.")).toBe(true);
    expect(outgoing).not.toContain("secure send after detail-key lookup");
    await expect(
      page.getByText("secure send after detail-key lookup", { exact: true }),
    ).toBeVisible();
  });
});
