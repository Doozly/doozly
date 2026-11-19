import { expect, test } from "vitest";
import {
  addDays,
  formatDue,
  inMyDay,
  isBefore,
  nextWeek,
  today,
  weekdayOf,
} from "./localDate.ts";

test("today is the local calendar day, also late in the evening", () => {
  expect(today(new Date(2026, 10, 19, 23, 59).getTime())).toBe("2026-11-19");
  expect(today(new Date(2026, 0, 1, 0, 0).getTime())).toBe("2026-01-01");
});

test("adding days crosses months, years and leap days", () => {
  expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

test("next week is always the coming Monday", () => {
  expect(nextWeek("2026-11-19")).toBe("2026-11-23"); // Thursday
  expect(nextWeek("2026-11-22")).toBe("2026-11-23"); // Sunday
  expect(nextWeek("2026-11-23")).toBe("2026-11-30"); // Monday itself
  expect(weekdayOf("2026-11-23")).toBe("Mon");
});

test("due dates read like people say them", () => {
  const now = "2026-11-19";
  expect(formatDue("2026-11-19", now)).toBe("Today");
  expect(formatDue("2026-11-20", now)).toBe("Tomorrow");
  expect(formatDue("2026-11-18", now)).toBe("Yesterday");
  expect(formatDue("2026-11-26", now)).toBe("Thu 26 Nov");
  expect(formatDue("2026-11-26", now, { long: true })).toBe("Thu 26 November");
  expect(formatDue("2027-01-04", now)).toBe("Mon 4 Jan 2027");
});

test("dates compare as text", () => {
  expect(isBefore("2026-11-18", "2026-11-19")).toBe(true);
  expect(isBefore("2026-11-19", "2026-11-19")).toBe(false);
});

test("in My Day only on the day it was added", () => {
  expect(inMyDay({ myDay: "2026-11-19" }, "2026-11-19")).toBe(true);
  expect(inMyDay({ myDay: "2026-11-18" }, "2026-11-19")).toBe(false);
  expect(inMyDay({ myDay: null }, "2026-11-19")).toBe(false);
});
