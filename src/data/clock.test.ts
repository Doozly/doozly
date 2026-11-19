import { expect, test } from "vitest";
import { stamp, stampTime } from "./clock.ts";

test("stamps sort in the order they were made", () => {
  const made = Array.from({ length: 50 }, (_, i) => stamp(1_000 + (i % 3)));
  expect([...made].sort()).toEqual(made);
  expect(new Set(made).size).toBe(made.length);
});

test("never goes backwards when the wall clock does", () => {
  const a = stamp(5_000_000);
  const b = stamp(4_000_000);
  expect(b > a).toBe(true);
  expect(stampTime(b)).toBe(5_000_000);
});

test("keeps the wall time readable", () => {
  const now = Date.UTC(2026, 10, 19);
  expect(stampTime(stamp(now))).toBe(now);
});
