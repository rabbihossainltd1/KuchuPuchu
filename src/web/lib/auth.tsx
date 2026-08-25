import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, RequestError } from "./api";
import type { Me } from "./types";

type AuthState = {
  user: Me | null;
  loading: boolean;
  offline: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  async function refresh() {
    try {
      const data = await api<{ user: Me }>("/api/me");
      setUser(data.user);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) setUser(null);
      else if (!navigator.onLine) setOffline(true);
      else throw error;
    }
  }

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void refresh()
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
      refresh: async () => {
        await refresh();
      },
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" });
        setUser(null);
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
