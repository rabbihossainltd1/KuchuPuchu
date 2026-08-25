import { createId, createReferralCode, createUsernameSeed } from "../../domain/ids.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../domain/hash.js";
import { applyPrivacy, canInteract, type PrivacySettingsInput } from "../../domain/privacy.js";
import { summarizeReputation } from "../../domain/reputation.js";
import { evaluateReferral } from "../../domain/referral.js";
import { AppError } from "../../shared/errors.js";
import {
  EMAIL_VERIFY_TTL_MS,
  ONLINE_WINDOW_MS,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
} from "../../shared/constants.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { appUrl, sendMail } from "../mailer.js";
import { getSettings } from "../settings.js";
import { creditCoins } from "./wallet.js";
import { notify } from "./notify.js";
import { writeAudit } from "./audit.js";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function createSession(userId: string, userAgent?: string, ip?: string) {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      id: createId("ses"),
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 240),
      ipHash: ip ? sha256(ip) : null,
    },
  });
  return token;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function destroyAllSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

async function provisionUser(input: {
  email?: string | null;
  emailVerifiedAt?: Date | null;
  passwordHash?: string | null;
  googleId?: string | null;
  displayName: string;
  username?: string;
  referralCode?: string;
}) {
  const username = await uniqueUsername(input.username || createUsernameSeed(input.displayName));
  const settings = await getSettings();
  let referredById: string | null = null;
  if (input.referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: input.referralCode.toUpperCase() },
    });
    if (!referrer || referrer.status !== "ACTIVE") {
      throw new AppError("INVALID_REFERRAL", "That referral code is not valid.", 400);
    }
    referredById = referrer.id;
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: createId("usr"),
        email: input.email?.toLowerCase() ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        passwordHash: input.passwordHash ?? null,
        googleId: input.googleId ?? null,
        username,
        displayName: input.displayName,
        referralCode: await uniqueReferralCode(tx),
        referredById,
        lastActiveAt: new Date(),
      },
    });
    await tx.profile.create({ data: { userId: created.id } });
    await tx.privacySettings.create({ data: { userId: created.id } });
    await tx.wallet.create({ data: { userId: created.id, balance: 0 } });
    await tx.notificationPreference.create({ data: { userId: created.id } });
    if (referredById) {
      await tx.referral.create({
        data: {
          id: createId("ref"),
          referrerId: referredById,
          refereeId: created.id,
          codeUsed: input.referralCode!.toUpperCase(),
          status: "PENDING",
          rewardAmount: settings.referralRewardCoins,
        },
      });
    }
    return created;
  });

  if (user.email && !user.emailVerifiedAt) {
    await sendVerificationEmail(user.id, user.email);
  }
  await maybeSettleReferral(user.id);
  return user;
}

async function uniqueUsername(seed: string) {
  let candidate = seed;
  for (let i = 0; i < 8; i += 1) {
    const exists = await prisma.user.findUnique({ where: { username: candidate } });
    if (!exists) return candidate;
    candidate = createUsernameSeed(seed);
  }
  return createUsernameSeed(`p${Date.now()}`);
}

async function uniqueReferralCode(tx: { user: { findUnique: typeof prisma.user.findUnique } }) {
  for (let i = 0; i < 10; i += 1) {
    const code = createReferralCode();
    const exists = await tx.user.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  return createReferralCode() + createReferralCode().slice(0, 2);
}

export async function registerWithEmail(input: {
  email: string;
  password: string;
  displayName: string;
  username?: string;
  referralCode?: string;
  userAgent?: string;
  ip?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing)
    throw new AppError("EMAIL_IN_USE", "An account with this email already exists.", 409);
  const user = await provisionUser({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName,
    username: input.username,
    referralCode: input.referralCode,
  });
  const token = await createSession(user.id, input.userAgent, input.ip);
  return { user, token };
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
  userAgent?: string;
  ip?: string;
}) {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !user.passwordHash) {
    throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  }
  if (user.deletedAt || user.status === "BANNED") {
    throw new AppError("ACCOUNT_DISABLED", "This account cannot sign in.", 403);
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  const token = await createSession(user.id, input.userAgent, input.ip);
  return { user, token };
}

