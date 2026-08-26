import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth, explainFirebaseError } from "./firebase";
import { setStoredSessionToken } from "./api";
import { ensureUserDoc, loadMe, skeletonMe } from "./users";
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
    const unsub = onAuthStateChanged(firebaseAuth, (fb) => {
      void (async () => {
        if (!fb) {
          flushSync(() => setUser(null));
          setLoading(false);
          return;
        }
        const me = await loadMe(fb);
        flushSync(() => setUser(me));
        setLoading(false);
      })();
    });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unsub();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      offline,
      refresh: async () => {
        const fb = firebaseAuth.currentUser;
        const next = fb ? await loadMe(fb) : null;
        flushSync(() => setUser(next));
        return next;
      },
      signIn: async (email, password) => {
        try {
          const cred = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
          const me = await loadMe(cred.user);
          flushSync(() => setUser(me));
          return me;
        } catch (err) {
          throw new Error(explainFirebaseError(err));
        }
      },
      signUp: async (input) => {
        try {
          const cred = await createUserWithEmailAndPassword(
            firebaseAuth,
            input.email.trim(),
            input.password,
          );
          await updateProfile(cred.user, { displayName: input.displayName.trim() });
          const me = await ensureUserDoc(cred.user, {
            displayName: input.displayName.trim(),
            username: input.username,
          });
          flushSync(() => setUser(me));
          return me;
        } catch (err) {
          throw new Error(explainFirebaseError(err));
        }
      },
      logout: async () => {
        await signOut(firebaseAuth).catch(() => undefined);
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
