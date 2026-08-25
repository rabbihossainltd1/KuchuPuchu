export type Privacy = {
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

export type Me = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  district: string | null;
  approximateArea: string | null;
  status: string;
  referralCode: string;
  referralLink: string;
  lastActiveAt: string;
  createdAt: string;
  reputation: number;
  adminRole: string | null;
  wallet: { balance: number };
  profile: {
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
    ageRange: string | null;
    gender: string | null;
    genderPreference: string | null;
    relationshipStatus: string | null;
    facebookId: string | null;
    instagram: string | null;
    whatsapp: string | null;
    verifiedFf: boolean;
    verifiedIdentity: boolean;
    onboardingComplete: boolean;
  };
  privacy: Privacy;
  notificationPreferences: {
    social: boolean;
    matching: boolean;
    messaging: boolean;
    gifting: boolean;
    wallet: boolean;
    payment: boolean;
    referral: boolean;
  } | null;
};

export type PublicUser = {
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
  facebookId: string | null;
  instagram: string | null;
  whatsapp: string | null;
  verifiedFf: boolean;
  verifiedIdentity: boolean;
  reputation: number;
  lastActiveAt: string;
  online: boolean;
  score?: number;
  reasons?: string[];
};

export const LABELS: Record<string, string> = {
  SOUTH_ASIA: "South Asia",
  INDIA: "India",
  SINGAPORE: "Singapore",
  EUROPE: "Europe",
  NORTH_AMERICA: "North America",
  LATIN_AMERICA: "Latin America",
  MIDDLE_EAST: "Middle East",
  THAILAND: "Thailand",
  INDONESIA: "Indonesia",
  BRAZIL: "Brazil",
  TAIWAN: "Taiwan",
  BATTLE_ROYALE: "Battle Royale",
  CLASH_SQUAD: "Clash Squad",
  LONE_WOLF: "Lone Wolf",
  CS_RANKED: "CS Ranked",
  BR_RANKED: "BR Ranked",
  CRAFTLAND: "Craftland",
  AGGRESSIVE: "Aggressive",
  PASSIVE: "Passive",
  SUPPORT: "Support",
  RUSHER: "Rusher",
  SNIPER: "Sniper",
  IGL: "IGL",
  FLEX: "Flex",
  MIC_ON: "Mic on",
  MIC_OFF: "Mic off",
  OPTIONAL: "Mic optional",
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
  DIAMOND: "Diamond",
  HEROIC: "Heroic",
  GRANDMASTER: "Grandmaster",
  bn: "বাংলা",
  en: "English",
  hi: "हिन्दी",
  banners: "Banners",
  frames: "Frames",
  badges: "Badges",
  themes: "Themes",
  name_styles: "Name styles",
  profile_decorations: "Decorations",
  boosts: "Boosts",
  limited: "Limited",
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
  "13_17": "13–17",
  "18_24": "18–24",
  "25_30": "25–30",
  "31_PLUS": "31+",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
  weekend: "Weekend",
  ANY: "Anyone",
  MALE: "Male",
  FEMALE: "Female",
  NON_BINARY: "Non-binary",
  UNDISCLOSED: "Prefer not to say",
  PREFER_NOT: "Prefer not to say",
  SINGLE: "Single",
  TAKEN: "Taken",
  COMPLICATED: "It's complicated",
};

export function label(value?: string | null) {
  if (!value) return "—";
  return LABELS[value] ?? value.replaceAll("_", " ");
}
