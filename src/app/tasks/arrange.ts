import {
  addDays,
  DUE_BUCKETS,
  dueBucket,
  endOfWeek,
  inMyDay,
  today,
} from "../../data/localDate.ts";
import {
  type GroupBy,
  INBOX_ID,
  type List,
  type ListSort,
  type LocalDate,
  type SortBy,
  type Task,
} from "../../data/model.ts";
import { byPosition } from "../../state/position.ts";

type Direction = ListSort["direction"];

/** Which way a sort goes when it's picked: important, soonest, in My Day and newest first */
export const defaultDirection: Record<SortBy, Direction> = {
  importance: "desc",
  dueDate: "asc",
  myDay: "desc",
  title: "asc",
  createdAt: "desc",
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

type Compare = (a: Task, b: Task, now: LocalDate) => number;

const ascending: Record<SortBy, Compare> = {
  importance: (a, b) => Number(a.important) - Number(b.important),
  dueDate: (a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""),
  myDay: (a, b, now) => Number(inMyDay(a, now)) - Number(inMyDay(b, now)),
  title: (a, b) => collator.compare(a.title, b.title),
  createdAt: (a, b) => a.createdAt - b.createdAt,
};

/** Sorts by what the user picked. Ties keep the order they came in, so pass them in list order. */
export function sortTasks(
  tasks: Task[],
  { by, direction }: ListSort,
  now: LocalDate,
): Task[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    // No due date goes last, which way round ever
    if (by === "dueDate" && (a.dueDate === null) !== (b.dueDate === null)) {
      return a.dueDate === null ? 1 : -1;
    }
    return sign * ascending[by](a, b, now);
  });
}

/** The base orders a view can have before any sort the user picks */
export const orderings: Record<
  "position" | "newest" | "due",
  (a: Task, b: Task) => number
> = {
  position: byPosition,
  newest: (a, b) => b.createdAt - a.createdAt,
  // Soonest first; same day keeps the newest on top
  due: (a, b) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
    b.createdAt - a.createdAt,
};

/** Starred ones first, keeping the user's order within each group */
export function starredOnTop(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(b.important) - Number(a.important));
}

export interface TaskGroup {
  key: string;
  title: string;
  tasks: Task[];
}

const NO_DUE = "No due date";
const NOT_A_LETTER = "#";

function createdBucket(createdAt: number, now: LocalDate): string {
  const day = today(createdAt);
  if (day === now) return "Today";
  if (day === addDays(now, -1)) return "Yesterday";
  if (day >= addDays(endOfWeek(now), -6)) return "Earlier this week";
  return "Older";
}

function firstLetter(title: string): string {
  // NFD splits "É" into "E" and its accent, so it files under E
  const c = [...title.trim().normalize("NFD")][0]?.toLocaleUpperCase() ?? "";
  return /\p{L}/u.test(c) ? c : NOT_A_LETTER;
}

function headingOf(by: GroupBy, t: Task, now: LocalDate): string {
  switch (by) {
    case "importance":
      return t.important ? "Important" : "Not important";
    case "dueDate":
      return t.dueDate === null ? NO_DUE : dueBucket(t.dueDate, now);
    case "myDay":
      return inMyDay(t, now) ? "My Day" : "Not in My Day";
    case "title":
      return firstLetter(t.title);
    case "createdAt":
      return createdBucket(t.createdAt, now);
  }
}

// Headings in ascending order. The "last" one stays at the bottom also when reversed.
const headings: Record<
  Exclude<GroupBy, "title">,
  { order: string[]; last?: string }
> = {
  importance: { order: ["Not important", "Important"] },
  dueDate: { order: DUE_BUCKETS, last: NO_DUE },
  myDay: { order: ["Not in My Day", "My Day"] },
  createdAt: { order: ["Older", "Earlier this week", "Yesterday", "Today"] },
};

/** Splits tasks under headings, empty ones left out. Tasks keep their order inside each. */
export function groupTasks(
  tasks: Task[],
  by: GroupBy,
  direction: Direction,
  now: LocalDate,
): TaskGroup[] {
  const byHeading = new Map<string, Task[]>();
  for (const t of tasks) {
    const h = headingOf(by, t, now);
    const group = byHeading.get(h);
    if (group) group.push(t);
    else byHeading.set(h, [t]);
  }
  const { order, last } =
    by === "title"
      ? {
          order: [...byHeading.keys()]
            .filter((h) => h !== NOT_A_LETTER)
            .sort(collator.compare),
          last: NOT_A_LETTER,
        }
      : headings[by];
  const sorted = direction === "asc" ? order : [...order].reverse();
  return [...sorted, ...(last ? [last] : [])].flatMap((title) => {
    const tasks = byHeading.get(title);
    return tasks ? [{ key: title, title, tasks }] : [];
  });
}

/** Tasks under their list, lists in sidebar order (Tasks first) */
export function groupByList(
  tasks: Task[],
  lists: Record<string, List>,
): TaskGroup[] {
  const byList = new Map<string, Task[]>();
  for (const t of tasks) {
    const group = byList.get(t.listId);
    if (group) group.push(t);
    else byList.set(t.listId, [t]);
  }
  return [...byList.entries()]
    .flatMap(([id, tasks]) => {
      const list = lists[id];
      return list ? [{ list, tasks }] : [];
    })
    .sort((a, b) =>
      a.list.id === INBOX_ID
        ? -1
        : b.list.id === INBOX_ID
          ? 1
          : byPosition(a.list, b.list),
    )
    .map(({ list, tasks }) => ({ key: list.id, title: list.title, tasks }));
}