export async function upsertGoogleUser(input: {
  googleId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
  userAgent?: string;
  ip?: string;
}) {
  const byGoogle = await prisma.user.findUnique({ where: { googleId: input.googleId } });
  if (byGoogle) {
    if (byGoogle.status === "BANNED" || byGoogle.deletedAt) {
      throw new AppError("ACCOUNT_DISABLED", "This account cannot sign in.", 403);
    }
    const token = await createSession(byGoogle.id, input.userAgent, input.ip);
    return { user: byGoogle, token };
  }
  const byEmail = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        googleId: input.googleId,
        emailVerifiedAt: input.emailVerified
          ? (byEmail.emailVerifiedAt ?? new Date())
          : byEmail.emailVerifiedAt,
        avatarUrl: byEmail.avatarUrl ?? input.avatarUrl,
      },
    });
    const token = await createSession(byEmail.id, input.userAgent, input.ip);
    return { user: byEmail, token };
  }
  const user = await provisionUser({
    email: input.email,
    emailVerifiedAt: input.emailVerified ? new Date() : null,
    googleId: input.googleId,
    displayName: input.displayName,
  });
  if (input.avatarUrl) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: input.avatarUrl } });
  }
  const token = await createSession(user.id, input.userAgent, input.ip);
  return { user, token };
}

export async function sendVerificationEmail(userId: string, email: string) {
  const token = randomToken(24);
  await prisma.emailToken.create({
    data: {
      id: createId("etk"),
      userId,
      type: "EMAIL_VERIFY",
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
    },
  });
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendMail({
    to: email,
    subject: "Verify your KuchuPuchu email",
    text: `Confirm your email by opening this link:\n${link}\nThis link expires in 24 hours.`,
  });
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== "EMAIL_VERIFY" || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("INVALID_TOKEN", "This verification link is invalid or expired.", 400);
  }
  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await maybeSettleReferral(record.userId);
  await notify({
    userId: record.userId,
    type: "security",
    title: "Email verified",
    body: "Your email address is now verified.",
    essential: true,
    link: "/settings",
  });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.email) return;
  const token = randomToken(24);
  await prisma.emailToken.create({
    data: {
      id: createId("etk"),
      userId: user.id,
      type: "PASSWORD_RESET",
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });
  await sendMail({
    to: user.email,
    subject: "Reset your KuchuPuchu password",
    text: `Reset your password:\n${appUrl(`/reset-password?token=${encodeURIComponent(token)}`)}\nThis link expires in 1 hour.`,
  });
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (
    !record ||
    record.type !== "PASSWORD_RESET" ||
    record.usedAt ||
    record.expiresAt < new Date()
  ) {
    throw new AppError("INVALID_TOKEN", "This reset link is invalid or expired.", 400);
  }
  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  await notify({
    userId: record.userId,
    type: "security",
    title: "Password changed",
    body: "Your password was reset. All sessions were signed out.",
    essential: true,
    link: "/login",
  });
}

export async function deleteAccount(userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: {
        status: "PENDING_DELETION",
        deletedAt: new Date(),
        email: `deleted+${userId}@invalid.local`,
        googleId: null,
        displayName: "Deleted user",
        avatarUrl: null,
        bio: null,
        district: null,
        approximateArea: null,
      },
    });
    await tx.profile.update({
      where: { userId },
      data: {
        ffUid: null,
        ffIgn: null,
        onboardingComplete: false,
      },
    });
    await tx.privacySettings.update({
      where: { userId },
      data: {
        discoverable: false,
        allowMessages: "NONE",
        allowRequests: "NONE",
        allowGifts: "NONE",
      },
    });
  });
  await writeAudit({
    actorId: userId,
    action: "account.delete",
    entityType: "user",
    entityId: userId,
  });
}

