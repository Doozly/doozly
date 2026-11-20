// @vitest-environment node
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { atTime, formatReminder, formatTime, reminderPicks } from "./times.ts";

beforeAll(() => {
  vi.stubEnv("TZ", "Europe/London");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const at = (d: number, h: number, min = 0) =>
  new Date(2026, 10, d, h, min).getTime();

test("quick picks from a Thursday afternoon", () => {
  const picks = reminderPicks(at(19, 14, 20));
  expect(
    picks.map((p) => [p.label, formatReminder(p.at, "2026-11-19")]),
  ).toEqual([
    ["Later today", "Today, 18:00"],
    ["Tomorrow", "Tomorrow, 09:00"],
    ["Next week", "Mon 23 Nov, 09:00"],
  ]);
});

test("on the hour, later today is three hours on", () => {
  expect(formatTime(reminderPicks(at(19, 9))[0]?.at ?? 0)).toBe("12:00");
});

test("late in the evening there's no later today", () => {
  const picks = reminderPicks(at(19, 21, 5));
  expect(picks.map((p) => p.id)).toEqual(["tomorrow", "nextWeek"]);
});

test("9 o'clock stays 9 o'clock over the clock change", () => {
  // UK clocks go back on 25 October 2026
  const picks = reminderPicks(new Date(2026, 9, 24, 12).getTime());
  expect(formatTime(picks[1]?.at ?? 0)).toBe("09:00");
  expect(atTime("2026-10-25", 9)).toBe(new Date(2026, 9, 25, 9).getTime());
});
