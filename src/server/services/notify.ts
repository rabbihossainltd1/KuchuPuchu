import { createId } from "../../domain/ids.js";
import { prisma } from "../db.js";

const CATEGORY: Record<string, keyof NotificationFlags> = {
  friend_request: "social",
  friend_accepted: "social",
  follow: "social",
  duo_request: "matching",
  duo_accepted: "matching",
  duo_declined: "matching",
  message: "messaging",
  gift: "gifting",
  referral_reward: "referral",
  payment_success: "payment",
  payment_failed: "payment",
  store_purchase: "wallet",
  daily_reward: "wallet",
  moderation: "social",
  security: "social",
};

type NotificationFlags = {
  social: boolean;
  matching: boolean;
  messaging: boolean;
  gifting: boolean;
  wallet: boolean;
  payment: boolean;
  referral: boolean;
};

export async function notify(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  dedupeKey?: string;
  essential?: boolean;
}) {
  if (!input.essential) {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: input.userId },
    });
    const flag = CATEGORY[input.type];
    if (pref && flag && pref[flag] === false) return;
  }
  try {
    await prisma.notification.create({
      data: {
        id: createId("ntf"),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    if (input.dedupeKey && isUniqueError(error)) return;
    throw error;
  }
}

function isUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "P2002",
  );
}
