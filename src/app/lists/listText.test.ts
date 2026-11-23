import { expect, test } from "vitest";
import {
  createList,
  createStep,
  createTask,
  type Step,
  type Task,
} from "../../data/model.ts";
import { emailLink, listAsText, listContent } from "./listText.ts";

const list = createList({ id: "l", title: "Groceries", position: "a0" });
const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id, i]));

function source(tasks: Task[], steps: Step[] = [], starredFirst = false) {
  return { tasks: byId(tasks), steps: byId(steps), starredFirst };
}

const task = (title: string, position: string, extra: Partial<Task> = {}) =>
  createTask({ id: title, listId: "l", title, position, ...extra });

test("open tasks in list order with their steps, then the completed ones", () => {
  const content = listContent(
    list,
    source(
      [
        task("Bread", "a1", { important: true, dueDate: "2026-11-24" }),
        task("Milk", "a0"),
        task("Eggs", "a2", { completedAt: 2 }),
        task("Gone", "a3", { deletedAt: 1 }),
        createTask({ listId: "other", title: "Elsewhere", position: "a0" }),
      ],
      [
        createStep({ taskId: "Milk", title: "Oat", position: "a1" }),
        createStep({
          taskId: "Milk",
          title: "Skimmed",
          position: "a0",
          completedAt: 1,
        }),
      ],
    ),
    "2026-11-23",
  );
  expect(listAsText(content)).toBe(
    [
      "Groceries",
      "",
      "☐ Milk",
      "    ☑ Skimmed",
      "    ☐ Oat",
      "☐ Bread (important, due Tomorrow)",
      "",
      "Completed",
      "☑ Eggs",
    ].join("\n"),
  );
});

test("the list's own sort and starred-on-top apply like on screen", () => {
  const tasks = [task("b", "a0"), task("a", "a1", { important: true })];
  const sorted = { ...list, sort: { by: "title", direction: "asc" } as const };
  expect(listContent(sorted, source(tasks)).open.map((t) => t.title)).toEqual([
    "a",
    "b",
  ]);
  expect(
    listContent(list, source(tasks, [], true)).open.map((t) => t.title),
  ).toEqual(["a", "b"]);
});

test("an empty list says so, and the email has subject and body", () => {
  const content = listContent(list, source([]));
  expect(listAsText(content)).toBe("Groceries\n\nNothing left to do.");
  expect(emailLink(content)).toBe(
    "mailto:?subject=Groceries&body=Groceries%0A%0ANothing%20left%20to%20do.",
  );
});
