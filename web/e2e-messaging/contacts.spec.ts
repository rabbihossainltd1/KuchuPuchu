/**
 * Slice X — the web's All contacts / New contact screens, mirroring the
 * phone's ContactsScreens: the ⋮ menu entries, the "On KuchuPuchu" list with
 * its Chat action (hidden people stay concealed), the phone's number rules
 * (E.164 preview, error copy), the match card and the WhatsApp invite.
 */

import { expect, test } from "@playwright/test";
import { PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

const MATCH_ID = "u_match";
const MATCH_NAME = "Nabila";

let worker: MockWorker;

const openContacts = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "All contacts" }).click();
};

const openNewContact = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "New contact" }).click();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({
    matchUsers: [
      {
        id: MATCH_ID,
        displayName: MATCH_NAME,
        username: "nabila",
        avatarUrl: null,
        avatarRef: null,
      },
    ],
  });
  await signIn(page);
  await worker.install(page);
  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});
  await page.goto("/chats");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
});

test("the home menu offers New contact, All contacts and New group", async ({ page }) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("menuitem", { name: "New contact" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "All contacts" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "New group" })).toBeVisible();
});

test("All contacts lists the KuchuPuchu people with a Chat action, hidden ones concealed", async ({
  page,
}) => {
  await openContacts(page);
  await expect(page.getByRole("heading", { level: 1, name: "All contacts" })).toBeVisible();
  await expect(page.getByText("On KuchuPuchu", { exact: true })).toBeVisible();
  await expect(page.getByText("Hidden Person")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Chat with ${PEER_NAME}` })).toBeVisible();

  // Chat opens the 1:1 conversation.
  await page.getByRole("button", { name: `Chat with ${PEER_NAME}` }).click();
  await expect(page).toHaveURL(/\/chats\/c_direct/);
  await expect(page.getByText(PEER_NAME).first()).toBeVisible();
});

test("the All contacts filter matches by name and reports misses verbatim", async ({ page }) => {
  await openContacts(page);
  await page.getByLabel("Search contacts").fill("zzzz");
  await expect(page.getByText('No contact matches "zzzz"')).toBeVisible();
  await page.getByLabel("Search contacts").fill("rah");
  await expect(page.getByRole("button", { name: `Chat with ${PEER_NAME}` })).toBeVisible();
});

test("New contact validates the number and shows the phone's E.164 preview", async ({ page }) => {
  await openNewContact(page);
  await expect(page.getByRole("heading", { level: 1, name: "New contact" })).toBeVisible();

  await page.getByPlaceholder("Phone").fill("01712");
  await expect(page.getByRole("button", { name: "Check" })).toBeDisabled();

  await page.getByPlaceholder("Phone").fill("01712345678");
  await expect(page.getByText("+8801712345678")).toBeVisible();
});

test("New contact reveals a KuchuPuchu match and Chat opens the conversation", async ({ page }) => {
  await openNewContact(page);
  await page.getByPlaceholder("Name").fill("Nabila");
  await page.getByPlaceholder("Phone").fill("01799887766");
  await page.getByRole("button", { name: "Check" }).click();

  await expect(page.getByText(MATCH_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText("@nabila · on KuchuPuchu")).toBeVisible();
  // The match lookup rides the phone's route with an E.164 number only.
  expect(worker.matchCalls[0]?.phones).toEqual(["+8801799887766"]);

  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/chats\/c_dir/);
  expect(worker.createdConversations).toContain(MATCH_ID);
});

test("New contact offers the WhatsApp invite when the number is not on KuchuPuchu", async ({
  page,
}) => {
  worker.matchUsers = [];
  await openNewContact(page);
  await page.getByPlaceholder("Phone").fill("+8801712345678");
  await page.getByRole("button", { name: "Check" }).click();

  await expect(page.getByText("+8801712345678 · not on KuchuPuchu yet")).toBeVisible();
  const invite = page.getByRole("link", { name: "Invite" });
  await expect(invite).toBeVisible();
  expect(await invite.getAttribute("href")).toContain("https://wa.me/8801712345678?text=");
});

test("the contacts screens have no axe violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await openContacts(page);
  let scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole("button", { name: "Back" }).click();
  await openNewContact(page);
  await page.getByPlaceholder("Phone").fill("01712345678");
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
