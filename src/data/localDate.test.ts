import { expect, test } from "vitest";
import {
  addDays,
  dueBucket,
  endOfWeek,
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

test("Planned buckets around the week, Monday to Sunday", () => {
  const thu = "2026-11-19";
  expect(dueBucket("2026-11-01", thu)).toBe("Earlier");
  expect(dueBucket("2026-11-18", thu)).toBe("Earlier");
  expect(dueBucket(thu, thu)).toBe("Today");
  expect(dueBucket("2026-11-20", thu)).toBe("Tomorrow");
  expect(dueBucket("2026-11-21", thu)).toBe("This week");
  expect(dueBucket("2026-11-22", thu)).toBe("This week"); // Sunday ends it
  expect(dueBucket("2026-11-23", thu)).toBe("Later"); // next Monday
});

test("at the end of the week there is no This week left", () => {
  const sat = "2026-11-21";
  expect(dueBucket("2026-11-22", sat)).toBe("Tomorrow");
  expect(dueBucket("2026-11-23", sat)).toBe("Later");
  const sun = "2026-11-22";
  expect(endOfWeek(sun)).toBe(sun);
  expect(dueBucket("2026-11-23", sun)).toBe("Tomorrow");
  expect(dueBucket("2026-11-24", sun)).toBe("Later");
});

test("buckets cross month and year ends", () => {
  expect(dueBucket("2026-12-01", "2026-11-30")).toBe("Tomorrow");
  expect(dueBucket("2027-01-03", "2026-12-31")).toBe("This week");
  expect(dueBucket("2027-01-04", "2026-12-31")).toBe("Later");
  expect(dueBucket("2026-12-31", "2027-01-01")).toBe("Earlier");
});

test("clock changes don't move anything", () => {
  // UK clocks go forward on 29 March 2026 and back on 25 October 2026
  expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
  expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  expect(dueBucket("2026-03-29", "2026-03-28")).toBe("Tomorrow");
  expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  expect(endOfWeek("2026-10-21")).toBe("2026-10-25");
  expect(today(new Date(2026, 2, 29, 0, 30).getTime())).toBe("2026-03-29");
});
