import { ApiError, apiErrorMessage, createApiClient } from "../api";

export type ApiClient = ReturnType<typeof createApiClient>;

export type AuthPrivacy = {
  phone: "nobody" | "contacts" | "public";
  avatar: "nobody" | "contacts" | "public";
  messages: "nobody" | "contacts" | "public";
  lastSeen: "nobody" | "contacts" | "public";
  groups: "nobody" | "contacts" | "public";
  status: "nobody" | "contacts" | "public";
  privateProfile: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  about: string | null;
  avatarUrl?: string | null;
  avatarRef?: string | null;
  email: string | null;
  phone: string | null;
  googleEmail: string | null;
  googleLinked: boolean;
  privacy?: AuthPrivacy;
  verified?: boolean;
  moderator?: boolean;
  badge?: string | null;
  /** Published KP1 public key; absent until the account adopts an identity. */
  e2eePublicKey?: string | null;
};

export type SessionPayload = {
  token: string;
  user: AuthUser;
  status?: "SESSION";
};

export type VerifyPhoneResponse = {
  status: "SESSION" | "ACCOUNT_CREATED" | "BIND_REQUIRED" | "APPROVAL_REQUIRED" | string;
  token?: string;
  user?: AuthUser;
  phone?: string;
  method?: string;
  requestId?: string;
  expiresAt?: string;
  deviceGone?: boolean;
  otpAvailable?: boolean;
};

export type LoginPollResponse = {
  status:
    "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED" | "UNKNOWN" | "SESSION" | string;
  token?: string;
  user?: AuthUser;
  expiresAt?: string;
};

export type LoginOtpResponse = {
  status:
    "SESSION" | "INVALID_CODE" | "OTP_LOCKED" | "OTP_UNAVAILABLE" | "UNKNOWN" | "EXPIRED" | string;
  token?: string;
  user?: AuthUser;
  attemptsRemaining?: number;
};

export type AuthDevice = {
  deviceId: string;
  platform: string;
  name: string;
  active: boolean;
  current: boolean;
  appVersion: string | null;
  firstSeenAt: string;
  signedInAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  ip?: string | null;
  place?: string | null;
};

export function requestJson<T>(
  api: ApiClient,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return api.request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

export const authApi = {
  verifyPhone(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<VerifyPhoneResponse>(api, "/api/auth/verify-phone", "POST", body, signal);
  },
  bindGoogle(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<VerifyPhoneResponse>(api, "/api/auth/google/bind", "POST", body, signal);
  },
  pollLogin(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<LoginPollResponse>(api, "/api/auth/login/poll", "POST", body, signal);
  },
  submitOtp(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<LoginOtpResponse>(api, "/api/auth/login/otp", "POST", body, signal);
  },
  cancelLogin(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<{ ok: boolean }>(api, "/api/auth/login/cancel", "POST", body, signal);
  },
  lookupRecovery(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<{ exists: boolean }>(api, "/api/auth/recovery/lookup", "POST", body, signal);
  },
  startRecovery(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<{ requestId: string; expiresAt: string }>(
      api,
      "/api/auth/recovery/start",
      "POST",
      body,
      signal,
    );
  },
  completeRecovery(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<SessionPayload>(api, "/api/auth/recovery/complete", "POST", body, signal);
  },
  getGoogleConfig(api: ApiClient, signal?: AbortSignal) {
    return api.request<{ googleWebClientId: string | null }>("/api/config/firebase", {
      ...(signal ? { signal } : {}),
    });
  },
  getMe(api: ApiClient, signal?: AbortSignal) {
    return api.request<{ user: AuthUser }>("/api/me", { ...(signal ? { signal } : {}) });
  },
  updateMe(api: ApiClient, body: Record<string, unknown>, signal?: AbortSignal) {
    return requestJson<{ user: AuthUser }>(api, "/api/me", "PATCH", body, signal);
  },
  checkUsername(api: ApiClient, username: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ u: username });
    return api.request<{ available: boolean; reason: string }>(
      `/api/users/username-available?${query.toString()}`,
      { ...(signal ? { signal } : {}) },
    );
  },
  getDevices(api: ApiClient, signal?: AbortSignal) {
    return api.request<{ items: AuthDevice[] }>("/api/auth/devices", {
      ...(signal ? { signal } : {}),
    });
  },
  logout(api: ApiClient) {
    return requestJson<{ ok: boolean }>(api, "/api/auth/logout", "POST", {});
  },
  refresh(api: ApiClient) {
    return requestJson<{ ok: boolean; expiresAt?: string; extended?: boolean }>(
      api,
      "/api/auth/refresh",
      "POST",
      {},
    );
  },
};

export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthUser>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.displayName === "string" &&
    (candidate.phone === null || typeof candidate.phone === "string") &&
    (candidate.email === null || typeof candidate.email === "string") &&
    (candidate.googleEmail === null || typeof candidate.googleEmail === "string") &&
    typeof candidate.googleLinked === "boolean"
  );
}

export function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionPayload>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    candidate.token.length <= 4096 &&
    isAuthUser(candidate.user)
  );
}

export function authErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "PHONE_MISMATCH":
        return "The service rejected this number because it did not match the verified SIM on the account. This browser cannot read a SIM; retry on the matching phone or use account recovery.";
      case "GOOGLE_TAKEN":
        return "That Google account is already linked to a different KuchuPuchu account.";
      case "NO_PENDING_SIGNUP":
        return "The sign-up request expired. Start again with your phone number.";
      case "NO_RECOVERY_TARGET":
      case "RECOVERY_INVALID":
        return "No recoverable account was found for that number and Google account.";
      case "RECOVERY_EXPIRED":
        return "The recovery request expired. Start account recovery again.";
      case "REQUEST_NOT_FOUND":
        return "This approval request is no longer available.";
      default:
        return apiErrorMessage(error);
    }
  }
  return apiErrorMessage(error);
}

export function isTransientPollError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.kind === "network" ||
    (error.kind === "http" &&
      (error.status === 408 ||
        error.status === 425 ||
        error.status === 429 ||
        (error.status ?? 0) >= 500))
  );
}
