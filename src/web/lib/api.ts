import { cloudRequest } from "./cloud";
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
  return cloudRequest<T>(path, init);
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function explainError(err: unknown) {
  if (err instanceof RequestError) return err.body.message;
  if (err instanceof Error && err.message) return err.message;
  return "Could not sign in.";
}
