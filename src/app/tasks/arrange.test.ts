import { expect, test } from "vitest";
import { createTask, type Task } from "../../data/model.ts";
import { groupTasks, sortTasks } from "./arrange.ts";

// Thursday 19 November 2026
const now = "2026-11-19";
const at = (day: number) => new Date(2026, 10, day, 12).getTime();

let n = 0;
const task = (title: string, fields: Partial<Task> = {}) =>
  createTask({
    listId: "l",
    title,
    position: `a${n++}`,
    createdAt: at(19),
    ...fields,
  });

const titles = (tasks: Task[]) => tasks.map((t) => t.title);

test("sorting by importance puts starred first, and reversed last", () => {
  const tasks = [task("a"), task("b", { important: true }), task("c")];
  expect(
    titles(sortTasks(tasks, { by: "importance", direction: "desc" }, now)),
  ).toEqual(["b", "a", "c"]);
  expect(
    titles(sortTasks(tasks, { by: "importance", direction: "asc" }, now)),
  ).toEqual(["a", "c", "b"]);
});

test("tasks without a due date stay last, also when reversed", () => {
  const tasks = [
    task("none"),
    task("later", { dueDate: "2026-12-01" }),
    task("soon", { dueDate: "2026-11-20" }),
  ];
  expect(
    titles(sortTasks(tasks, { by: "dueDate", direction: "asc" }, now)),
  ).toEqual(["soon", "later", "none"]);
  expect(
    titles(sortTasks(tasks, { by: "dueDate", direction: "desc" }, now)),
  ).toEqual(["later", "soon", "none"]);
});

test("alphabetical ignores case and counts numbers properly", () => {
  const tasks = [
    task("item 10"),
    task("Banana"),
    task("apple"),
    task("item 9"),
  ];
  expect(
    titles(sortTasks(tasks, { by: "title", direction: "asc" }, now)),
  ).toEqual(["apple", "Banana", "item 9", "item 10"]);
});

test("My Day only counts if it was added today", () => {
  const tasks = [
    task("yesterday", { myDay: "2026-11-18" }),
    task("today", { myDay: now }),
  ];
  expect(
    titles(sortTasks(tasks, { by: "myDay", direction: "desc" }, now)),
  ).toEqual(["today", "yesterday"]);
});

test("creation date sorts newest first by default", () => {
  const tasks = [
    task("old", { createdAt: at(1) }),
    task("new", { createdAt: at(19) }),
    task("mid", { createdAt: at(10) }),
  ];
  expect(
    titles(sortTasks(tasks, { by: "createdAt", direction: "desc" }, now)),
  ).toEqual(["new", "mid", "old"]);
});

test("ties keep the order they came in", () => {
  const tasks = [task("x"), task("y"), task("z")];
  expect(
    titles(sortTasks(tasks, { by: "importance", direction: "desc" }, now)),
  ).toEqual(["x", "y", "z"]);
});

const headings = (groups: { title: string }[]) => groups.map((g) => g.title);

test("grouping by due date uses the Planned headings, no date last", () => {
  const tasks = [
    task("none"),
    task("late", { dueDate: "2026-11-01" }),
    task("today", { dueDate: now }),
  ];
  expect(headings(groupTasks(tasks, "dueDate", "asc", now))).toEqual([
    "Earlier",
    "Today",
    "No due date",
  ]);
  expect(headings(groupTasks(tasks, "dueDate", "desc", now))).toEqual([
    "Today",
    "Earlier",
    "No due date",
  ]);
});

test("grouping by importance and My Day", () => {
  const tasks = [task("a"), task("b", { important: true, myDay: now })];
  expect(headings(groupTasks(tasks, "importance", "desc", now))).toEqual([
    "Important",
    "Not important",
  ]);
  expect(headings(groupTasks(tasks, "myDay", "desc", now))).toEqual([
    "My Day",
    "Not in My Day",
  ]);
});

test("grouping alphabetically files by first letter, the rest under #", () => {
  const groups = groupTasks(
    [task("Éclair"), task("2 eggs"), task("bread"), task("eggs")],
    "title",
    "asc",
    now,
  );
  expect(headings(groups)).toEqual(["B", "E", "#"]);
  expect(titles(groups[1]?.tasks ?? [])).toEqual(["Éclair", "eggs"]);
});

test("grouping by creation date counts back from today", () => {
  const tasks = [
    task("today", { createdAt: at(19) }),
    task("yesterday", { createdAt: at(18) }),
    task("monday", { createdAt: at(16) }),
    task("last week", { createdAt: at(15) }),
  ];
  expect(headings(groupTasks(tasks, "createdAt", "desc", now))).toEqual([
    "Today",
    "Yesterday",
    "Earlier this week",
    "Older",
  ]);
});
