import fc from "fast-check";
import { expect, test } from "vitest";
import { createClock, MAX_DRIFT_MS, stamp, stampTime } from "./clock.ts";

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

const NOW = Date.UTC(2026, 10, 19, 12);

test("after receiving, the next stamp sorts after it, even with a slow clock", () => {
  const fast = createClock("fast0000");
  const slow = createClock("slow0000");
  // An hour behind
  const theirs = fast.stamp(NOW);
  slow.receive(theirs, NOW - 3_600_000);
  expect(slow.stamp(NOW - 3_600_000) > theirs).toBe(true);
});

test("a stamp from too far ahead is ignored for the clock", () => {
  const c = createClock("aaaaaaaa");
  const future = createClock("bbbbbbbb").stamp(NOW + MAX_DRIFT_MS + 1);
  c.receive(future, NOW);
  expect(stampTime(c.stamp(NOW))).toBe(NOW);
  c.receive("garbage", NOW);
  expect(stampTime(c.stamp(NOW))).toBe(NOW);
});

test("the counter running out rolls into the next ms", () => {
  const c = createClock("cccccccc");
  c.receive(`${String(NOW).padStart(13, "0")}:zzzz:dddddddd`, NOW);
  const next = c.stamp(NOW);
  expect(stampTime(next)).toBe(NOW + 1);
  expect(next > `${String(NOW).padStart(13, "0")}:zzzz:dddddddd`).toBe(true);
});

test("property: stamps only ever go up, whatever wall times and remote stamps come in", () => {
  const event = fc.oneof(
    fc.record({
      kind: fc.constant("local" as const),
      now: fc.integer({ min: NOW - 1e7, max: NOW + 1e7 }),
    }),
    fc.record({
      kind: fc.constant("remote" as const),
      now: fc.integer({ min: NOW - 1e7, max: NOW + 1e7 }),
      remoteMs: fc.integer({ min: NOW - 1e7, max: NOW + 1e7 }),
      counter: fc.integer({ min: 0, max: 36 ** 4 - 1 }),
    }),
  );
  fc.assert(
    fc.property(fc.array(event, { maxLength: 60 }), (events) => {
      const c = createClock("pppppppp");
      let last = "";
      let lastSeen = "";
      for (const e of events) {
        if (e.kind === "local") {
          const s = c.stamp(e.now);
          if (!(s > last) || !(s > lastSeen)) return false;
          last = s;
        } else {
          const remote = `${String(e.remoteMs).padStart(13, "0")}:${e.counter.toString(36).padStart(4, "0")}:rrrrrrrr`;
          c.receive(remote, e.now);
          // Only stamps within the drift limit have to be overtaken
          if (e.remoteMs <= e.now + MAX_DRIFT_MS && remote > lastSeen) {
            lastSeen = remote;
          }
        }
      }
      return true;
    }),
  );
});
