import { z } from "zod";
import {
  AGE_RANGES,
  GAME_MODES,
  GENDER_PREFERENCES,
  GENDERS,
  LANGUAGES,
  MIC_PREFERENCES,
  PLAY_STYLES,
  RANKS,
  RELATIONSHIP_STATUSES,
  REPORT_CATEGORIES,
  SERVER_REGIONS,
  BIO_MAX_LENGTH,
  GIFT_MESSAGE_MAX,
  MESSAGE_MAX_LENGTH,
} from "../shared/constants.js";

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/[0-9]/, "Password needs a number");

export const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, "Username may contain letters, numbers, and underscore");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(160)
  .regex(/^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/, "Enter a valid email address");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(40),
  username: usernameSchema.optional(),
  referralCode: z.string().trim().min(4).max(16).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const profilePatchSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  username: usernameSchema.optional(),
  bio: z.string().max(BIO_MAX_LENGTH).optional(),
  country: z.string().trim().min(2).max(56).optional().nullable(),
  district: z.string().trim().min(2).max(80).optional().nullable(),
  approximateArea: z.string().trim().min(2).max(80).optional().nullable(),
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || /^https?:\/\//i.test(value), "Enter a valid image URL"),
  ffUid: z.string().trim().min(5).max(20).optional().nullable(),
  ffIgn: z.string().trim().min(2).max(24).optional().nullable(),
  serverRegion: z.enum(SERVER_REGIONS).optional().nullable(),
  level: z.number().int().min(1).max(100).optional().nullable(),
  rank: z.enum(RANKS).optional().nullable(),
  preferredModes: z.array(z.enum(GAME_MODES)).max(6).optional(),
  playStyle: z.enum(PLAY_STYLES).optional().nullable(),
  languages: z.array(z.enum(LANGUAGES)).max(6).optional(),
  availability: z.array(z.string().min(2).max(24)).max(14).optional(),
  micPreference: z.enum(MIC_PREFERENCES).optional().nullable(),
  ageRange: z.enum(AGE_RANGES).optional().nullable(),
  gender: z.enum(GENDERS).optional().nullable(),
  genderPreference: z.enum(GENDER_PREFERENCES).optional().nullable(),
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional().nullable(),
  facebookId: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  instagram: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  whatsapp: z
    .string()
    .trim()
    .max(24)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
});

export const privacyPatchSchema = z.object({
  showCountry: z.boolean().optional(),
  showDistrict: z.boolean().optional(),
  showApproximateArea: z.boolean().optional(),
  showRelationship: z.boolean().optional(),
  showFfUid: z.boolean().optional(),
  allowMessages: z.enum(["EVERYONE", "FRIENDS", "NONE"]).optional(),
  allowRequests: z.enum(["EVERYONE", "FRIENDS", "NONE"]).optional(),
  allowGifts: z.enum(["EVERYONE", "FRIENDS", "NONE"]).optional(),
  discoverable: z.boolean().optional(),
});

export const discoverQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  serverRegion: z.enum(SERVER_REGIONS).optional(),
  country: z.string().optional(),
  district: z.string().optional(),
  rankMin: z.enum(RANKS).optional(),
  rankMax: z.enum(RANKS).optional(),
  mode: z.enum(GAME_MODES).optional(),
  playStyle: z.enum(PLAY_STYLES).optional(),
  language: z.enum(LANGUAGES).optional(),
  availability: z.string().optional(),
  micPreference: z.enum(MIC_PREFERENCES).optional(),
  ageRange: z.enum(AGE_RANGES).optional(),
  genderPreference: z.enum(GENDER_PREFERENCES).optional(),
  online: z.enum(["true", "false"]).optional(),
  verified: z.enum(["true", "false"]).optional(),
  q: z.string().max(40).optional(),
});

export const duoRequestSchema = z.object({
  targetId: z.string().min(8).optional(),
  mode: z.enum(GAME_MODES),
  preferredRankMin: z.enum(RANKS).optional(),
  preferredRankMax: z.enum(RANKS).optional(),
  availability: z.array(z.string().min(2).max(24)).max(14).optional(),
  message: z.string().max(200).optional(),
});

export const friendRequestSchema = z.object({
  userId: z.string().min(8),
});

export const conversationCreateSchema = z.object({
  userId: z.string().min(8),
});

export const messageCreateSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export const postCreateSchema = z.object({
  body: z.string().trim().min(1).max(500),
  visibility: z.enum(["PUBLIC", "FRIENDS"]).default("PUBLIC"),
});

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1).max(280),
});

export const storyCreateSchema = z
  .object({
    body: z.string().trim().max(200).optional().nullable(),
    imageData: z.string().max(1_800_000).optional().nullable(),
  })
  .refine((value) => Boolean(value.body?.trim() || value.imageData), {
    message: "Add a photo or a short caption.",
  });

export const callCreateSchema = z.object({
  userId: z.string().min(8),
  kind: z.enum(["AUDIO", "VIDEO"]),
  offerSdp: z.string().min(10).max(40_000),
});

export const callAnswerSchema = z.object({
  answerSdp: z.string().min(10).max(40_000),
});

export const callIceSchema = z.object({
  candidate: z.unknown(),
});

export const storeOrderSchema = z.object({
  productId: z.string().min(4),
  idempotencyKey: z.string().min(8).max(80),
});

export const giftSchema = z.object({
  inventoryId: z.string().min(8),
  receiverId: z.string().min(8),
  message: z.string().max(GIFT_MESSAGE_MAX).optional(),
  idempotencyKey: z.string().min(8).max(80),
});

export const paymentOrderSchema = z.object({
  packageId: z.string().min(4),
  idempotencyKey: z.string().min(8).max(80),
});

export const reportSchema = z.object({
  targetUserId: z.string().min(8),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().min(8).max(1000),
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const notificationPrefSchema = z.object({
  social: z.boolean().optional(),
  matching: z.boolean().optional(),
  messaging: z.boolean().optional(),
  gifting: z.boolean().optional(),
  wallet: z.boolean().optional(),
  payment: z.boolean().optional(),
  referral: z.boolean().optional(),
});

export const adminUserActionSchema = z.object({
  action: z.enum(["warn", "restrict", "suspend", "ban", "restore"]),
  reason: z.string().trim().min(4).max(400),
});

export const adminProductSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(4).max(400),
  category: z.string().min(2).max(40),
  priceCoins: z.number().int().min(0).max(1_000_000),
  imageKey: z.string().min(2).max(40),
  rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "RETIRED"]).optional(),
  giftable: z.boolean().optional(),
  limited: z.boolean().optional(),
  stock: z.number().int().min(0).optional().nullable(),
  maxPerUser: z.number().int().min(1).max(99).optional(),
  uniqueItem: z.boolean().optional(),
});

export const adminGrantSchema = z.object({
  userId: z.string().min(8),
  amount: z.number().int().min(1).max(100_000),
  reason: z.string().trim().min(4).max(200),
  idempotencyKey: z.string().min(8).max(80),
});

export const adminSettingSchema = z.object({
  key: z.string().min(2).max(80),
  value: z.unknown(),
});
