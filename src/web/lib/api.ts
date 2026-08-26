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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  return data as T;
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function explainError(err: unknown) {
  if (err instanceof RequestError) return err.body.message;
  if (err instanceof Error && err.message) return err.message;
  return "Could not sign in.";
}
