/**
 * Limits and windows enforced by the worker.
 *
 * These values used to disagree with src/worker/index.ts, which hardcoded its
 * own copies - a 2000-char message limit against the worker's 4000, a 280-char
 * bio against 160, a 30-day session against 90, a 5-minute presence window
 * against 90 seconds. Nothing imported this file, so the drift went unnoticed
 * and anything built against it would have been wrong. The worker now imports
 * these directly, so this file is the single source of truth.
 */

export const RANKS = [
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "HEROIC",
  "GRANDMASTER",
] as const;

export type Rank = (typeof RANKS)[number];

export const RANK_INDEX: Record<Rank, number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
  DIAMOND: 4,
  HEROIC: 5,
  GRANDMASTER: 6,
};

export const SERVER_REGIONS = [
  "SOUTH_ASIA",
  "INDIA",
  "SINGAPORE",
  "EUROPE",
  "NORTH_AMERICA",
  "LATIN_AMERICA",
  "MIDDLE_EAST",
  "THAILAND",
  "INDONESIA",
  "BRAZIL",
  "TAIWAN",
] as const;

export const GAME_MODES = [
  "BATTLE_ROYALE",
  "CLASH_SQUAD",
  "LONE_WOLF",
  "CS_RANKED",
  "BR_RANKED",
  "CRAFTLAND",
] as const;

export const PLAY_STYLES = [
  "AGGRESSIVE",
  "PASSIVE",
  "SUPPORT",
  "RUSHER",
  "SNIPER",
  "IGL",
  "FLEX",
] as const;

export const LANGUAGES = ["bn", "en", "hi", "ar", "id", "th", "es", "pt"] as const;

export const MIC_PREFERENCES = ["MIC_ON", "MIC_OFF", "OPTIONAL"] as const;

export const AGE_RANGES = ["13_17", "18_24", "25_30", "31_PLUS"] as const;

export const GENDERS = ["MALE", "FEMALE", "NON_BINARY", "UNDISCLOSED"] as const;

export const GENDER_PREFERENCES = ["ANY", "MALE", "FEMALE"] as const;

export const RELATIONSHIP_STATUSES = ["PREFER_NOT", "SINGLE", "TAKEN", "COMPLICATED"] as const;

export const USER_STATUSES = [
  "ACTIVE",
  "RESTRICTED",
  "SUSPENDED",
  "BANNED",
  "PENDING_DELETION",
] as const;

export const LEDGER_TYPES = [
  "credit",
  "debit",
  "referral",
  "reward",
  "purchase",
  "gift",
  "boost",
  "admin_grant",
  "reversal",
  "adjustment",
] as const;

export const PRODUCT_CATEGORIES = [
  "banners",
  "frames",
  "badges",
  "themes",
  "name_styles",
  "profile_decorations",
  "boosts",
  "limited",
] as const;

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"] as const;

export const PAYMENT_STATUSES = [
  "CREATED",
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "DISPUTED",
] as const;

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "MODERATION_ADMIN",
  "FINANCE_ADMIN",
  "CATALOG_ADMIN",
  "SUPPORT_ADMIN",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "impersonation",
  "scam",
  "inappropriate_content",
  "abuse",
  "suspicious_account",
  "other",
] as const;

export const DEFAULT_MATCH_WEIGHTS = {
  mode: 24,
  server: 20,
  availability: 16,
  rank: 14,
  language: 8,
  playStyle: 8,
  activity: 6,
  proximity: 4,
  reputation: 4,
  mic: 4,
} as const;

export const ONLINE_WINDOW_MS = 90 * 1000;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Phone auth: how long a new-device login approval stays claimable (§17). */
export const LOGIN_REQUEST_TTL_MS = 5 * 60 * 1000;
/** Phone auth: how long a Google recovery request stays usable (§22). */
export const RECOVERY_REQUEST_TTL_MS = 5 * 60 * 1000;
/** Phone auth: unfinished PENDING signups (google never bound) are swept
 *  after this, so an abandoned phone claim cannot squat a number forever. */
export const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const DUO_REQUEST_TTL_MS = 12 * 60 * 60 * 1000;
export const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MESSAGE_MAX_LENGTH = 4000;
export const BIO_MAX_LENGTH = 160;
export const GIFT_MESSAGE_MAX = 140;

export const DEFAULT_SETTINGS = {
  referralRewardCoins: 80,
  refereeBonusCoins: 20,
  dailyRewardCoins: 15,
  dailyRewardEnabled: true,
  minAccountAgeHoursForReferral: 0,
  requireEmailVerificationForReferral: true,
  duoRequestDailyLimit: 25,
  messageHourlyLimit: 80,
  giftDailyLimit: 10,
  reportDailyLimit: 8,
  followDailyLimit: 60,
  discoveryPageSize: 20,
  postHourlyLimit: 20,
} as const;
