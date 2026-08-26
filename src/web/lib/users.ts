import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import type { Me, Privacy, PublicUser } from "./types";

export function slugFrom(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  return cleaned || "player";
}

export function iso(value: unknown) {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

export function defaultPrivacy(): Privacy {
  return {
    showCountry: true,
    showDistrict: false,
    showApproximateArea: false,
    showRelationship: false,
    showFfUid: false,
    allowMessages: "EVERYONE",
    allowRequests: "EVERYONE",
    allowGifts: "FRIENDS",
    discoverable: true,
  };
}

function defaultProfile() {
  return {
    ffUid: null as string | null,
    ffIgn: null as string | null,
    serverRegion: "SOUTH_ASIA" as string | null,
    level: null as number | null,
    rank: null as string | null,
    preferredModes: [] as string[],
    playStyle: null as string | null,
    languages: ["bn"],
    availability: [] as string[],
    micPreference: null as string | null,
    ageRange: null as string | null,
    gender: null as string | null,
    genderPreference: null as string | null,
    relationshipStatus: null as string | null,
    facebookId: null as string | null,
    instagram: null as string | null,
    whatsapp: null as string | null,
    verifiedFf: false,
    verifiedIdentity: false,
    onboardingComplete: true,
  };
}

export function skeletonMe(fb: User, extras?: { displayName?: string; username?: string }): Me {
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
    wallet: { balance: 80 },
    profile: defaultProfile(),
    privacy: defaultPrivacy(),
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

type UserDoc = Record<string, unknown>;

export function meFromDoc(id: string, data: UserDoc, fb?: User): Me {
  const profile = {
    ...defaultProfile(),
    ...((data.profile as object) || {}),
  };
  const privacy = { ...defaultPrivacy(), ...((data.privacy as object) || {}) };
  return {
    id,
    email: (data.email as string | null) ?? fb?.email ?? null,
    emailVerified: Boolean(data.emailVerified ?? fb?.emailVerified),
    username: String(data.username || slugFrom(String(data.displayName || "player"))),
    displayName: String(data.displayName || fb?.displayName || "Player"),
    avatarUrl: (data.avatarUrl as string | null) ?? fb?.photoURL ?? null,
    bio: (data.bio as string | null) ?? null,
    country: (data.country as string | null) ?? "Bangladesh",
    district: (data.district as string | null) ?? null,
    approximateArea: (data.approximateArea as string | null) ?? null,
    status: String(data.status || "ACTIVE"),
    referralCode: String(data.referralCode || id.slice(0, 8).toUpperCase()),
    referralLink: String(data.referralLink || ""),
    lastActiveAt: iso(data.lastActiveAt),
    createdAt: iso(data.createdAt),
    reputation: Number(data.reputation || 0),
    adminRole: (data.adminRole as string | null) ?? null,
    wallet: { balance: Number(data.walletBalance || 0) },
    profile,
    privacy,
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

export function publicFromMe(me: Me, viewerId?: string): PublicUser {
  const showDistrict = me.privacy.showDistrict || viewerId === me.id;
  const showUid = me.privacy.showFfUid || viewerId === me.id;
  const showRel = me.privacy.showRelationship || viewerId === me.id;
  const last = Date.parse(me.lastActiveAt);
  return {
    userId: me.id,
    displayName: me.displayName,
    username: me.username,
    avatarUrl: me.avatarUrl,
    bio: me.bio,
    country: me.privacy.showCountry ? me.country : null,
    district: showDistrict ? me.district : null,
    approximateArea: me.privacy.showApproximateArea ? me.approximateArea : null,
    ffUid: showUid ? me.profile.ffUid : null,
    ffIgn: me.profile.ffIgn,
    serverRegion: me.profile.serverRegion,
    level: me.profile.level,
    rank: me.profile.rank,
    preferredModes: me.profile.preferredModes,
    playStyle: me.profile.playStyle,
    languages: me.profile.languages,
    availability: me.profile.availability,
    micPreference: me.profile.micPreference,
    relationshipStatus: showRel ? me.profile.relationshipStatus : null,
    facebookId: me.profile.facebookId,
    instagram: me.profile.instagram,
    whatsapp: me.profile.whatsapp,
    verifiedFf: me.profile.verifiedFf,
    verifiedIdentity: me.profile.verifiedIdentity,
    reputation: me.reputation,
    lastActiveAt: me.lastActiveAt,
    online: Number.isFinite(last) && Date.now() - last < 5 * 60 * 1000,
  };
}

export function publicFromDoc(id: string, data: UserDoc, viewerId?: string): PublicUser {
  return publicFromMe(meFromDoc(id, data), viewerId);
}

export async function loadUserDoc(uid: string) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function ensureUserDoc(
  fb: User,
  extras?: { displayName?: string; username?: string },
) {
  const ref = doc(db, "users", fb.uid);
  const snap = await getDoc(ref);
  const base = skeletonMe(fb, extras);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: base.email,
      emailVerified: base.emailVerified,
      username: base.username,
      displayName: base.displayName,
      avatarUrl: base.avatarUrl,
      bio: null,
      country: base.country,
      district: null,
      approximateArea: null,
      status: "ACTIVE",
      referralCode: base.referralCode,
      referralLink: "",
      reputation: 0,
      adminRole: null,
      walletBalance: 80,
      profile: base.profile,
      privacy: base.privacy,
      searchName: base.displayName.toLowerCase(),
      searchUsername: base.username.toLowerCase(),
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
    return base;
  }
  const existing = meFromDoc(fb.uid, snap.data() as UserDoc, fb);
  await updateDoc(ref, {
    email: fb.email ?? existing.email,
    emailVerified: fb.emailVerified,
    lastActiveAt: serverTimestamp(),
  }).catch(() => undefined);
  return { ...existing, email: fb.email ?? existing.email, emailVerified: fb.emailVerified };
}

export async function loadMe(fb: User) {
  try {
    return await ensureUserDoc(fb);
  } catch {
    return skeletonMe(fb);
  }
}
