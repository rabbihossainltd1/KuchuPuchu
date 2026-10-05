/**
 * Dhaka-zone time primitives shared by the surfaces that stamp a row.
 *
 * The phone keeps one `listStamp` in `Theme.kt` and one `DHAKA` zone constant,
 * and every list — chats, statuses, calls, viewers — reads through them. The Web
 * had that logic inside the status model, which the Calls tab would then have had
 * to import across features (dragging the whole status model into the calls
 * chunk for one timestamp). So the primitives live here and both features use
 * them; `statusModel.ts` re-exports `listStamp` so nothing that already imported
 * it moved.
 *
 * The zone is fixed on purpose: a list must read the same in Dhaka and on a
 * laptop set to something else, because the rows it describes were written by
 * one server clock.
 */

export const DHAKA = "Asia/Dhaka";

export type DhakaParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayIndex(short: string): number {
  const index = WEEKDAYS.indexOf(short.slice(0, 3));
  return index < 0 ? 0 : index;
}

/** `z.dayOfWeek.toString().take(3)` with only the first letter capitalised. */
export function weekdayLabel(index: number): string {
  const short = WEEKDAYS[index] ?? "Mon";
  return short[0]! + short.slice(1).toLowerCase();
}

export function monthLabel(month: number): string {
  const short = MONTHS[month - 1] ?? "Jan";
  return short[0]! + short.slice(1).toLowerCase();
}

/** The phone's `%d:%02d %s` with a 12-hour clock: "4:39 PM". */
export function clockLabel(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function dhakaParts(isoText: string): DhakaParts | null {
  const time = Date.parse(isoText);
  if (!Number.isFinite(time)) return null;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: DHAKA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(time))) parts[part.type] = part.value;
  const hour24 = Number(parts.hour ?? "0") % 24;
  return {
    year: Number(parts.year ?? 0),
    month: Number(parts.month ?? 0),
    day: Number(parts.day ?? 0),
    hour: hour24,
    minute: Number(parts.minute ?? 0),
    weekday: weekdayIndex(parts.weekday ?? ""),
  };
}

/** Calendar days between two Dhaka dates, from the epoch-day difference. */
export function daysBetween(from: DhakaParts, to: DhakaParts): number {
  const epochDay = (parts: DhakaParts) =>
    Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
  return Math.round(epochDay(to) - epochDay(from));
}

/**
 * The shared row stamp — `listStamp` in Theme.kt: today is a clock time,
 * yesterday is the phone's own abbreviation "Yes" (copied, not corrected),
 * inside a week is a weekday, and older is "5 Oct". An unparseable timestamp
 * yields "" so a row never prints "NaN".
 */
export function listStamp(isoText: string, nowMs: number = Date.now()): string {
  if (!isoText) return "";
  const then = dhakaParts(isoText);
  const now = dhakaParts(new Date(nowMs).toISOString());
  if (!then || !now) return "";
  const days = daysBetween(then, now);
  if (days === 0) return clockLabel(then.hour, then.minute);
  if (days === 1) return "Yes";
  if (days < 7) return weekdayLabel(then.weekday);
  return `${then.day} ${monthLabel(then.month)}`;
}
