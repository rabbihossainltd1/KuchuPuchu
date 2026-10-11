/**
 * Schedule-sheet helpers, ported from the phone's ChatScreen.kt
 * (`ScheduleSheet`, `scheduleStamp`, `ScheduledChip`): the same four quick
 * picks, the same custom day/hour/minute/AM-PM picker and the same
 * "Today 9:30 PM / Tomorrow 8:00 AM / 12 Sep 8:00 AM" stamp.
 */

export type QuickPick = { readonly label: string; readonly at: Date };

/** The phone's quick list: In 1 hour / Tonight 9 PM / Tomorrow 8 AM / 6 PM. */
export function quickPicks(now: Date): readonly QuickPick[] {
  const base = new Date(now);
  base.setSeconds(0, 0);
  const tonight = new Date(base);
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() <= base.getTime()) tonight.setDate(tonight.getDate() + 1);
  const tomorrow8 = new Date(base);
  tomorrow8.setDate(tomorrow8.getDate() + 1);
  tomorrow8.setHours(8, 0, 0, 0);
  const tomorrow6 = new Date(base);
  tomorrow6.setDate(tomorrow6.getDate() + 1);
  tomorrow6.setHours(18, 0, 0, 0);
  const inHour = new Date(base);
  inHour.setHours(inHour.getHours() + 1);
  return [
    { label: "In 1 hour", at: inHour },
    { label: "Tonight 9 PM", at: tonight },
    { label: "Tomorrow 8 AM", at: tomorrow8 },
    { label: "Tomorrow 6 PM", at: tomorrow6 },
  ];
}

export const DAY_OPTIONS = [
  { offset: 0, label: "Today" },
  { offset: 1, label: "Tomorrow" },
  { offset: 2, label: "In 2 days" },
  { offset: 7, label: "In a week" },
] as const;

/** The custom picker's day offset + 12-hour clock, exactly the phone's math. */
export function customPick(
  now: Date,
  dayOffset: number,
  hour12: number,
  minute: number,
  pm: boolean,
): Date {
  const picked = new Date(now);
  picked.setDate(picked.getDate() + dayOffset);
  picked.setHours((hour12 % 12) + (pm ? 12 : 0), minute, 0, 0);
  return picked;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Today 9:30 PM" / "Tomorrow 8:00 AM" / "12 Sep 8:00 AM". */
export function scheduleStamp(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const at = new Date(time);
  const now = new Date();
  const clockHour = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12;
  const clock = `${clockHour}:${String(at.getMinutes()).padStart(2, "0")} ${
    at.getHours() >= 12 ? "PM" : "AM"
  }`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = sameDay(at, now)
    ? "Today"
    : sameDay(at, tomorrow)
      ? "Tomorrow"
      : `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return `${day} ${clock}`;
}

export type ScheduledRow = {
  readonly id: string;
  readonly preview: string;
  readonly sendAt: string;
};

/** Parse the worker's `GET /api/conversations/:id/scheduled` items. */
export function parseScheduledRows(payload: unknown): readonly ScheduledRow[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? ""),
      preview: String(item.preview ?? item.body ?? ""),
      sendAt: String(item.sendAt ?? ""),
    }))
    .filter((row) => row.id !== "");
}
