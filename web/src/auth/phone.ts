export type PhoneCountry = {
  iso: string;
  name: string;
  dial: string;
};

/** Keep the browser formatter byte-for-byte compatible with the legacy login contract. */
export function buildE164(input: unknown, country: PhoneCountry | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  const dial = String(country?.dial ?? "").replace(/\D/g, "");
  if (!raw || !dial) return null;

  let digits = raw.replace(/\D/g, "");
  const explicitInternational = raw.startsWith("+") || /^00/.test(raw);
  if (!digits) return null;
  if (raw.startsWith("00") && !raw.startsWith("+")) digits = digits.slice(2);

  if (explicitInternational || (digits.startsWith(dial) && digits.length > dial.length + 6)) {
    while (digits.startsWith(dial + dial)) digits = digits.slice(dial.length);
    if (digits.startsWith(dial)) {
      digits = dial + digits.slice(dial.length).replace(/^0+/, "");
    }
  } else {
    digits = dial + digits.replace(/^0+/, "");
  }

  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith("880") && !/^8801[3-9]\d{8}$/.test(digits)) return null;
  return `+${digits}`;
}

export function validOtp(input: unknown): boolean {
  return /^\d{6}$/.test(String(input ?? "").trim());
}
