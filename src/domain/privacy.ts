export type PrivacySettingsInput = {
  showCountry: boolean;
  showDistrict: boolean;
  showApproximateArea: boolean;
  showRelationship: boolean;
  showFfUid: boolean;
  allowMessages: "EVERYONE" | "FRIENDS" | "NONE";
  allowRequests: "EVERYONE" | "FRIENDS" | "NONE";
  allowGifts: "EVERYONE" | "FRIENDS" | "NONE";
  discoverable: boolean;
};

export type PublicProfileView = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  district: string | null;
  approximateArea: string | null;
  ffUid: string | null;
  ffIgn: string | null;
  serverRegion: string | null;
  level: number | null;
  rank: string | null;
  preferredModes: string[];
  playStyle: string | null;
  languages: string[];
  availability: string[];
  micPreference: string | null;
  relationshipStatus: string | null;
  verifiedFf: boolean;
  verifiedIdentity: boolean;
  reputation: number;
  lastActiveAt: string;
  online: boolean;
};

export function applyPrivacy(input: {
  isSelf: boolean;
  isAdmin: boolean;
  privacy: PrivacySettingsInput;
  profile: Omit<
    PublicProfileView,
    "country" | "district" | "approximateArea" | "ffUid" | "relationshipStatus"
  > & {
    country: string | null;
    district: string | null;
    approximateArea: string | null;
    ffUid: string | null;
    relationshipStatus: string | null;
  };
}): PublicProfileView {
  if (input.isSelf || input.isAdmin) {
    return input.profile;
  }
  const p = input.privacy;
  return {
    ...input.profile,
    country: p.showCountry ? input.profile.country : null,
    district: p.showDistrict ? input.profile.district : null,
    approximateArea: p.showApproximateArea ? input.profile.approximateArea : null,
    ffUid: p.showFfUid ? input.profile.ffUid : null,
    relationshipStatus: p.showRelationship ? input.profile.relationshipStatus : null,
  };
}

export function canInteract(setting: "EVERYONE" | "FRIENDS" | "NONE", isFriend: boolean): boolean {
  if (setting === "NONE") return false;
  if (setting === "FRIENDS") return isFriend;
  return true;
}
