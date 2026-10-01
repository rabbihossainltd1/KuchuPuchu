/** Pure phone-formatting helpers shared by the Web login UI and Node tests. */
export function buildE164(input, country) {
  const raw = String(input ?? "").trim();
  const dial = String(country?.dial ?? "").replace(/\D/g, "");
  if (!raw || !dial) return null;

  let digits = raw.replace(/\D/g, "");
  const explicitInternational = raw.startsWith("+") || /^00/.test(raw);
  if (!digits) return null;
  if (raw.startsWith("00") && !raw.startsWith("+")) digits = digits.slice(2);

  if (explicitInternational || (digits.startsWith(dial) && digits.length > dial.length + 6)) {
    // Pasted international numbers may accidentally contain the selected
    // country code twice; keep one copy, never prepend a third.
    while (digits.startsWith(dial + dial)) digits = digits.slice(dial.length);
    if (digits.startsWith(dial)) {
      // Some people paste +country-code followed by a national trunk zero.
      digits = dial + digits.slice(dial.length).replace(/^0+/, "");
    }
  } else {
    // Local national form: discard the trunk zero(s), then add the selected
    // country code. The worker receives only canonical E.164.
    digits = dial + digits.replace(/^0+/, "");
  }

  if (!/^\d{8,15}$/.test(digits)) return null;
  // The worker deliberately applies a stricter rule to Bangladesh numbers,
  // even when one is pasted while another country is selected.
  if (digits.startsWith("880") && !/^8801[3-9]\d{8}$/.test(digits)) return null;
  return `+${digits}`;
}

export function validOtp(input) {
  return /^\d{6}$/.test(String(input ?? "").trim());
}
