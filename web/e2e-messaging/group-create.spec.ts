import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { ME, PEER_ID, PEER_NAME, createMockWorker, signIn, type MockWorker } from "./helpers";

type GroupCreateBody = { title: string; memberIds: string[] };
const groupCreates: GroupCreateBody[] = [];

let worker: MockWorker;

const openChatList = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
};

const openNewGroup = async (page: Page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "New group" }).click();
  await expect(page.getByRole("dialog", { name: "New group" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  worker = await createMockWorker({});
  await signIn(page);
  await worker.install(page);

  await page.routeWebSocket(/\/ws\/chat\//, () => {});
  await page.routeWebSocket(/\/ws\/user/, () => {});

  // The directory the phone's group screen searches (GET /api/users?q=).
  await page.route(/\/api\/users(\?|$)/, (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const stranger = {
      id: "u_stranger",
      displayName: "Stranger Sosa",
      username: "sosa",
      e2eePublicKey: "SOSKEY",
      avatarRef: "",
      online: false,
      lastActiveAt: new Date().toISOString(),
      about: "",
      verified: false,
      privateProfile: false,
    };
    const users =
      q.length >= 2 &&
      (stranger.displayName.toLowerCase().includes(q) || stranger.username.includes(q))
        ? [stranger]
        : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ users }),
    });
  });

  // POST /api/conversations/group — records the payload and mints the group.
  await page.route("**/api/conversations/group", (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as GroupCreateBody;
    groupCreates.push(body);
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ conversation: { id: "c_new" } }),
    });
  });

  // The fresh group's detail row, served like the real detail route.
  await page.route("**/api/conversations/c_new", (route) => {
    const body = groupCreates[groupCreates.length - 1];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversation: {
          id: "c_new",
          isGroup: true,
          title: body?.title ?? "",
          unread: 0,
          hidden: 0,
          ownerId: ME.id,
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: { kind: "TEXT", category: "system", body: "created the group" },
          members: [
            { user: { id: ME.id, displayName: ME.displayName }, role: "owner" },
            ...(body?.memberIds ?? []).map((id) => ({
              user: { id, displayName: id === PEER_ID ? PEER_NAME : id },
              role: "member",
            })),
          ],
        },
      }),
    });
  });
});

test.describe("Web group creation", () => {
  test("the ⋮ menu opens New group, known peers lead, and Create posts the phone's payload", async ({
    page,
  }) => {
    await openChatList(page);
    await openNewGroup(page);

    // The 1:1 peers of my chat list are pre-listed, the system bot is not.
    const dialog = page.getByRole("dialog", { name: "New group" });
    await expect(dialog.getByRole("button", { name: new RegExp(PEER_NAME) })).toBeVisible();
    await expect(dialog.getByText("No contacts yet")).toHaveCount(0);

    // Create is gated on a name AND at least one member, exactly like the phone.
    const create = dialog.getByRole("button", { name: "Create" });
    await expect(create).toBeDisabled();
    await dialog.getByLabel("Group name").fill("Pineapple Squad");
    await expect(create).toBeDisabled();

    await dialog.getByRole("button", { name: new RegExp(`Add ${PEER_NAME}`) }).click();
    await expect(dialog.getByText("1 member")).toBeVisible();
    await expect(dialog.getByRole("button", { name: `Remove ${PEER_NAME}` })).toBeVisible();
    await expect(create).toBeEnabled();

    await create.click();

    // The Worker got the phone's exact body; the sheet closes and the fresh
    // group opens like nav.navigate("chat/$convId").
    await expect.poll(() => groupCreates.length).toBe(1);
    expect(groupCreates[0]).toEqual({ title: "Pineapple Squad", memberIds: [PEER_ID] });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pineapple Squad" })).toBeVisible();
  });

  test("search adds directory people and says No one found for nonsense", async ({ page }) => {
    await openChatList(page);
    await openNewGroup(page);
    const dialog = page.getByRole("dialog", { name: "New group" });

    await dialog.getByLabel("Search people to add").fill("sosa");
    await expect(dialog.getByRole("button", { name: "Add Stranger Sosa" })).toBeVisible();
    // A directory pick joins the chips like any known peer.
    await dialog.getByRole("button", { name: "Add Stranger Sosa" }).click();
    await expect(dialog.getByText("1 member")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Remove Stranger Sosa" })).toBeVisible();

    await dialog.getByLabel("Search people to add").fill("zzzqqq");
    await expect(dialog.getByText("No one found")).toBeVisible();
  });

  test("a Worker refusal is surfaced in the sheet, not swallowed", async ({ page }) => {
    await page.route("**/api/conversations/group", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: "None of those players can be added.",
              code: "NO_MEMBERS",
            }),
          })
        : route.fallback(),
    );

    await openChatList(page);
    await openNewGroup(page);
    const dialog = page.getByRole("dialog", { name: "New group" });
    await dialog.getByLabel("Group name").fill("Ghost Group");
    await dialog.getByRole("button", { name: new RegExp(`Add ${PEER_NAME}`) }).click();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();

    // The web's fixed copy for a 400 — raw Worker text never renders.
    await expect(dialog.getByRole("alert")).toHaveText(
      "The request could not be completed. Please try again.",
    );
    // The sheet stays open so the member pick can be corrected.
    await expect(dialog).toBeVisible();
  });

  test("the New group sheet has no axe violations", async ({ page }) => {
    await openChatList(page);
    await openNewGroup(page);
    const dialog = page.getByRole("dialog", { name: "New group" });
    await dialog.getByRole("button", { name: new RegExp(`Add ${PEER_NAME}`) }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
