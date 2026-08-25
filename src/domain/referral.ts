import { AppError } from "../shared/errors.js";

export type ReferralEligibility = {
  eligible: boolean;
  holdReason?: string;
};

export function evaluateReferral(input: {
  referrerId: string;
  refereeId: string;
  referrerStatus: string;
  refereeStatus: string;
  refereeEmailVerified: boolean;
  requireEmailVerification: boolean;
  selfReferral: boolean;
  alreadyAttributed: boolean;
  suspicious: boolean;
}): ReferralEligibility {
  if (input.selfReferral || input.referrerId === input.refereeId) {
    return { eligible: false, holdReason: "self_referral" };
  }
  if (input.alreadyAttributed) {
    return { eligible: false, holdReason: "already_attributed" };
  }
  if (input.referrerStatus !== "ACTIVE" || input.refereeStatus !== "ACTIVE") {
    return { eligible: false, holdReason: "account_not_active" };
  }
  if (input.requireEmailVerification && !input.refereeEmailVerified) {
    return { eligible: false, holdReason: "email_unverified" };
  }
  if (input.suspicious) {
    return { eligible: false, holdReason: "held_for_review" };
  }
  return { eligible: true };
}

export function assertGiftableTransfer(input: {
  senderId: string;
  receiverId: string;
  ownedBy: string;
  giftable: boolean;
  blocked: boolean;
  allowGifts: boolean;
}): void {
  if (input.senderId === input.receiverId) {
    throw new AppError("SELF_GIFT", "You cannot gift this item to yourself.", 400);
  }
  if (input.ownedBy !== input.senderId) {
    throw new AppError("NOT_OWNER", "You do not own this item.", 403);
  }
  if (!input.giftable) {
    throw new AppError("NOT_GIFTABLE", "This item cannot be gifted.", 400);
  }
  if (input.blocked) {
    throw new AppError("BLOCKED", "Gifting is not allowed between these accounts.", 403);
  }
  if (!input.allowGifts) {
    throw new AppError("GIFTS_DISABLED", "This player is not accepting gifts.", 403);
  }
}
