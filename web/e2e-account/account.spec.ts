import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type Profile = {
  id: string;
  username: string;
  displayName: string;
  about: string;
  phone: string;
  email: string | null;
  googleEmail: string | null;
  googleLinked: boolean;
  privacy: {
    phone: "nobody" | "contacts" | "public";
    avatar: "nobody" | "contacts" | "public";
    messages: "nobody" | "contacts" | "public";
    lastSeen: "nobody" | "contacts" | "public";
    groups: "nobody" | "contacts" | "public";
    status: "nobody" | "contacts" | "public";
    readReceipts: boolean;
    privateProfile: boolean;
  };
};

type RequestLog = {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

type MockResult = { status?: number; body: unknown };
type MockHandler = (request: RequestLog) => MockResult | Promise<MockResult>;

const baseProfile: Profile = {
  id: "user-web-1",
  username: "amina_user",
  displayName: "Amina Test",
  about: "",
  phone: "+8801712345678",
  email: null,
  googleEmail: "amina@example.test",
  googleLinked: true,
  privacy: {
    phone: "contacts",
    avatar: "public",
    messages: "public",
    lastSeen: "public",
    groups: "public",
    status: "public",
    readReceipts: true,
    privateProfile: false,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return { status, body };
}

async function installGoogleMock(page: Page) {
  await page.addInitScript(() => {
    type Credential = { credential?: string };
    type CredentialCallback = (value: Credential) => void;
    const fakeWindow = window as unknown as {
      google?: {
        accounts: {
          id: {
            initialize: (options: { callback: CredentialCallback }) => void;
            renderButton: (parent: HTMLElement) => void;
          };
        };
      };
      __kpFakeGoogleCallback?: CredentialCallback;
    };
    fakeWindow.google = {
      accounts: {
        id: {
          initialize: ({ callback }) => {
            fakeWindow.__kpFakeGoogleCallback = callback;
          },
          renderButton: (parent) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Continue with Google";
            button.addEventListener("click", () => {
              fakeWindow.__kpFakeGoogleCallback?.({ credential: "mock-google-id-token" });
            });
            parent.replaceChildren(button);
          },
        },
      },
    };
  });
}

async function mockWorker(
  page: Page,
  handlers: Record<string, MockHandler> = {},
  options: { sessionUser?: Profile; devices?: unknown[] } = {},
) {
  let profile = structuredClone(options.sessionUser ?? baseProfile);
  const calls: RequestLog[] = [];
  const devices = options.devices ?? [
    {
      deviceId: "web-current-install",
      platform: "WEB",
      name: "Web browser",
      active: true,
      current: true,
      appVersion: null,
      firstSeenAt: "2026-09-01T10:00:00.000Z",
      signedInAt: "2026-09-01T10:00:00.000Z",
      lastSeenAt: "2026-10-02T08:00:00.000Z",
      revokedAt: null,
      place: "Dhaka, Bangladesh",
    },
  ];

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: Record<string, unknown> | null = null;
    try {
      body = request.postDataJSON() as Record<string, unknown> | null;
    } catch {
      body = null;
    }
    const log: RequestLog = {
      path: url.pathname,
      method: request.method(),
      headers: await request.allHeaders(),
      body,
    };
    calls.push(log);

    let result: MockResult;
    const custom = handlers[url.pathname];
    if (custom) {
      result = await custom(log);
    } else if (url.pathname === "/api/config/firebase") {
      result = jsonResponse({ googleWebClientId: "mock-google-web-client" });
    } else if (url.pathname === "/api/me" && request.method() === "GET") {
      result = jsonResponse({ user: profile });
    } else if (url.pathname === "/api/me" && request.method() === "PATCH") {
      const changes = body ?? {};
      profile = { ...profile, ...changes } as Profile;
      const privacyFields: Record<string, keyof Profile["privacy"]> = {
        privPhone: "phone",
        privAvatar: "avatar",
        privMessages: "messages",
        privLastSeen: "lastSeen",
        privGroups: "groups",
        privStatus: "status",
        readReceipts: "readReceipts",
        privateProfile: "privateProfile",
      };
      const nextPrivacy = { ...profile.privacy };
      for (const [field, privacyKey] of Object.entries(privacyFields)) {
        if (field in changes) {
          (nextPrivacy as Record<string, unknown>)[privacyKey] = changes[field];
          delete (profile as unknown as Record<string, unknown>)[field];
        }
      }
      profile = { ...profile, privacy: nextPrivacy };
      result = jsonResponse({ user: profile });
    } else if (url.pathname === "/api/users/username-available") {
      result = jsonResponse({ available: true, reason: "free" });
    } else if (url.pathname === "/api/auth/devices") {
      result = jsonResponse({ items: devices });
    } else if (url.pathname === "/api/auth/logout" || url.pathname === "/api/auth/refresh") {
      result = jsonResponse({ ok: true, expiresAt: "2026-12-31T00:00:00.000Z", extended: false });
    } else {
      result = jsonResponse({ error: { code: "NOT_MOCKED" } }, 404);
    }

    await route.fulfill({
      status: result.status ?? 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(result.body),
    });
  });

  return {
    calls,
    getProfile: () => profile,
  };
}

