/**
 * Contact utilities for the web's New contact / All contacts screens.
 *
 * `toE164` is a point-for-point port of the phone's `PhoneBook.toE164`
 * (round 33 item 14 included): Bengali / Arabic-Indic digits become ASCII,
 * `00` becomes `+`, and a home-dial-prefix rule normalises local Bangladeshi
 * numbers before the worker's `/api/contacts/match` lookup.
 */

export type ContactMatchUser = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl: string | null;
  readonly avatarRef: string | null;
};

/** The phone's home country for number normalisation. */
const HOME_DIAL = "880";

/** The phone's `INVITE_TEXT`, verbatim. */
export const INVITE_TEXT =
  "Hey! I'm on KuchuPuchu — fast, private chats and calls. Get it here: " +
  "https://github.com/rabbihossainltd1/KuchuPuchu/releases/latest";

export function toE164(raw: string): string | null {
  // Bengali / Arabic-Indic digits (a number typed on a Bangla keyboard)
  // become ASCII — the phone does the same before its regex check.
  let digits = "";
  for (const ch of raw) {
    if (ch === "+") {
      digits += "+";
      continue;
    }
    const value = ch.codePointAt(0);
    if (value === undefined) continue;
    let ascii = -1;
    if (ch >= "0" && ch <= "9") ascii = value - 48;
    else if (value >= 0x09e6 && value <= 0x09ef)
      ascii = value - 0x09e6; // Bengali
    else if (value >= 0x0660 && value <= 0x0669)
      ascii = value - 0x0660; // Arabic-Indic
    else if (value >= 0x06f0 && value <= 0x06f9) ascii = value - 0x06f0; // Extended Arabic-Indic
    if (ascii >= 0) digits += String(ascii);
  }
  if (digits === "") return null;
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  let full: string;
  if (digits.startsWith("+")) full = digits.slice(1).replace(/\D/g, "");
  else if (digits.startsWith(HOME_DIAL) && digits.length >= HOME_DIAL.length + 8) full = digits;
  else full = HOME_DIAL + digits.replace(/^0+/, "");
  if (!/^[1-9]\d{7,14}$/.test(full)) return null;
  return `+${full}`;
}

/** The phone's WhatsApp-first invite: a wa.me link with the invite text. */
export function inviteUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(INVITE_TEXT)}`;
}

/** Parse the worker's `/api/contacts/match` users array defensively. */
export function parseMatchUsers(payload: unknown): readonly ContactMatchUser[] {
  if (!payload || typeof payload !== "object") return [];
  const users = (payload as { users?: unknown }).users;
  if (!Array.isArray(users)) return [];
  return users
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? ""),
      displayName: String(item.displayName ?? ""),
      username: String(item.username ?? ""),
      avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : null,
      avatarRef: typeof item.avatarRef === "string" ? item.avatarRef : null,
    }))
    .filter((user) => user.id !== "");
}
