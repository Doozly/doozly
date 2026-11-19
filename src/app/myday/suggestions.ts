import { addDays, inMyDay } from "../../data/localDate.ts";
import type { LocalDate, Task } from "../../data/model.ts";

export interface SuggestionGroup {
  title: string;
  tasks: Task[];
}

/**
 * What My Day suggests: unfinished tasks from earlier days of My Day, then ones
 * that are overdue, due today or coming up within a week. Each task shows up
 * once, in the first group that fits.
 */
export function suggestions(
  tasks: Iterable<Task>,
  now: LocalDate,
): SuggestionGroup[] {
  const yesterday = addDays(now, -1);
  const weekAhead = addDays(now, 7);
  const candidates = [...tasks].filter(
    (t) => t.deletedAt === null && t.completedAt === null && !inMyDay(t, now),
  );

  const rules: [string, (t: Task) => boolean][] = [
    ["Yesterday", (t) => t.myDay === yesterday],
    ["Earlier", (t) => t.myDay !== null && t.myDay < yesterday],
    ["Overdue", (t) => t.dueDate !== null && t.dueDate < now],
    ["Due today", (t) => t.dueDate === now],
    [
      "Upcoming",
      (t) => t.dueDate !== null && t.dueDate > now && t.dueDate <= weekAhead,
    ],
  ];

  const taken = new Set<string>();
  const groups: SuggestionGroup[] = [];
  for (const [title, fits] of rules) {
    const picked = candidates
      .filter((t) => !taken.has(t.id) && fits(t))
      .sort(
        (a, b) =>
          (a.dueDate ?? a.myDay ?? "").localeCompare(
            b.dueDate ?? b.myDay ?? "",
          ) || b.createdAt - a.createdAt,
      );
    for (const t of picked) taken.add(t.id);
    if (picked.length) groups.push({ title, tasks: picked });
  }
  return groups;
}
