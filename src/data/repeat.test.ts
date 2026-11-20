import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { RepeatRule, Weekday } from "./model.ts";
import {
  daysInMonth,
  firstOccurrence,
  nextDates,
  nextOccurrence,
  presetRule,
} from "./repeat.ts";

// Steps a rule `times` times, to see where it lands after a while
function walk(rule: RepeatRule, from: string, times: number): string[] {
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < times; i++) {
    d = nextOccurrence(rule, d);
    out.push(d);
  }
  return out;
}

describe("days", () => {
  test("daily crosses months and years", () => {
    const daily = presetRule("daily", "2026-12-30");
    expect(walk(daily, "2026-12-30", 3)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  test("every 3 days, over a leap day", () => {
    expect(nextOccurrence({ unit: "day", interval: 3 }, "2028-02-27")).toBe(
      "2028-03-01",
    );
  });
});

describe("weeks", () => {
  test("weekdays skip the weekend", () => {
    const rule = presetRule("weekdays", "2026-11-20");
    expect(nextOccurrence(rule, "2026-11-16")).toBe("2026-11-17"); // Mon → Tue
    expect(nextOccurrence(rule, "2026-11-20")).toBe("2026-11-23"); // Fri → Mon
    expect(nextOccurrence(rule, "2026-11-21")).toBe("2026-11-23"); // Sat → Mon
    expect(nextOccurrence(rule, "2026-11-22")).toBe("2026-11-23"); // Sun → Mon
  });

  test("weekly stays on the day it was set on", () => {
    const rule = presetRule("weekly", "2026-11-19");
    expect(rule.weekdays).toEqual([4]);
    expect(walk(rule, "2026-11-19", 2)).toEqual(["2026-11-26", "2026-12-03"]);
  });

  test("weekly with no chosen days is just seven days on", () => {
    expect(nextOccurrence({ unit: "week", interval: 2 }, "2026-11-19")).toBe(
      "2026-12-03",
    );
  });

  test("chosen days fill the week before jumping ahead", () => {
    const rule: RepeatRule = { unit: "week", interval: 2, weekdays: [5, 1, 3] };
    expect(walk(rule, "2026-11-16", 4)).toEqual([
      "2026-11-18", // Wed
      "2026-11-20", // Fri
      "2026-11-30", // Mon, two weeks on
      "2026-12-02",
    ]);
  });

  test("Sunday is the end of the week, not the start", () => {
    const rule: RepeatRule = { unit: "week", interval: 2, weekdays: [0, 1] };
    expect(nextOccurrence(rule, "2026-11-16")).toBe("2026-11-22"); // Mon → Sun
    expect(nextOccurrence(rule, "2026-11-22")).toBe("2026-11-30"); // Sun → Mon
  });

  test("a due date off the chosen days goes to the next one", () => {
    const rule: RepeatRule = { unit: "week", interval: 1, weekdays: [1, 3] };
    expect(nextOccurrence(rule, "2026-11-19")).toBe("2026-11-23"); // Thu → Mon
    expect(firstOccurrence(rule, "2026-11-19")).toBe("2026-11-23");
    expect(firstOccurrence(rule, "2026-11-18")).toBe("2026-11-18");
  });

  test("the first one doesn't wait out the interval", () => {
    const rule: RepeatRule = { unit: "week", interval: 2, weekdays: [1, 3] };
    expect(firstOccurrence(rule, "2026-11-19")).toBe("2026-11-23");
  });

  test("duplicate weekdays don't matter", () => {
    const rule: RepeatRule = { unit: "week", interval: 1, weekdays: [3, 3] };
    expect(nextOccurrence(rule, "2026-11-18")).toBe("2026-11-25");
  });
});

describe("months", () => {
  test("the 31st clamps to short months and comes back", () => {
    const rule = presetRule("monthly", "2026-01-31");
    expect(walk(rule, "2026-01-31", 4)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  test("February gets the 29th in a leap year", () => {
    const rule = presetRule("monthly", "2028-01-30");
    expect(nextOccurrence(rule, "2028-01-30")).toBe("2028-02-29");
  });

  test("without an anchor it takes the day of the date", () => {
    expect(nextOccurrence({ unit: "month", interval: 1 }, "2026-02-28")).toBe(
      "2026-03-28",
    );
  });

  test("every 5 months crosses the year", () => {
    expect(nextOccurrence({ unit: "month", interval: 5 }, "2026-10-15")).toBe(
      "2027-03-15",
    );
  });
});

describe("years", () => {
  test("a leap day lands on the 28th until the next leap year", () => {
    const rule = presetRule("yearly", "2028-02-29");
    expect(walk(rule, "2028-02-29", 4)).toEqual([
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  test("every 2 years", () => {
    expect(nextOccurrence({ unit: "year", interval: 2 }, "2026-11-20")).toBe(
      "2028-11-20",
    );
  });

  test("2100 isn't a leap year, 2000 was", () => {
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

test("a broken interval counts as 1 instead of looping or going back", () => {
  for (const interval of [0, -2, 0.5, Number.NaN]) {
    expect(nextOccurrence({ unit: "day", interval }, "2026-11-20")).toBe(
      "2026-11-21",
    );
  }
});

describe("properties", () => {
  const date = fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.toISOString().slice(0, 10));
  const weekday = fc.integer({ min: 0, max: 6 }) as fc.Arbitrary<Weekday>;
  const rule: fc.Arbitrary<RepeatRule> = fc.oneof(
    fc.record({
      unit: fc.constantFrom("day", "month", "year" as const),
      interval: fc.integer({ min: 1, max: 30 }),
      monthDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: undefined }),
    }),
    fc.record({
      unit: fc.constant("week" as const),
      interval: fc.integer({ min: 1, max: 8 }),
      weekdays: fc.array(weekday, { maxLength: 7 }),
    }),
  );

  test("the next occurrence is always later", () => {
    fc.assert(fc.property(rule, date, (r, d) => nextOccurrence(r, d) > d));
  });

  test("chosen weekdays are the only ones it lands on", () => {
    fc.assert(
      fc.property(rule, date, (r, d) => {
        if (r.unit !== "week" || !r.weekdays?.length) return true;
        const next = nextOccurrence(r, d);
        const w = new Date(`${next}T00:00:00Z`).getUTCDay() as Weekday;
        return r.weekdays.includes(w);
      }),
    );
  });

  test("monthly lands on the anchor or the month's last day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 31 }), date, (anchor, d) => {
        const next = nextOccurrence(
          { unit: "month", interval: 1, monthDay: anchor },
          d,
        );
        const [y, m, day] = next.split("-").map(Number) as [
          number,
          number,
          number,
        ];
        return day === Math.min(anchor, daysInMonth(y, m));
      }),
    );
  });
});

describe("the copy left behind on complete", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "Europe/London");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const at = (y: number, m: number, d: number, h: number, min = 0) =>
    new Date(y, m - 1, d, h, min).getTime();

  test("no repeat, no copy", () => {
    expect(
      nextDates({ repeat: null, dueDate: "2026-11-20", reminderAt: null }),
    ).toBeNull();
  });

  test("counts on from the due date, not from today", () => {
    expect(
      nextDates(
        {
          repeat: presetRule("daily", "2026-11-01"),
          dueDate: "2026-11-01",
          reminderAt: null,
        },
        "2026-11-20",
      ),
    ).toEqual({ dueDate: "2026-11-02", reminderAt: null });
  });

  test("with no due date it goes from the reminder, then from today", () => {
    const daily = presetRule("daily", "2026-11-20");
    expect(
      nextDates({
        repeat: daily,
        dueDate: null,
        reminderAt: at(2026, 11, 10, 9),
      }),
    ).toEqual({ dueDate: "2026-11-11", reminderAt: at(2026, 11, 11, 9) });
    expect(
      nextDates(
        { repeat: daily, dueDate: null, reminderAt: null },
        "2026-11-20",
      ),
    ).toEqual({ dueDate: "2026-11-21", reminderAt: null });
  });

  test("the reminder keeps 09:00 when the clocks go forward", () => {
    // UK clocks go forward on 29 March 2026, so that day has 23 hours
    const next = nextDates({
      repeat: presetRule("daily", "2026-03-28"),
      dueDate: "2026-03-28",
      reminderAt: at(2026, 3, 28, 9),
    });
    expect(next?.dueDate).toBe("2026-03-29");
    expect(new Date(next?.reminderAt ?? 0).getHours()).toBe(9);
    expect((next?.reminderAt ?? 0) - at(2026, 3, 28, 9)).toBe(23 * 3_600_000);
  });

  test("and when they go back", () => {
    const next = nextDates({
      repeat: presetRule("weekly", "2026-10-21"),
      dueDate: "2026-10-21",
      reminderAt: at(2026, 10, 21, 18, 30),
    });
    expect(next?.dueDate).toBe("2026-10-28");
    expect(next?.reminderAt).toBe(at(2026, 10, 28, 18, 30));
  });

  test("a reminder the day before the due date stays the day before", () => {
    const next = nextDates({
      repeat: presetRule("monthly", "2026-01-31"),
      dueDate: "2026-01-31",
      reminderAt: at(2026, 1, 30, 20),
    });
    expect(next).toEqual({
      dueDate: "2026-02-28",
      reminderAt: at(2026, 2, 27, 20),
    });
  });
});
