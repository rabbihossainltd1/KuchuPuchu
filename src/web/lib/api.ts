export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { path: string; message: string }[];
};

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

export class RequestError extends Error {
  status: number;
  body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getStoredSessionToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new RequestError(0, {
      code: "NETWORK",
      message: "Could not reach the server. Refresh the preview and try again.",
    });
  }
  const text = await res.text();
  let data: T | { error: ApiError } = {} as T;
  if (text) {
    try {
      data = JSON.parse(text) as T | { error: ApiError };
    } catch {
      throw new RequestError(res.status, {
        code: "BAD_RESPONSE",
        message: "The app server is not responding. Refresh the preview.",
      });
    }
  }
  if (!res.ok) {
    const err = (data as { error?: ApiError }).error ?? {
      code: "HTTP_ERROR",
      message: "Request failed.",
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