async function enterPhone(page: Page, phone = "01712345678") {
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test.describe("opt-in Worker-backed account flows", () => {
  test("new signup binds Google, edits the live profile, privacy and device settings", async ({
    page,
  }) => {
    const { calls, getProfile } = await mockWorker(page, {
      "/api/auth/verify-phone": (request) =>
        jsonResponse(
          {
            status: "ACCOUNT_CREATED",
            phone: request.body?.phone,
            method: "DEVICE_ONLY",
          },
          201,
        ),
      "/api/auth/google/bind": (request) =>
        jsonResponse({
          status: "SESSION",
          token: "signup-session-token",
          user: { ...baseProfile, displayName: String(request.body?.displayName || "Amina Test") },
        }),
    });
    await installGoogleMock(page);
    await page.goto("/account");

    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    await enterPhone(page);
    await expect(page.getByText(/This browser cannot verify a SIM/)).toBeVisible();
    await page.getByLabel("Display name (optional)").fill("Amina Test");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Amina Test" })).toBeVisible();
    await expect(page.getByText("Dhaka, Bangladesh")).toBeVisible();
    await expect(page.getByText("This browser", { exact: true })).toBeVisible();

    await page.getByLabel("Display name", { exact: true }).fill("Amina Updated");
    await page.getByLabel("Username", { exact: true }).fill("amina_updated");
    await expect(page.getByText("Username is available.")).toBeVisible();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Amina Updated" })).toBeVisible();

    await page.getByLabel("Phone number visibility").selectOption("nobody");
    await expect.poll(() => getProfile().privacy.phone).toBe("nobody");

    const verifyCall = calls.find((call) => call.path === "/api/auth/verify-phone");
    expect(verifyCall?.body).toMatchObject({
      phone: "+8801712345678",
      sim: "UNAVAILABLE",
      deviceName: "Web browser",
      platform: "WEB",
    });
    expect(String(verifyCall?.body?.deviceId)).toMatch(/^web-/);
    const bindCall = calls.find((call) => call.path === "/api/auth/google/bind");
    expect(bindCall?.body).toMatchObject({
      phone: "+8801712345678",
      idToken: "mock-google-id-token",
      displayName: "Amina Test",
      platform: "WEB",
    });
    expect(String(bindCall?.body?.deviceId)).toMatch(/^web-/);
    expect(
      calls.some(
        (call) =>
          call.path === "/api/auth/devices" &&
          call.headers.authorization === "Bearer signup-session-token",
      ),
    ).toBeTruthy();
    expect(
      calls.some(
        (call) =>
          call.path === "/api/me" &&
          call.method === "PATCH" &&
          call.body?.displayName === "Amina Updated",
      ),
    ).toBeTruthy();
    expect(
      calls.some(
        (call) =>
          call.path === "/api/me" && call.method === "PATCH" && call.body?.privPhone === "nobody",
      ),
    ).toBeTruthy();
    expect(calls.every((call) => !/[?&](?:token|idToken)=/i.test(call.path))).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBe(
      "signup-session-token",
    );
  });

  test("protected deep link waits for a different-device approval and then stays data-gated", async ({
    page,
  }) => {
    let pollCount = 0;
    const { calls } = await mockWorker(page, {
      "/api/auth/verify-phone": (request) =>
        jsonResponse({
          status: "APPROVAL_REQUIRED",
          requestId: "login-approval-1",
          phone: request.body?.phone,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          otpAvailable: false,
          deviceGone: false,
        }),
      "/api/auth/login/poll": () => {
        pollCount++;
        return pollCount < 2
          ? jsonResponse({ status: "PENDING" })
          : jsonResponse({ status: "SESSION", token: "approved-session", user: baseProfile });
      },
    });
    await page.goto("/chats/thread-private-42");
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    await enterPhone(page);
    await expect(
      page.getByText(/Waiting for approval from a signed-in KuchuPuchu device/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conversation route recognized." })).toBeVisible(
      { timeout: 12_000 },
    );
    await expect(page.getByText(/this rollout does not fetch chats or messages/i)).toBeVisible();
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(
      calls
        .filter((call) => call.path === "/api/auth/login/poll")
        .every((call) => call.body?.deviceId && call.body?.requestId === "login-approval-1"),
    ).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBe("approved-session");
  });

  test("in-app OTP handles a bad code, preserves approval polling, and signs in on a valid code", async ({
    page,
  }) => {
    let otpCount = 0;
    await mockWorker(page, {
      "/api/auth/verify-phone": () =>
        jsonResponse({
          status: "APPROVAL_REQUIRED",
          requestId: "login-otp-1",
          phone: baseProfile.phone,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          otpAvailable: true,
          deviceGone: false,
        }),
      "/api/auth/login/poll": () => jsonResponse({ status: "PENDING" }),
      "/api/auth/login/otp": () => {
        otpCount++;
        return otpCount === 1
          ? jsonResponse({ status: "INVALID_CODE", attemptsRemaining: 4 })
          : jsonResponse({ status: "SESSION", token: "otp-session", user: baseProfile });
      },
    });
    await page.goto("/account");
    await enterPhone(page);
    await page.getByLabel("Six-digit code").fill("111111");
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "4 attempts remaining" })).toBeVisible();
    await page.getByLabel("Six-digit code").fill("222222");
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
    expect(otpCount).toBe(2);
  });

  test("Google recovery runs lookup, linked-identity start, and one-time completion", async ({
    page,
  }) => {
    const { calls } = await mockWorker(page, {
      "/api/auth/recovery/lookup": () => jsonResponse({ exists: true }),
      "/api/auth/recovery/start": (request) => {
        expect(request.body).toMatchObject({
          phone: baseProfile.phone,
          idToken: "mock-google-id-token",
          platform: "WEB",
        });
        return jsonResponse({
          requestId: "recovery-req-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      },
      "/api/auth/recovery/complete": (request) => {
        expect(request.body).toMatchObject({ requestId: "recovery-req-1" });
        return jsonResponse({ token: "recovered-session", user: baseProfile });
      },
    });
    await installGoogleMock(page);
    await page.goto("/account");
    await page.getByRole("button", { name: "Recover account with Google" }).click();
    await page.getByLabel("Phone number").fill("01712345678");
    await page.getByRole("button", { name: "Continue to recovery" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Verify with the Google account" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();

    expect(
      calls.map((call) => call.path).filter((path) => path.startsWith("/api/auth/recovery/")),
    ).toEqual([
      "/api/auth/recovery/lookup",
      "/api/auth/recovery/start",
      "/api/auth/recovery/complete",
    ]);
    expect(
      calls.find((call) => call.path === "/api/auth/recovery/complete")?.headers.authorization,
    ).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBe("recovered-session");
  });

  test("restores a persisted session, signs out remotely, then protects the account route again", async ({
    page,
  }) => {
    const { calls } = await mockWorker(page, {
      "/api/auth/verify-phone": () =>
        jsonResponse({ status: "SESSION", token: "persistent-session", user: baseProfile }),
    });
    await page.goto("/account");
    await enterPhone(page);
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
    expect(
      calls.some(
        (call) =>
          call.path === "/api/me" &&
          call.method === "GET" &&
          call.headers.authorization === "Bearer persistent-session",
      ),
    ).toBeTruthy();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByRole("heading", { name: "Chats", exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBeNull();
    const logoutCall = calls.find((call) => call.path === "/api/auth/logout");
    expect(logoutCall?.headers.authorization).toBe("Bearer persistent-session");

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    await expect(page.getByText("Amina Test", { exact: true })).toHaveCount(0);
  });

  test("cancel approval clears the waiting UI and sends the Worker cancel mutation", async ({
    page,
  }) => {
    const { calls } = await mockWorker(page, {
      "/api/auth/verify-phone": () =>
        jsonResponse({
          status: "APPROVAL_REQUIRED",
          requestId: "cancel-request-1",
          phone: baseProfile.phone,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          otpAvailable: false,
          deviceGone: false,
        }),
      "/api/auth/login/poll": () => jsonResponse({ status: "PENDING" }),
      "/api/auth/login/cancel": () => jsonResponse({ ok: true }),
    });
    await page.goto("/account");
    await enterPhone(page);
    await page.getByRole("button", { name: "Cancel sign-in request" }).click();
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "request was cancelled" }),
    ).toBeVisible();
    expect(
      calls.some(
        (call) =>
          call.path === "/api/auth/login/cancel" && call.body?.requestId === "cancel-request-1",
      ),
    ).toBeTruthy();
  });

  test("server logout failure still clears the browser token and reports the revoke uncertainty", async ({
    page,
  }) => {
    await mockWorker(page, {
      "/api/auth/verify-phone": () =>
        jsonResponse({ status: "SESSION", token: "logout-failure-session", user: baseProfile }),
      "/api/auth/logout": () =>
        jsonResponse({ error: { code: "TEMPORARY", message: "private logout failure" } }, 503),
    });
    await page.goto("/account");
    await enterPhone(page);
    await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "signed out locally" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBeNull();
    await expect(page.getByText("private logout failure")).toHaveCount(0);
  });

  test("expired persisted bearer fails closed and is cleared after a 401", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kp.token", "expired-bearer");
      localStorage.setItem("kp.device", "web-test-install");
    });
    const { calls } = await mockWorker(page, {
      "/api/me": (request) =>
        request.method === "GET"
          ? jsonResponse(
              { error: { code: "AUTH_REQUIRED", message: "private server detail" } },
              401,
            )
          : jsonResponse({ user: baseProfile }),
    });
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("kp.token"))).toBeNull();
    expect(
      calls.some(
        (call) => call.path === "/api/me" && call.headers.authorization === "Bearer expired-bearer",
      ),
    ).toBeTruthy();
    await expect(page.getByText("private server detail")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Account & settings" })).toHaveCount(0);
  });

  test("server-side Google configuration errors and auth transport errors are recoverable", async ({
    page,
  }) => {
    await installGoogleMock(page);
    await mockWorker(page, {
      "/api/auth/verify-phone": () =>
        jsonResponse({ error: { code: "TEMPORARY", message: "private upstream error" } }, 503),
      "/api/config/firebase": () => jsonResponse({ googleWebClientId: null }),
    });
    await page.goto("/account");
    await enterPhone(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await expect(page.getByText("private upstream error")).toHaveCount(0);

    // A second attempt with a successful Worker response reaches the explicit
    // not-configured state rather than rendering a broken or fake Google button.
    await page.unroute("**/api/**");
    await mockWorker(page, {
      "/api/auth/verify-phone": (request) =>
        jsonResponse(
          { status: "ACCOUNT_CREATED", phone: request.body?.phone, method: "DEVICE_ONLY" },
          201,
        ),
      "/api/config/firebase": () => jsonResponse({ googleWebClientId: null }),
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/Google sign-in is not configured for this service/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });
});

test("account sign-in and profile settings are accessible on desktop and mobile", async ({
  page,
}) => {
  await mockWorker(page, {
    "/api/auth/verify-phone": () =>
      jsonResponse({ status: "SESSION", token: "axe-session", user: baseProfile }),
  });
  await page.goto("/account");
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  await enterPhone(page);
  await expect(page.getByRole("heading", { name: "Account & settings" })).toBeVisible();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});
