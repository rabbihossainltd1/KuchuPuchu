import { describe, expect, it } from "vitest";
import { assertGiftableTransfer, evaluateReferral } from "./referral.js";
import { summarizeReputation } from "./reputation.js";
import { applyPrivacy } from "./privacy.js";
import { hasPermission } from "./rbac.js";

describe("referral eligibility", () => {
  const base = {
    referrerId: "a",
    refereeId: "b",
    referrerStatus: "ACTIVE",
    refereeStatus: "ACTIVE",
    refereeEmailVerified: true,
    requireEmailVerification: true,
    selfReferral: false,
    alreadyAttributed: false,
    suspicious: false,
  };

  it("rewards a clean referral", () => {
    expect(evaluateReferral(base).eligible).toBe(true);
  });

  it("blocks self-referral and unverified accounts", () => {
    expect(evaluateReferral({ ...base, selfReferral: true }).eligible).toBe(false);
    expect(evaluateReferral({ ...base, refereeEmailVerified: false }).holdReason).toBe(
      "email_unverified",
    );
    expect(evaluateReferral({ ...base, suspicious: true }).holdReason).toBe("held_for_review");
  });
});

describe("gifting rules", () => {
  it("prevents self-gift and blocked transfers", () => {
    expect(() =>
      assertGiftableTransfer({
        senderId: "a",
        receiverId: "a",
        ownedBy: "a",
        giftable: true,
        blocked: false,
        allowGifts: true,
      }),
    ).toThrow();
    expect(() =>
      assertGiftableTransfer({
        senderId: "a",
        receiverId: "b",
        ownedBy: "a",
        giftable: true,
        blocked: true,
        allowGifts: true,
      }),
    ).toThrow();
  });
});

describe("privacy and reputation", () => {
  it("hides private fields from strangers", () => {
    const view = applyPrivacy({
      isSelf: false,
      isAdmin: false,
      privacy: {
        showCountry: true,
        showDistrict: false,
        showApproximateArea: false,
        showRelationship: false,
        showFfUid: false,
        allowMessages: "EVERYONE",
        allowRequests: "EVERYONE",
        allowGifts: "EVERYONE",
        discoverable: true,
      },
      profile: {
        userId: "u",
        displayName: "A",
        username: "a",
        avatarUrl: null,
        bio: null,
        country: "BD",
        district: "Rajshahi",
        approximateArea: "Boalia",
        ffUid: "12345678",
        ffIgn: "player",
        serverRegion: "SOUTH_ASIA",
        level: 50,
        rank: "GOLD",
        preferredModes: [],
        playStyle: null,
        languages: [],
        availability: [],
        micPreference: null,
        relationshipStatus: "SINGLE",
        facebookId: null,
        instagram: null,
        whatsapp: null,
        verifiedFf: false,
        verifiedIdentity: false,
        reputation: 40,
        lastActiveAt: new Date().toISOString(),
        online: false,
      },
    });
    expect(view.country).toBe("BD");
    expect(view.district).toBeNull();
    expect(view.ffUid).toBeNull();
    expect(view.relationshipStatus).toBeNull();
  });

  it("clamps reputation", () => {
    expect(summarizeReputation([{ delta: 400 }])).toBe(100);
    expect(summarizeReputation([{ delta: -400 }])).toBe(0);
  });

  it("scopes admin permissions", () => {
    expect(hasPermission("FINANCE_ADMIN", "ledger.grant")).toBe(true);
    expect(hasPermission("FINANCE_ADMIN", "users.moderate")).toBe(false);
    expect(hasPermission("SUPER_ADMIN", "users.moderate")).toBe(true);
  });
});
