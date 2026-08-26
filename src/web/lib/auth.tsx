import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api, getStoredSessionToken, setStoredSessionToken } from "./api";
import { skeletonMe } from "./users";
import type { Me } from "./types";

type AuthState = {
  user: Me | null;
  loading: boolean;
  offline: boolean;
  refresh: () => Promise<Me | null>;
  signIn: (email: string, password: string) => Promise<Me>;
  signUp: (input: {
    email: string;
    password: string;
    displayName: string;
    username?: string;
    referralCode?: string;
  }) => Promise<Me>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void (async () => {
      if (!getStoredSessionToken()) {
        flushSync(() => setUser(null));
        setLoading(false);
        return;
      }
      try {
        const data = await api<{ user: Me }>("/api/me");
        flushSync(() => setUser(data.user));
      } catch {
        setStoredSessionToken(null);
        flushSync(() => setUser(null));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      offline,
      refresh: async () => {
        if (!getStoredSessionToken()) {
          flushSync(() => setUser(null));
          return null;
        }
        const data = await api<{ user: Me }>("/api/me");
        flushSync(() => setUser(data.user));
        return data.user;
      },
      signIn: async (email, password) => {
        const data = await api<{ token: string; user: Me }>("/api/auth/session", {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        });
        setStoredSessionToken(data.token);
        flushSync(() => setUser(data.user));
        return data.user;
      },
      signUp: async (input) => {
        const data = await api<{ token: string; user: Me }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: input.email.trim(),
            password: input.password,
            displayName: input.displayName.trim(),
            username: input.username,
            referralCode: input.referralCode,
          }),
        });
        setStoredSessionToken(data.token);
        flushSync(() => setUser(data.user));
        return data.user;
      },
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        setStoredSessionToken(null);
        flushSync(() => setUser(null));
      },
    }),
    [user, loading, offline],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}

export { skeletonMe };