export async function touchActivity(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastActiveAt: new Date() },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      privacy: true,
      wallet: true,
      adminUser: true,
      notificationPref: true,
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "User not found.", 404);
  const reputation = await reputationFor(userId);
  return serializeMe(user, reputation);
}

export async function updateProfile(userId: string, patch: Record<string, unknown>) {
  const userFields = [
    "displayName",
    "username",
    "bio",
    "country",
    "district",
    "approximateArea",
    "avatarUrl",
  ];
  const userData: Record<string, unknown> = {};
  const profileData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (userFields.includes(key)) userData[key] = value;
    else if (key === "preferredModes") profileData.preferredModesJson = JSON.stringify(value);
    else if (key === "languages") profileData.languagesJson = JSON.stringify(value);
    else if (key === "availability") profileData.availabilityJson = JSON.stringify(value);
    else profileData[key] = value;
  }
  if (userData.username) {
    const taken = await prisma.user.findFirst({
      where: { username: String(userData.username), NOT: { id: userId } },
    });
    if (taken) throw new AppError("USERNAME_TAKEN", "That username is already taken.", 409);
  }
  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: userId }, data: userData });
    }
    if (Object.keys(profileData).length) {
      await tx.profile.update({
        where: { userId },
        data: { ...profileData, onboardingComplete: true },
      });
    }
  });
  return getMe(userId);
}

export async function updatePrivacy(userId: string, patch: Partial<PrivacySettingsInput>) {
  await prisma.privacySettings.update({ where: { userId }, data: patch });
  return getMe(userId);
}

export async function publicUser(viewerId: string | null, targetId: string, isAdmin = false) {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    include: { profile: true, privacy: true },
  });
  if (!user || user.deletedAt || user.status === "BANNED") {
    throw new AppError("NOT_FOUND", "Player not found.", 404);
  }
  const blocked = viewerId
    ? await prisma.block.findFirst({
        where: {
          OR: [
            { fromUserId: viewerId, toUserId: targetId },
            { fromUserId: targetId, toUserId: viewerId },
          ],
        },
      })
    : null;
  if (blocked && !isAdmin) throw new AppError("NOT_FOUND", "Player not found.", 404);

  const reputation = await reputationFor(targetId);
  const profile = user.profile;
  const privacy = user.privacy!;
  const view = applyPrivacy({
    isSelf: viewerId === targetId,
    isAdmin,
    privacy: {
      showCountry: privacy.showCountry,
      showDistrict: privacy.showDistrict,
      showApproximateArea: privacy.showApproximateArea,
      showRelationship: privacy.showRelationship,
      showFfUid: privacy.showFfUid,
      allowMessages: privacy.allowMessages as PrivacySettingsInput["allowMessages"],
      allowRequests: privacy.allowRequests as PrivacySettingsInput["allowRequests"],
      allowGifts: privacy.allowGifts as PrivacySettingsInput["allowGifts"],
      discoverable: privacy.discoverable,
    },
    profile: {
      userId: user.id,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      country: user.country,
      district: user.district,
      approximateArea: user.approximateArea,
      ffUid: profile?.ffUid ?? null,
      ffIgn: profile?.ffIgn ?? null,
      serverRegion: profile?.serverRegion ?? null,
      level: profile?.level ?? null,
      rank: profile?.rank ?? null,
      preferredModes: parseJsonArray(profile?.preferredModesJson),
      playStyle: profile?.playStyle ?? null,
      languages: parseJsonArray(profile?.languagesJson),
      availability: parseJsonArray(profile?.availabilityJson),
      micPreference: profile?.micPreference ?? null,
      relationshipStatus: profile?.relationshipStatus ?? null,
      verifiedFf: Boolean(profile?.verifiedFf),
      verifiedIdentity: Boolean(profile?.verifiedIdentity),
      reputation,
      lastActiveAt: user.lastActiveAt.toISOString(),
      online: Date.now() - user.lastActiveAt.getTime() < ONLINE_WINDOW_MS,
    },
  });
  return view;
}

