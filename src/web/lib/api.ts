export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { path: string; message: string }[];
};

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
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T | { error: ApiError }) : ({} as T);
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
