import { customAlphabet } from "nanoid";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 21);

export function createId(prefix?: string): string {
  return prefix ? `${prefix}_${nanoid()}` : nanoid();
}

export function createReferralCode(): string {
  return customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8)();
}

export function createUsernameSeed(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
  const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4)();
  return `${cleaned || "player"}_${suffix}`;
}
