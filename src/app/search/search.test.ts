import { expect, test } from "vitest";
import {
  createStep,
  createTask,
  type Step,
  type Task,
} from "../../data/model.ts";
import { searchTasks } from "./search.ts";

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

const task = (title: string, fields: Partial<Task> = {}) =>
  createTask({ listId: "l", title, position: "a0", ...fields });

test("finds words in titles, notes and steps, any case and accent", () => {
  const cafe = task("Book the Café");
  const note = task("Dinner", { note: "bring the wine" });
  const steps = task("Trip");
  const other = task("Laundry");
  const step = createStep({
    taskId: steps.id,
    title: "Pack passport",
    position: "a0",
  });

  const tasks = byId([cafe, note, steps, other]);
  const all = byId([step]);
  expect(searchTasks("cafe", tasks, all)).toEqual(new Set([cafe.id]));
  expect(searchTasks("WINE", tasks, all)).toEqual(new Set([note.id]));
  expect(searchTasks("passport", tasks, all)).toEqual(new Set([steps.id]));
  // Every word has to be there, but not next to each other
  expect(searchTasks("trip pack", tasks, all)).toEqual(new Set([steps.id]));
  expect(searchTasks("trip wine", tasks, all)).toEqual(new Set());
});

test("an empty query and deleted things find nothing", () => {
  const gone = task("Milk", { deletedAt: 1 });
  const kept = task("Bread");
  const deletedStep: Step = {
    ...createStep({ taskId: kept.id, title: "Milk too", position: "a0" }),
    deletedAt: 1,
  };
  const tasks = byId([gone, kept]);
  expect(searchTasks("   ", tasks, {})).toEqual(new Set());
  expect(searchTasks("milk", tasks, byId([deletedStep]))).toEqual(new Set());
});

test("5000 tasks with notes and steps search in under 100 ms", () => {
  const tasks: Task[] = [];
  const steps: Step[] = [];
  for (let i = 0; i < 5000; i++) {
    const t = task(`Task number ${i}`, {
      note: "Some longer note ".repeat(10),
    });
    tasks.push(t);
    for (let s = 0; s < 3; s++) {
      steps.push(
        createStep({ taskId: t.id, title: `Step ${s}`, position: "a0" }),
      );
    }
  }
  const all = byId(tasks);
  const allSteps = byId(steps);
  searchTasks("warm up", all, allSteps);
  const start = performance.now();
  const found = searchTasks("number 4999", all, allSteps);
  const took = performance.now() - start;
  expect(found.size).toBe(1);
  expect(took).toBeLessThan(100);
});
