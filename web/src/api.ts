const API_ORIGIN_FOR_VALIDATION = "https://app.invalid";
const API_PATH_PATTERN = /^\/api(?:\/|$)/;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export type ApiErrorKind = "invalid-request" | "network" | "aborted" | "http" | "invalid-response";

type ApiErrorOptions = {
  kind: ApiErrorKind;
  status?: number;
  code?: string;
  retryAfter?: string;
  retryable?: boolean;
};

function internalErrorMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case "invalid-request":
      return "The API request path is invalid.";
    case "network":
      return "The API request could not reach the server.";
    case "aborted":
      return "The API request was cancelled.";
    case "http":
      return "The API request was not successful.";
    case "invalid-response":
      return "The API response could not be read.";
  }
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfter?: string;
  readonly retryable: boolean;

  constructor(options: ApiErrorOptions) {
    super(internalErrorMessage(options.kind));
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
    this.retryable = options.retryable ?? false;
  }
}

/** Maps transport failures to fixed copy; raw Worker messages are never displayed. */
export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";

  if (error.kind === "aborted") return "";
  if (error.kind === "network") return "Could not connect. Check your connection and try again.";
  if (error.kind === "invalid-request") return "This request could not be sent safely.";
  if (error.kind === "invalid-response") return "The server returned an unreadable response.";

  if (error.status === 401) return "Sign in again to continue.";
  if (error.status === 403) return "You do not have permission to do that.";
  if (error.status === 404) return "That item is no longer available.";
  if (error.status === 408) return "The request timed out. Please try again.";
  if (error.status === 429) return "You're doing that too quickly. Wait a moment and try again.";
  if (error.status !== undefined && error.status >= 500) {
    return "The service is temporarily unavailable. Try again later.";
  }
  return "The request could not be completed. Please try again.";
}

function validateApiPath(path: string): string {
  if (!path.startsWith("/") || path.includes("\\") || path.includes("#")) {
    throw new ApiError({ kind: "invalid-request" });
  }

  let url: URL;
  try {
    url = new URL(path, API_ORIGIN_FOR_VALIDATION);
  } catch {
    throw new ApiError({ kind: "invalid-request" });
  }

  if (
    url.origin !== API_ORIGIN_FOR_VALIDATION ||
    !API_PATH_PATTERN.test(url.pathname) ||
    url.pathname.includes("//") ||
    /%(?:2f|5c)/i.test(url.pathname) ||
    url.hash
  ) {
    throw new ApiError({ kind: "invalid-request" });
  }

  return `${url.pathname}${url.search}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function safeRetryAfter(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,6}$/.test(trimmed)) return trimmed;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

async function readSafeErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object") return undefined;

    const root = body as Record<string, unknown>;
    const nestedError =
      root.error && typeof root.error === "object"
        ? (root.error as Record<string, unknown>)
        : undefined;
    const candidate = nestedError?.code ?? root.code;
    return typeof candidate === "string" && SAFE_ERROR_CODE.test(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export type ApiFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Same-origin JSON client. It never retries mutations or follows API redirects. */
export function createApiClient(fetcher: ApiFetcher = globalThis.fetch) {
  return {
    async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
      const requestPath = validateApiPath(path);
      const headers = new Headers(init.headers);
      if (!headers.has("accept")) headers.set("accept", "application/json");
      const method = (init.method ?? "GET").trim().toUpperCase();
      const safeToRetry = method === "GET" || method === "HEAD";

      let response: Response;
      try {
        response = await fetcher(requestPath, {
          ...init,
          headers,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        });
      } catch (error) {
        if (isAbortError(error)) throw new ApiError({ kind: "aborted" });
        throw new ApiError({ kind: "network", retryable: safeToRetry });
      }

      if (!response.ok) {
        const transientStatus =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new ApiError({
          kind: "http",
          status: response.status,
          code: await readSafeErrorCode(response),
          retryAfter: safeRetryAfter(response.headers.get("retry-after")),
          retryable: safeToRetry && transientStatus,
        });
      }

      if (method === "HEAD" || response.status === 204 || response.status === 205) {
        return undefined as T;
      }
      if (!isJsonContentType(response.headers.get("content-type"))) {
        throw new ApiError({ kind: "invalid-response", status: response.status });
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        if (isAbortError(error)) throw new ApiError({ kind: "aborted" });
        throw new ApiError({ kind: "invalid-response", status: response.status });
      }
    },

    /**
     * Binary transport: the same path validation, credentials, no-store and
     * redirect rules as `request`, but the body is handed back raw. File
     * uploads and downloads need it — a JPEG is not `application/json`, and
     * refusing to parse one is not the same as refusing to serve it.
     *
     * It never retries: a mutation is a mutation, and a GET that already
     * produced a body stream is not safe to replay behind the caller's back.
     */
    async requestRaw(path: string, init: RequestInit = {}): Promise<Response> {
      const requestPath = validateApiPath(path);
      const headers = new Headers(init.headers);
      const method = (init.method ?? "GET").trim().toUpperCase();

      let response: Response;
      try {
        response = await fetcher(requestPath, {
          ...init,
          headers,
          method,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        });
      } catch (error) {
        if (isAbortError(error)) throw new ApiError({ kind: "aborted" });
        throw new ApiError({ kind: "network", retryable: false });
      }

      if (!response.ok) {
        throw new ApiError({
          kind: "http",
          status: response.status,
          code: await readSafeErrorCode(response),
          retryable: false,
        });
      }

      return response;
    },
  };
}
