import type { Page, Route } from "@playwright/test";

/**
 * A mocked Worker for the Web Push settings surface (slice H).
 *
 * It serves the session routes the settings page reads on boot and the three
 * verbs of `/api/push/web`, recording every subscribe/unsubscribe body so the
 * spec can assert what the browser actually sent.
 *
 * The browser's own push stack is environment-shaped (a real PushManager
 * answers differently across headless builds), so the spec installs a
 * deterministic PushManager with `installFakePushStack` — the same discipline
 * the calls suite uses for its screen-share refusal. The wire format the
 * settings UI produces is proved here; the WIRE ITSELF (encryption, JWT,
 * cleanup, the generic-payload privacy gate) is proved end to end by contract
 * case 77.
 */

export const ME = {
  id: "u_push_me",
  username: "pusher",
  displayName: "Push Parvin",
  about: "",
  phone: "+8801712345678",
  email: null,
  googleEmail: null,
  googleLinked: false,
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

export const FAKE_ENDPOINT = "https://push.kp.test/e2e/this-browser";
export const FAKE_P256DH =
  "BP_fake_p256dh_key_material_for_the_e2e_push_stub_0000000000000000000000";
export const FAKE_AUTH = "auth_secret_16_bytes";

export type PushMockState = {
  supported: boolean;
  publicKey: string | null;
  /** Server-side rows; the spec seeds/inspects these. */
  subscriptions: Array<{ endpoint: string; createdAt: string }>;
  /** Everything POST/DELETE /api/push/web received, in order. */
  posts: Array<Record<string, unknown>>;
  deletes: Array<Record<string, unknown>>;
  /** The config GET answers the UI saw. */
  configGets: number;
};

export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("kp.token", "test-bearer-token");
    window.localStorage.setItem("kp.device", "web-push-testdevice");
  });
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function createMockPushWorker(options: { supported?: boolean } = {}): Promise<{
  install: (page: Page) => Promise<void>;
  state: PushMockState;
}> {
  const state: PushMockState = {
    supported: options.supported ?? true,
    // 87 base64url chars decode to exactly 65 bytes — the raw P-256 point
    // length urlBase64ToBytes must hand to PushManager.
    publicKey: (options.supported ?? true) ? `BP${"A".repeat(85)}` : null,
    subscriptions: [],
    posts: [],
    deletes: [],
    configGets: 0,
  };

  const install = async (page: Page) => {
    await page.route("**/api/me", (route) =>
      route.request().method() === "GET" ? json(route, { user: ME }) : json(route, { ok: true }),
    );
    await page.route("**/api/auth/devices", (route) => json(route, { items: [] }));
    await page.route("**/api/calls/active", (route) => json(route, { calls: [] }));
    await page.route("**/api/calls/history", (route) => json(route, { calls: [] }));

    await page.route("**/api/push/web", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        state.configGets += 1;
        return json(route, {
          supported: state.supported,
          publicKey: state.publicKey,
          subscriptions: state.subscriptions,
        });
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (method === "POST") {
        state.posts.push(body);
        if (!state.supported) return json(route, { message: "Not configured." }, 503);
        const endpoint = String(body.endpoint ?? "");
        state.subscriptions = state.subscriptions.filter((sub) => sub.endpoint !== endpoint);
        state.subscriptions.push({ endpoint, createdAt: new Date().toISOString() });
        return json(route, { ok: true }, 201);
      }
      if (method === "DELETE") {
        state.deletes.push(body);
        const endpoint = String(body.endpoint ?? "");
        const before = state.subscriptions.length;
        state.subscriptions = state.subscriptions.filter((sub) => sub.endpoint !== endpoint);
        if (state.subscriptions.length === before)
          return json(route, { message: "Not found." }, 404);
        return json(route, { ok: true });
      }
      return json(route, { message: "Method not allowed." }, 405);
    });
  };

  return { install, state };
}

/**
 * The deterministic push stack: `navigator.serviceWorker.ready` resolves to a
 * registration whose PushManager behaves exactly like the real interface —
 * getSubscription / subscribe / unsubscribe / toJSON — with state the page
 * keeps in a global. `mode: "deny"` makes subscribe throw NotAllowedError,
 * which is what a closed permission prompt produces.
 *
 * The Notification permission is stubbed for the same reason: the headless
 * shell reports "denied" even with the permission granted, and this suite
 * tests the SETTINGS logic, not Chromium's prompt plumbing.
 */
export async function installFakePushStack(
  page: Page,
  mode: "allow" | "deny" = "allow",
): Promise<void> {
  await page.addInitScript(
    (options: { mode: string; endpoint: string; p256dh: string; auth: string }) => {
      if (typeof window.Notification === "function") {
        Object.defineProperty(window.Notification, "permission", {
          get: () => (options.mode === "deny" ? "denied" : "granted"),
          configurable: true,
        });
        (window.Notification as unknown as { requestPermission?: unknown }).requestPermission =
          async () => (options.mode === "deny" ? "denied" : "granted");
      }

      const win = window as unknown as {
        __kpPush?: { subscribed: boolean; subscribeAttempts: number; lastServerKeyLength: number };
      };
      win.__kpPush = { subscribed: false, subscribeAttempts: 0, lastServerKeyLength: 0 };

      const makeSubscription = () => ({
        endpoint: options.endpoint,
        getKey: (name: string) =>
          name === "p256dh" ? new Uint8Array(65).fill(7) : new Uint8Array(16).fill(9),
        unsubscribe: async () => {
          win.__kpPush!.subscribed = false;
          return true;
        },
        toJSON: () => ({
          endpoint: options.endpoint,
          keys: { p256dh: options.p256dh, auth: options.auth },
        }),
      });

      const fakePushManager = {
        getSubscription: async () => (win.__kpPush!.subscribed ? makeSubscription() : null),
        subscribe: async (init: PushSubscriptionOptionsInit) => {
          win.__kpPush!.subscribeAttempts += 1;
          if (options.mode === "deny") {
            throw new DOMException("The user denied the request.", "NotAllowedError");
          }
          const key = init.applicationServerKey as BufferSource | null;
          win.__kpPush!.lastServerKeyLength = key ? ((key as ArrayBufferView).byteLength ?? 0) : 0;
          win.__kpPush!.subscribed = true;
          return makeSubscription();
        },
      };

      Object.defineProperty(navigator.serviceWorker, "ready", {
        get: () => Promise.resolve({ pushManager: fakePushManager }),
        configurable: true,
      });
    },
    { mode, endpoint: FAKE_ENDPOINT, p256dh: FAKE_P256DH, auth: FAKE_AUTH },
  );
}
