import { apiUrl } from "./config";
import { RequestError, type ApiError } from "./errors";

export type { ApiError };
export { RequestError };

const TOKEN_KEY = "kp_session_token";
let memoryToken: string | null = null;

export function getStoredSessionToken() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
    return memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setStoredSessionToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* storage blocked; memory token still works */
  }
}

const memoryCache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function peekCache<T>(path: string): T | undefined {
  return memoryCache.get(path)?.data as T | undefined;
}

export function bustCache(match?: string) {
  if (!match) {
    memoryCache.clear();
    return;
  }
  for (const key of [...memoryCache.keys()]) {
    if (key.includes(match)) memoryCache.delete(key);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const skipCache = path.includes("/messages") || path.includes("/calls");
  if (method === "GET" && !skipCache) {
    const hit = memoryCache.get(path);
    if (hit && Date.now() - hit.at < 45_000) return hit.data as T;
    const running = inflight.get(path);
    if (running) return running as Promise<T>;
  }

  const request = (async () => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const token = getStoredSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(apiUrl(path), { ...init, headers });
    } catch {
      throw new RequestError(0, { code: "NETWORK", message: "Could not reach the server." });
    }
    const text = await res.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { code: "CLOUD", message: "Unexpected response." } };
      }
    }
    if (!res.ok) {
      const err = (data as { error?: ApiError }).error ?? {
        code: "CLOUD",
        message: res.statusText || "Request failed.",
      };
      throw new RequestError(res.status, err);
    }
    if (method === "GET" && !skipCache) memoryCache.set(path, { at: Date.now(), data });
    else {
      if (path.includes("/conversations")) bustCache("/api/conversations");
      if (path.includes("/posts") || path.includes("/feed") || path.includes("/stories")) {
        bustCache("/api/feed");
        bustCache("/api/stories");
      }
      if (path.includes("/notifications") || path.includes("/friend")) {
        bustCache("/api/notifications");
        bustCache("/api/friend");
      }
      if (path.includes("/api/me") || path.includes("/wallet") || path.includes("/store")) {
        bustCache("/api/me");
      }
    }
    return data as T;
  })();

  if (method === "GET" && !skipCache) {
    inflight.set(path, request);
    try {
      return await request;
    } finally {
      inflight.delete(path);
    }
  }
  return request;
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function explainError(err: unknown) {
  if (err instanceof RequestError) return err.body.message;
  if (err instanceof Error && err.message) return err.message;
  return "Could not sign in.";
}
