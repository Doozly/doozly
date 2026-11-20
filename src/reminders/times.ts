import { addDays, formatDue, nextWeek, today } from "../data/localDate.ts";
import type { LocalDate } from "../data/model.ts";

const HOUR = 60 * 60 * 1000;

/** That day at that wall-clock time, here */
export function atTime(day: LocalDate, hour: number, minute = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute).getTime();
}

/** "09:00", always 24-hour like the rest of the UK-style dates */
export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** "Today, 15:00" or "Mon 23 Nov, 09:00", for the task row */
export function formatReminder(ms: number, now: LocalDate = today()): string {
  return `${formatDue(today(ms), now)}, ${formatTime(ms)}`;
}

export interface ReminderPick {
  id: "later" | "tomorrow" | "nextWeek";
  label: string;
  at: number;
}

/**
 * The quick picks: three hours on from the next full hour, tomorrow at 9, and
 * Monday at 9. Later today goes away in the evening, when it'd be tomorrow.
 */
export function reminderPicks(now = Date.now()): ReminderPick[] {
  const day = today(now);
  const nextHour = Math.ceil(now / HOUR) * HOUR;
  const later = new Date(nextHour + 3 * HOUR);
  later.setMinutes(0, 0, 0);
  const picks: ReminderPick[] = [];
  if (today(later.getTime()) === day) {
    picks.push({ id: "later", label: "Later today", at: later.getTime() });
  }
  picks.push(
    { id: "tomorrow", label: "Tomorrow", at: atTime(addDays(day, 1), 9) },
    { id: "nextWeek", label: "Next week", at: atTime(nextWeek(day), 9) },
  );
  return picks;
}