export async function reputationFor(userId: string) {
  const events = await prisma.reputationEvent.findMany({
    where: { userId },
    select: { delta: true },
  });
  return summarizeReputation(events);
}

export async function areFriends(a: string, b: string) {
  const rel = await prisma.relationship.findFirst({
    where: {
      type: "FRIEND",
      OR: [
        { fromUserId: a, toUserId: b },
        { fromUserId: b, toUserId: a },
      ],
    },
  });
  return Boolean(rel);
}

export async function isBlocked(a: string, b: string) {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { fromUserId: a, toUserId: b },
        { fromUserId: b, toUserId: a },
      ],
    },
  });
  return Boolean(block);
}

export async function assertCanMessage(fromId: string, toId: string) {
  if (await isBlocked(fromId, toId)) {
    throw new AppError("BLOCKED", "You cannot message this player.", 403);
  }
  const privacy = await prisma.privacySettings.findUnique({ where: { userId: toId } });
  const friend = await areFriends(fromId, toId);
  if (
    !privacy ||
    !canInteract(privacy.allowMessages as PrivacySettingsInput["allowMessages"], friend)
  ) {
    throw new AppError("MESSAGES_DISABLED", "This player is not accepting messages.", 403);
  }
}

export async function assertCanRequest(fromId: string, toId: string) {
  if (await isBlocked(fromId, toId)) {
    throw new AppError("BLOCKED", "You cannot send a request to this player.", 403);
  }
  const privacy = await prisma.privacySettings.findUnique({ where: { userId: toId } });
  const friend = await areFriends(fromId, toId);
  if (
    !privacy ||
    !canInteract(privacy.allowRequests as PrivacySettingsInput["allowRequests"], friend)
  ) {
    throw new AppError("REQUESTS_DISABLED", "This player is not accepting requests.", 403);
  }
}

export async function maybeSettleReferral(refereeId: string) {
  const referral = await prisma.referral.findUnique({ where: { refereeId } });
  if (!referral || referral.status !== "PENDING") return;
  const [referrer, referee] = await Promise.all([
    prisma.user.findUnique({ where: { id: referral.referrerId } }),
    prisma.user.findUnique({ where: { id: refereeId } }),
  ]);
  if (!referrer || !referee) return;
  const settings = await getSettings();
  const sameIp = await recentSharedSignupSignal(referrer.id, referee.id);
  const decision = evaluateReferral({
    referrerId: referrer.id,
    refereeId: referee.id,
    referrerStatus: referrer.status,
    refereeStatus: referee.status,
    refereeEmailVerified: Boolean(referee.emailVerifiedAt),
    requireEmailVerification: settings.requireEmailVerificationForReferral,
    selfReferral: referrer.id === referee.id,
    alreadyAttributed: false,
    suspicious: sameIp,
  });
  if (!decision.eligible) {
    if (decision.holdReason === "held_for_review") {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: "HELD", holdReason: decision.holdReason },
      });
    }
    return;
  }
  await prisma.$transaction(async (tx) => {
    const current = await tx.referral.findUnique({ where: { id: referral.id } });
    if (!current || current.status !== "PENDING") return;
    await tx.referral.update({
      where: { id: referral.id },
      data: { status: "REWARDED", rewardedAt: new Date(), holdReason: null },
    });
    await creditInTx(tx, {
      userId: referrer.id,
      amount: settings.referralRewardCoins,
      type: "referral",
      source: "referral_referrer",
      referenceId: referral.id,
      idempotencyKey: `referral:referrer:${referral.id}`,
    });
    if (settings.refereeBonusCoins > 0) {
      await creditInTx(tx, {
        userId: referee.id,
        amount: settings.refereeBonusCoins,
        type: "referral",
        source: "referral_referee",
        referenceId: referral.id,
        idempotencyKey: `referral:referee:${referral.id}`,
      });
    }
  });
  await notify({
    userId: referrer.id,
    type: "referral_reward",
    title: "Referral reward",
    body: `You earned ${settings.referralRewardCoins} coins for inviting ${referee.displayName}.`,
    link: "/referrals",
    dedupeKey: `referral-referrer-${referral.id}`,
  });
}

