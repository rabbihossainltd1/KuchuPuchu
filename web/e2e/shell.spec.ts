import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Web foundation preview", () => {
  test("clearly labels the shell as a preview without implying account parity", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main sections" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chats" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Foundation preview")).toBeVisible();
    await expect(
      page.getByText("Account sign-in remains behind a default-off rollout flag;"),
    ).toBeVisible();
    await expect(page.getByText("Preview only")).toBeVisible();
  });

  test("section navigation and browser history follow deep links", async ({ page }) => {
    await page.goto("/chats/thread-42");
    await expect(
      page.getByRole("heading", { level: 3, name: "Conversation route recognized." }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Calls" }).click();
    await expect(page).toHaveURL(/\/calls$/);
    await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/chats\/thread-42$/);
    await expect(
      page.getByRole("heading", { level: 3, name: "Conversation route recognized." }),
    ).toBeVisible();
  });

  test("account route is explicit while its rollout flag stays off", async ({ page }) => {
    let apiCalls = 0;
    await page.route("**/api/**", async (route) => {
      apiCalls++;
      await route.fulfill({ status: 500, body: "unexpected account request" });
    });
    await page.goto("/account");

    await expect(
      page.getByRole("heading", { name: "Account tools are off in this build" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page makes no account API calls while the flag is off."),
    ).toBeVisible();
    expect(apiCalls).toBe(0);
    await page.getByRole("button", { name: "Back to Chats preview" }).click();
    await expect(page).toHaveURL(/\/chats$/);
  });

  test("unknown paths are explicit and provide a route back", async ({ page }) => {
    await page.goto("/not-a-feature");

    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(
      page.getByText("This address does not match a page in the Web preview."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Return to Chats" }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
  });

  test("mobile conversation route exposes a back link and mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chats/thread-mobile");

    await expect(page.getByRole("navigation", { name: "Mobile sections" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Chats" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Chats" }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
  });

  test("primary navigation is reachable and operable by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Chats" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Status" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/statuses$/);
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
  });

  test("browser connectivity changes are announced", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    await expect(page.getByText("Browser offline")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Preview only")).toBeVisible();
  });
});

test("desktop and mobile previews have no axe WCAG 2.1/2.2 A/AA violations", async ({ page }) => {
  const routes = ["/", "/chats/thread-42", "/calls", "/account", "/not-a-feature"];
  for (const path of routes) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const violations = results.violations.map(
      (violation) => `${violation.id} (${violation.impact}): ${violation.help}`,
    );
    expect(violations, `${path} accessibility violations:\n${violations.join("\n")}`).toEqual([]);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/thread-mobile");
  const mobileResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const mobileViolations = mobileResults.violations.map(
    (violation) => `${violation.id} (${violation.impact}): ${violation.help}`,
  );
  expect(
    mobileViolations,
    `mobile accessibility violations:\n${mobileViolations.join("\n")}`,
  ).toEqual([]);
});
