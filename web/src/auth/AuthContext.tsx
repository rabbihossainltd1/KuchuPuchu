import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { ApiError, createApiClient } from "../api";
import {
  authApi,
  authErrorCopy,
  isAuthUser,
  type ApiClient,
  type AuthUser,
  type SessionPayload,
} from "./authApi";
import {
  clearAuthSession,
  ensureWebDeviceId,
  persistAuthSession,
  persistAuthUser,
  readRefreshedAt,
  storedBearerToken,
  storedWebDeviceId,
  writeRefreshedAt,
  TOKEN_STORAGE_KEY,
} from "./storage";

export type AuthStatus = "disabled" | "restoring" | "signed-out" | "signed-in" | "unverified";

type AuthContextValue = {
  api: ApiClient;
  status: AuthStatus;
  token: string;
  deviceId: string;
  user: AuthUser | null;
  restoreError: string;
  signIn: (session: SessionPayload) => void;
  updateUser: (user: AuthUser) => void;
  retryRestore: () => Promise<boolean>;
  logout: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const SESSION_REFRESH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function cacheUser(user: AuthUser): void {
  persistAuthUser(user);
}

export function AuthProvider({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) {
  const [token, setToken] = useState(() => (enabled ? storedBearerToken() : ""));
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [deviceId, setDeviceId] = useState(() => (enabled ? storedWebDeviceId() : ""));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    enabled ? (token ? "restoring" : "signed-out") : "disabled",
  );
  const [restoreError, setRestoreError] = useState("");
  const clearSessionRef = useRef<() => void>(() => undefined);

  const clearLocalSession = useCallback(() => {
    tokenRef.current = "";
    clearAuthSession();
    setToken("");
    setUser(null);
    setRestoreError("");
    setStatus(enabled ? "signed-out" : "disabled");
  }, [enabled]);
  clearSessionRef.current = clearLocalSession;

  const api = useMemo<ApiClient>(() => {
    const fetchWithSession: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const currentToken = tokenRef.current;
      if (currentToken && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${currentToken}`);
      }

      const response = await globalThis.fetch(input, { ...init, headers });
      if (response.status === 401 && currentToken && tokenRef.current === currentToken) {
        clearSessionRef.current();
      }
      return response;
    };
    return createApiClient(fetchWithSession);
  }, []);

  const loadCurrentUser = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      try {
        const response = await authApi.getMe(api, signal);
        if (!isAuthUser(response.user)) {
          setRestoreError(
            "The account service returned an invalid profile. Protected data remains hidden.",
          );
          setStatus("unverified");
          return false;
        }
        setUser(response.user);
        cacheUser(response.user);
        setRestoreError("");
        setStatus("signed-in");
        return true;
      } catch (error) {
        if (signal?.aborted || (error instanceof ApiError && error.kind === "aborted"))
          return false;
        if (error instanceof ApiError && error.status === 401) {
          clearLocalSession();
          return false;
        }
        setRestoreError(authErrorCopy(error));
        setStatus("unverified");
        return false;
      }
    },
    [api, clearLocalSession],
  );

  useEffect(() => {
    if (!enabled) {
      tokenRef.current = "";
      setToken("");
      setUser(null);
      setStatus("disabled");
      return;
    }

    const currentDeviceId = ensureWebDeviceId();
    setDeviceId(currentDeviceId);
    const savedToken = storedBearerToken();
    tokenRef.current = savedToken;
    setToken(savedToken);
    if (!savedToken) {
      setUser(null);
      setRestoreError("");
      setStatus("signed-out");
      return;
    }

    setStatus("restoring");
    const controller = new AbortController();
    void loadCurrentUser(controller.signal);
    return () => controller.abort();
  }, [enabled, loadCurrentUser]);

  useEffect(() => {
    if (!enabled) return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_STORAGE_KEY) return;
      if (!event.newValue) {
        clearLocalSession();
        return;
      }

      tokenRef.current = event.newValue;
      setToken(event.newValue);
      setUser(null);
      setStatus("restoring");
      void loadCurrentUser();
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [enabled, clearLocalSession, loadCurrentUser]);

  useEffect(() => {
    if (!enabled || status !== "signed-in" || !token) return;

    let inFlight = false;
    const maybeRefresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      if (Date.now() - readRefreshedAt() < SESSION_REFRESH_MIN_INTERVAL_MS) return;
      inFlight = true;
      try {
        const result = await authApi.refresh(api);
        if (result.ok) writeRefreshedAt(Date.now());
      } catch {
        // Refresh is best-effort. Protected requests still validate the bearer, and
        // a 401 from the shared client clears the local session automatically.
      } finally {
        inFlight = false;
      }
    };

    void maybeRefresh();
    const timer = window.setInterval(() => void maybeRefresh(), SESSION_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [enabled, status, token, api]);

  const signIn = useCallback((session: SessionPayload) => {
    tokenRef.current = session.token;
    persistAuthSession(session.token, session.user);
    setToken(session.token);
    setUser(session.user);
    setRestoreError("");
    setStatus("signed-in");
  }, []);

  const updateUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    cacheUser(nextUser);
  }, []);

  const retryRestore = useCallback(async () => {
    if (!tokenRef.current) {
      setStatus("signed-out");
      return false;
    }
    setStatus("restoring");
    setRestoreError("");
    return loadCurrentUser();
  }, [loadCurrentUser]);

  const logout = useCallback(async () => {
    const currentToken = tokenRef.current;
    clearLocalSession();
    if (!currentToken) return true;

    try {
      const result = await api.request<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${currentToken}`,
        },
        body: "{}",
      });
      return result.ok === true;
    } catch {
      return false;
    }
  }, [api, clearLocalSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      api,
      status,
      token,
      deviceId,
      user,
      restoreError,
      signIn,
      updateUser,
      retryRestore,
      logout,
    }),
    [api, status, token, deviceId, user, restoreError, signIn, updateUser, retryRestore, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing.");
  return context;
}
