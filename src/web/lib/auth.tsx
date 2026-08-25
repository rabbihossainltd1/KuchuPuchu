import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseAuth, explainFirebaseError } from "./firebase";
import { setStoredSessionToken } from "./api";
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

function slugFrom(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  return cleaned || "player";
}

function meFromFirebase(fb: User, extras?: { displayName?: string; username?: string }): Me {
  const email = fb.email ?? "";
  const displayName = extras?.displayName || fb.displayName || email.split("@")[0] || "Player";
  const username = extras?.username || slugFrom(displayName);
  const now = new Date().toISOString();
  return {
    id: fb.uid,
    email: email || null,
    emailVerified: Boolean(fb.emailVerified),
    username,
    displayName,
    avatarUrl: fb.photoURL,
    bio: null,
    country: "Bangladesh",
    district: null,
    approximateArea: null,
    status: "ACTIVE",
    referralCode: fb.uid.slice(0, 8).toUpperCase(),
    referralLink: "",
    lastActiveAt: now,
    createdAt: fb.metadata.creationTime ? new Date(fb.metadata.creationTime).toISOString() : now,
    reputation: 0,
    adminRole: null,
    wallet: { balance: 0 },
    profile: {
      ffUid: null,
      ffIgn: null,
      serverRegion: "SOUTH_ASIA",
      level: null,
      rank: null,
      preferredModes: [],
      playStyle: null,
      languages: ["bn"],
      availability: [],
      micPreference: null,
      ageRange: null,
      gender: null,
      genderPreference: null,
      relationshipStatus: null,
      facebookId: null,
      instagram: null,
      whatsapp: null,
      verifiedFf: false,
      verifiedIdentity: false,
      onboardingComplete: true,
    },
    privacy: {
      showCountry: true,
      showDistrict: false,
      showApproximateArea: false,
      showRelationship: false,
      showFfUid: false,
      allowMessages: "EVERYONE",
      allowRequests: "EVERYONE",
      allowGifts: "FRIENDS",
      discoverable: true,
    },
    notificationPreferences: {
      social: true,
      matching: true,
      messaging: true,
      gifting: true,
      wallet: true,
      payment: true,
      referral: true,
    },
  };
}

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
      flushSync(() => setUser(fb ? meFromFirebase(fb) : null));
      setLoading(false);
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
        const next = fb ? meFromFirebase(fb) : null;
        flushSync(() => setUser(next));
        return next;
      },
      signIn: async (email, password) => {
        try {
          const cred = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
          const me = meFromFirebase(cred.user);
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
          const me = meFromFirebase(cred.user, {
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
