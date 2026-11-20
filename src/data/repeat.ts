import { addDays, daysBetween, today } from "./localDate.ts";
import type { LocalDate, RepeatRule, Task, Weekday } from "./model.ts";

export type RepeatPreset =
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "yearly";

const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];

function parts(d: LocalDate): [number, number, number] {
  const [y, m, day] = d.split("-").map(Number);
  return [y ?? 1970, m ?? 1, day ?? 1];
}

function format(y: number, m: number, d: number): LocalDate {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

// UTC only to read the weekday, so the time zone can't make it off by one
export function dayOfWeek(d: LocalDate): Weekday {
  const [y, m, day] = parts(d);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay() as Weekday;
}

/** Place in a Monday-to-Sunday week, the same weeks Planned uses */
function weekPlace(w: Weekday): number {
  return (w + 6) % 7;
}

function intervalOf(rule: RepeatRule): number {
  const n = Math.floor(rule.interval);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function weekdaysOf(rule: RepeatRule): Weekday[] {
  const days = [...new Set(rule.weekdays ?? [])];
  return days.sort((a, b) => weekPlace(a) - weekPlace(b));
}

/** The rule behind each entry of the Repeat menu, for a task due on `on` */
export function presetRule(preset: RepeatPreset, on: LocalDate): RepeatRule {
  switch (preset) {
    case "daily":
      return { unit: "day", interval: 1 };
    case "weekdays":
      return { unit: "week", interval: 1, weekdays: [...WORKDAYS] };
    case "weekly":
      return { unit: "week", interval: 1, weekdays: [dayOfWeek(on)] };
    case "monthly":
      return { unit: "month", interval: 1, monthDay: parts(on)[2] };
    case "yearly":
      return { unit: "year", interval: 1, monthDay: parts(on)[2] };
  }
}

function addMonths(
  from: LocalDate,
  months: number,
  anchor?: number,
): LocalDate {
  const [y, m, d] = parts(from);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return format(year, month, Math.min(anchor ?? d, daysInMonth(year, month)));
}

/** The occurrence after `from`. `from` itself needn't match the rule. */
export function nextOccurrence(rule: RepeatRule, from: LocalDate): LocalDate {
  const n = intervalOf(rule);
  switch (rule.unit) {
    case "day":
      return addDays(from, n);
    case "month":
      return addMonths(from, n, rule.monthDay);
    case "year":
      return addMonths(from, 12 * n, rule.monthDay);
    case "week": {
      const days = weekdaysOf(rule);
      if (days.length === 0) return addDays(from, 7 * n);
      const place = weekPlace(dayOfWeek(from));
      const later = days.find((w) => weekPlace(w) > place);
      if (later !== undefined) return addDays(from, weekPlace(later) - place);
      // Nothing left this week, also jump `n` weeks and take the first chosen day
      const monday = addDays(from, -place);
      return addDays(monday, 7 * n + weekPlace(days[0] as Weekday));
    }
  }
}

/** `from` when the rule falls on it, else the next day it does */
export function firstOccurrence(rule: RepeatRule, from: LocalDate): LocalDate {
  const days = weekdaysOf(rule);
  if (rule.unit !== "week" || days.length === 0) return from;
  if (days.includes(dayOfWeek(from))) return from;
  // The first one is just the next chosen day, the interval only counts after it
  return nextOccurrence({ ...rule, interval: 1 }, from);
}

/**
 * Due date and reminder for the copy a repeating task leaves behind when it's
 * completed. Counts on from the due date, like To Do, not from the day it was done.
 * The reminder keeps its wall-clock time, also across a DST change.
 */
export function nextDates(
  task: Pick<Task, "repeat" | "dueDate" | "reminderAt">,
  now: LocalDate = today(),
): Pick<Task, "dueDate" | "reminderAt"> | null {
  if (!task.repeat) return null;
  const base =
    task.dueDate ??
    (task.reminderAt !== null ? today(task.reminderAt) : null) ??
    now;
  const dueDate = nextOccurrence(task.repeat, base);
  if (task.reminderAt === null) return { dueDate, reminderAt: null };
  const reminder = new Date(task.reminderAt);
  reminder.setDate(reminder.getDate() + daysBetween(base, dueDate));
  return { dueDate, reminderAt: reminder.getTime() };
}
