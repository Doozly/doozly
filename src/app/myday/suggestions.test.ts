import { expect, test } from "vitest";
import { createTask, type Task } from "../../data/model.ts";
import { suggestions } from "./suggestions.ts";

const now = "2026-11-19";
const task = (title: string, fields: Partial<Task> = {}) =>
  createTask({ listId: "inbox", title, position: "a0", ...fields });

const shape = (tasks: Task[]) =>
  suggestions(tasks, now).map((g) => [g.title, g.tasks.map((t) => t.title)]);

test("each group in its place, empty ones left out", () => {
  expect(
    shape([
      task("From yesterday", { myDay: "2026-11-18" }),
      task("From last week", { myDay: "2026-11-11" }),
      task("Overdue", { dueDate: "2026-11-15" }),
      task("Due today", { dueDate: now }),
      task("Next Tuesday", { dueDate: "2026-11-24" }),
      task("Far away", { dueDate: "2026-12-20" }),
      task("No dates"),
    ]),
  ).toEqual([
    ["Yesterday", ["From yesterday"]],
    ["Earlier", ["From last week"]],
    ["Overdue", ["Overdue"]],
    ["Due today", ["Due today"]],
    ["Upcoming", ["Next Tuesday"]],
  ]);
});

test("a task shows up only once, in the first group that fits", () => {
  expect(
    shape([task("Both", { myDay: "2026-11-18", dueDate: "2026-11-10" })]),
  ).toEqual([["Yesterday", ["Both"]]]);
});

test("nothing that's done, deleted or already in today's My Day", () => {
  expect(
    shape([
      task("Done", { dueDate: now, completedAt: 1 }),
      task("Gone", { dueDate: now, deletedAt: 1 }),
      task("Already in", { dueDate: now, myDay: now }),
    ]),
  ).toEqual([]);
});

test("upcoming means within a week, oldest due first", () => {
  expect(
    shape([
      task("In 7 days", { dueDate: "2026-11-26" }),
      task("In 8 days", { dueDate: "2026-11-27" }),
      task("Tomorrow", { dueDate: "2026-11-20" }),
    ]),
  ).toEqual([["Upcoming", ["Tomorrow", "In 7 days"]]]);
});
