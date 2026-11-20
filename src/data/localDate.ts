import type { LocalDate } from "./model.ts";

// Plain calendar dates. Everything goes through local Date(y, m, d), never UTC,
// also a due date never slides to the day before for someone west of Greenwich.

function toDate(d: LocalDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
}

function fromDate(date: Date): LocalDate {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(now = Date.now()): LocalDate {
  return fromDate(new Date(now));
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const date = toDate(d);
  date.setDate(date.getDate() + days);
  return fromDate(date);
}

/** Whole days from `a` to `b`, negative when `b` is earlier */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  // Rounding swallows the hour a DST change adds or takes
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** The Monday after `d`, which is what To Do means by "next week" */
export function nextWeek(d: LocalDate): LocalDate {
  const weekday = toDate(d).getDay(); // Sunday is 0
  const toMonday = (8 - weekday) % 7 || 7;
  return addDays(d, toMonday);
}

/** Short weekday, like "Wed" */
export function weekdayOf(d: LocalDate): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(
    toDate(d),
  );
}

/**
 * How a due date reads: "Today", "Tomorrow", "Yesterday", else "Wed 26 November",
 * with the year when it isn't this one. `long` spells the month out.
 */
export function formatDue(
  d: LocalDate,
  now: LocalDate = today(),
  { long = false } = {},
): string {
  if (d === now) return "Today";
  if (d === addDays(now, 1)) return "Tomorrow";
  if (d === addDays(now, -1)) return "Yesterday";
  const sameYear = d.slice(0, 4) === now.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: long ? "long" : "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(toDate(d))
    .replace(",", "");
}

/** YYYY-MM-DD compares correctly as plain text */
export function isBefore(a: LocalDate, b: LocalDate): boolean {
  return a < b;
}

/** A task is in My Day only on the day it was added, that's the daily reset */
export function inMyDay(
  task: { myDay: LocalDate | null },
  now: LocalDate = today(),
): boolean {
  return task.myDay === now;
}

export type DueBucket =
  | "Earlier"
  | "Today"
  | "Tomorrow"
  | "This week"
  | "Later";

export const DUE_BUCKETS: DueBucket[] = [
  "Earlier",
  "Today",
  "Tomorrow",
  "This week",
  "Later",
];

/** Sunday that ends the week of `d`. Weeks run Monday to Sunday, the UK way. */
export function endOfWeek(d: LocalDate): LocalDate {
  const weekday = toDate(d).getDay(); // Sunday is 0
  return addDays(d, (7 - weekday) % 7);
}

/** Which Planned group a due date falls in */
export function dueBucket(due: LocalDate, now: LocalDate = today()): DueBucket {
  if (due < now) return "Earlier";
  if (due === now) return "Today";
  if (due === addDays(now, 1)) return "Tomorrow";
  if (due <= endOfWeek(now)) return "This week";
  return "Later";
}
