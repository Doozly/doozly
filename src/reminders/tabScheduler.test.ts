// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Reminder } from "./reminders.ts";
import { createTabScheduler } from "./tabScheduler.ts";

const START = new Date(2026, 10, 20, 9, 0).getTime();
const MIN = 60_000;

const reminder = (id: string, inMinutes: number): Reminder => ({
  id,
  taskId: id,
  listId: "inbox",
  fireAt: START + inMinutes * MIN,
  title: id,
  body: "Tasks",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const fired: string[] = [];
  const scheduler = createTabScheduler((r) => fired.push(r.id));
  return { fired, scheduler };
}

test("fires each reminder when its time comes, in order", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("b", 10), reminder("a", 5)]);
  vi.advanceTimersByTime(5 * MIN - 1);
  expect(fired).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(fired).toEqual(["a"]);
  vi.advanceTimersByTime(5 * MIN);
  expect(fired).toEqual(["a", "b"]);
});

test("nothing from before the tab opened, or set in the past", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("old", -30)]);
  vi.advanceTimersByTime(MIN);
  await scheduler.sync([reminder("old", -30), reminder("just", -0.5)]);
  vi.advanceTimersByTime(60 * MIN);
  expect(fired).toEqual([]);
});

test("a new sync replaces the set, so removed ones never fire", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("a", 5), reminder("b", 10)]);
  await scheduler.sync([reminder("b", 10)]);
  vi.advanceTimersByTime(15 * MIN);
  expect(fired).toEqual(["b"]);
});

test("the same set twice still fires once", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("a", 5)]);
  vi.advanceTimersByTime(5 * MIN);
  await scheduler.sync([reminder("a", 5)]);
  vi.advanceTimersByTime(5 * MIN);
  expect(fired).toEqual(["a"]);
});

test("waking from sleep catches up on what passed meanwhile", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("a", 30), reminder("b", 90)]);
  // The machine sleeps: the clock jumps, but no timer ran in between
  vi.setSystemTime(START + 120 * MIN);
  // Then the timer for "a" finally runs, late
  vi.advanceTimersByTime(30 * MIN);
  expect(fired).toEqual(["a", "b"]);
});

test("far off reminders still fire, a month out", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("later", 31 * 24 * 60)]);
  vi.advanceTimersByTime(31 * 24 * 60 * MIN);
  expect(fired).toEqual(["later"]);
});

test("dispose stops it", async () => {
  const { fired, scheduler } = setup();
  await scheduler.sync([reminder("a", 5)]);
  scheduler.dispose();
  vi.advanceTimersByTime(10 * MIN);
  expect(fired).toEqual([]);
});
