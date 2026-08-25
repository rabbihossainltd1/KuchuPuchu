import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api, getStoredSessionToken, setStoredSessionToken } from "./api";
import type { Me } from "./types";

type SessionResponse = { token?: string; user?: Me };

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

function applySession(session: SessionResponse): Me {
  if (session.token) setStoredSessionToken(session.token);
  if (!session.user) {
    throw new Error("Server did not return a user profile.");
  }
  return session.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  async function loadMe(): Promise<Me | null> {
    if (!getStoredSessionToken()) {
      flushSync(() => setUser(null));
      return null;
    }
    const data = await api<{ user: Me }>("/api/me");
    flushSync(() => setUser(data.user));
    return data.user;
  }

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void loadMe()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
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
      refresh: () => loadMe().catch(() => null),
      signIn: async (email, password) => {
        const session = await api<SessionResponse>("/api/auth/session", {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const me = applySession(session);
        flushSync(() => setUser(me));
        return me;
      },
      signUp: async (input) => {
        const created = await api<SessionResponse>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(input),
        });
        const me = applySession(created);
        flushSync(() => setUser(me));
        return me;
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
