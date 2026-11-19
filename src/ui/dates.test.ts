import { expect, test } from "vitest";
import { relativeDay } from "./dates.ts";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).getTime();

test("today and yesterday by calendar day, not by 24 hours", () => {
  const now = at(2026, 11, 19, 0);
  expect(relativeDay(at(2026, 11, 19, 0), at(2026, 11, 19, 23))).toBe("today");
  expect(relativeDay(at(2026, 11, 18, 23), now)).toBe("yesterday");
});

test("older days get the date, and the year only when it differs", () => {
  const now = at(2026, 11, 19);
  expect(relativeDay(at(2026, 11, 17), now)).toBe("on Tue 17 November");
  expect(relativeDay(at(2025, 3, 2), now)).toBe("on Sun 2 March 2025");
});