async function creditInTx(
  tx: Parameters<typeof import("./wallet.js").postLedger>[0],
  input: Parameters<typeof creditCoins>[0],
) {
  const { postLedger } = await import("./wallet.js");
  await postLedger(tx, input.userId, input);
}

async function recentSharedSignupSignal(referrerId: string, refereeId: string) {
  const refereeSession = await prisma.session.findFirst({
    where: { userId: refereeId, ipHash: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!refereeSession?.ipHash) return false;
  const sameIpUsers = await prisma.session.findMany({
    where: {
      ipHash: refereeSession.ipHash,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { userId: true },
  });
  const ids = [...new Set(sameIpUsers.map((row) => row.userId))];
  const farmed = await prisma.referral.count({
    where: { referrerId, refereeId: { in: ids } },
  });
  return farmed >= 3;
}

function serializeMe(
  user: {
    id: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    country: string | null;
    district: string | null;
    approximateArea: string | null;
    status: string;
    referralCode: string;
    lastActiveAt: Date;
    createdAt: Date;
    profile: {
      ffUid: string | null;
      ffIgn: string | null;
      serverRegion: string | null;
      level: number | null;
      rank: string | null;
      preferredModesJson: string;
      playStyle: string | null;
      languagesJson: string;
      availabilityJson: string;
      micPreference: string | null;
      ageRange: string | null;
      gender: string | null;
      genderPreference: string | null;
      relationshipStatus: string | null;
      verifiedFf: boolean;
      verifiedIdentity: boolean;
      onboardingComplete: boolean;
    } | null;
    privacy: {
      showCountry: boolean;
      showDistrict: boolean;
      showApproximateArea: boolean;
      showRelationship: boolean;
      showFfUid: boolean;
      allowMessages: string;
      allowRequests: string;
      allowGifts: string;
      discoverable: boolean;
    } | null;
    wallet: { balance: number } | null;
    adminUser: { role: string } | null;
    notificationPref: NotificationPref | null;
  },
  reputation: number,
) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    country: user.country,
    district: user.district,
    approximateArea: user.approximateArea,
    status: user.status,
    referralCode: user.referralCode,
    referralLink: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/register?ref=${user.referralCode}`,
    lastActiveAt: user.lastActiveAt.toISOString(),
    createdAt: user.createdAt.toISOString(),
    reputation,
    adminRole: user.adminUser?.role ?? null,
    wallet: { balance: user.wallet?.balance ?? 0 },
    profile: {
      ffUid: user.profile?.ffUid ?? null,
      ffIgn: user.profile?.ffIgn ?? null,
      serverRegion: user.profile?.serverRegion ?? null,
      level: user.profile?.level ?? null,
      rank: user.profile?.rank ?? null,
      preferredModes: parseJsonArray(user.profile?.preferredModesJson),
      playStyle: user.profile?.playStyle ?? null,
      languages: parseJsonArray(user.profile?.languagesJson),
      availability: parseJsonArray(user.profile?.availabilityJson),
      micPreference: user.profile?.micPreference ?? null,
      ageRange: user.profile?.ageRange ?? null,
      gender: user.profile?.gender ?? null,
      genderPreference: user.profile?.genderPreference ?? null,
      relationshipStatus: user.profile?.relationshipStatus ?? null,
      verifiedFf: Boolean(user.profile?.verifiedFf),
      verifiedIdentity: Boolean(user.profile?.verifiedIdentity),
      onboardingComplete: Boolean(user.profile?.onboardingComplete),
    },
    privacy: user.privacy,
    notificationPreferences: user.notificationPref,
  };
}

type NotificationPref = {
  social: boolean;
  matching: boolean;
  messaging: boolean;
  gifting: boolean;
  wallet: boolean;
  payment: boolean;
  referral: boolean;
};

export function parseJsonList(value: string | null | undefined) {
  return parseJsonArray(value);
}

export { parseJsonArray };
