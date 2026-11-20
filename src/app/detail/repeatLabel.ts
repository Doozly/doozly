import type { RepeatRule, Weekday } from "../../data/model.ts";

/** Monday first, like the calendar */
export const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const UNIT_WORDS = {
  day: ["Daily", "day", "days"],
  week: ["Weekly", "week", "weeks"],
  month: ["Monthly", "month", "months"],
  year: ["Yearly", "year", "years"],
} as const;

/** "day" or "days", for the unit picker next to the number */
export function unitWord(unit: RepeatRule["unit"], n: number): string {
  return UNIT_WORDS[unit][n === 1 ? 1 : 2];
}

/** "Daily", "Weekdays", "Every 2 weeks", "Weekly, Mon, Wed" */
export function describeRepeat(rule: RepeatRule): string {
  const days = new Set(rule.weekdays ?? []);
  const workdays =
    days.size === 5 && ([1, 2, 3, 4, 5] as Weekday[]).every((d) => days.has(d));
  if (rule.unit === "week" && rule.interval === 1 && workdays) {
    return "Weekdays";
  }
  const every =
    rule.interval === 1
      ? UNIT_WORDS[rule.unit][0]
      : `Every ${rule.interval} ${unitWord(rule.unit, rule.interval)}`;
  if (rule.unit !== "week" || days.size < 2) return every;
  const names = WEEK.filter((d) => days.has(d)).map((d) =>
    DAY_NAMES[d]?.slice(0, 3),
  );
  return `${every}, ${names.join(", ")}`;
}
