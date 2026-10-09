/**
 * The `/api/push/web` surface (slice H). Three verbs against one route: read
 * the capability + my own subscriptions, register this browser's
 * PushManager subscription, and remove it again. Header-only auth, exactly
 * like every other REST route — the pinned Worker contract (case 48) applies.
 */

import type { ApiClient } from "../auth/authApi";

export type PushSubscriptionInfo = {
  readonly endpoint: string;
  readonly createdAt: string;
};

export type PushConfig = {
  readonly supported: boolean;
  readonly publicKey: string | null;
  readonly subscriptions: readonly PushSubscriptionInfo[];
};

export type PushRegistration = {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
};

/** RFC 8292 wants the application-server key as raw bytes, not base64url. */
export function urlBase64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export const pushApi = {
  config(api: ApiClient): Promise<PushConfig> {
    return api.request<PushConfig>("/api/push/web");
  },

  subscribe(api: ApiClient, registration: PushRegistration): Promise<{ ok: boolean }> {
    return api.request<{ ok: boolean }>("/api/push/web", {
      method: "POST",
      body: JSON.stringify({
        endpoint: registration.endpoint,
        p256dh: registration.keys.p256dh,
        auth: registration.keys.auth,
      }),
      headers: { "content-type": "application/json" },
    });
  },

  unsubscribe(api: ApiClient, endpoint: string): Promise<{ ok: boolean }> {
    return api.request<{ ok: boolean }>("/api/push/web", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
      headers: { "content-type": "application/json" },
    });
  },
};
