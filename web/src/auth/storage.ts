export const TOKEN_STORAGE_KEY = "kp.token";
export const DEVICE_ID_STORAGE_KEY = "kp.device";
export const USER_STORAGE_KEY = "kp.me";
export const E2EE_STORAGE_KEY = "kp.e2ee";
export const REFRESHED_AT_STORAGE_KEY = "kp.web.auth-refreshed-at";

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function storedBearerToken(storage: KeyValueStorage | null = browserStorage()): string {
  try {
    return storage?.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function storedWebDeviceId(storage: KeyValueStorage | null = browserStorage()): string {
  try {
    const existing = storage?.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
    return existing?.startsWith("web-") && existing.length <= 64 ? existing : "";
  } catch {
    return "";
  }
}

export function ensureWebDeviceId(
  storage: KeyValueStorage | null = browserStorage(),
  makeRandomId: () => string = () => {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "");
      }
    } catch {
      // Fall through to a non-cryptographic install identifier. It is not an auth secret.
    }
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random()
      .toString(16)
      .slice(2)}`;
  },
): string {
  try {
    const existing = storage?.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
    if (existing?.startsWith("web-") && existing.length <= 64) return existing;
  } catch {
    // A blocked storage API should not prevent an in-memory sign-in attempt.
  }

  const next = `web-${
    makeRandomId()
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 32) || Date.now()
  }`;
  try {
    storage?.setItem(DEVICE_ID_STORAGE_KEY, next);
  } catch {
    // Session can still be used for this page lifetime if storage is unavailable.
  }
  return next;
}

export function persistAuthSession(
  token: string,
  user: unknown,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(TOKEN_STORAGE_KEY, token);
    storage?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Do not fail an otherwise valid server session when browser storage is blocked.
  }
}

export function persistAuthUser(
  user: unknown,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // The server remains authoritative; this cache is only for legacy-client compatibility.
  }
}

export function clearAuthSession(storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(TOKEN_STORAGE_KEY);
    storage?.removeItem(USER_STORAGE_KEY);
    storage?.removeItem(E2EE_STORAGE_KEY);
    storage?.removeItem(REFRESHED_AT_STORAGE_KEY);
  } catch {
    // React state is also cleared, so a storage error cannot keep this page signed in.
  }
}

export function readRefreshedAt(storage: KeyValueStorage | null = browserStorage()): number {
  try {
    const value = Number(storage?.getItem(REFRESHED_AT_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeRefreshedAt(
  timestamp: number,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(REFRESHED_AT_STORAGE_KEY, String(timestamp));
  } catch {
    // Refresh is best-effort and the API still validates every protected request.
  }
}
