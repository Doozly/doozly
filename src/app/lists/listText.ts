import { formatDue, today } from "../../data/localDate.ts";
import type { List, LocalDate, Step, Task } from "../../data/model.ts";
import { byPosition } from "../../state/position.ts";
import { orderings, sortTasks, starredOnTop } from "../tasks/arrange.ts";

export interface PrintedTask {
  title: string;
  done: boolean;
  important: boolean;
  due: string | null;
  steps: { title: string; done: boolean }[];
}

export interface PrintedList {
  title: string;
  open: PrintedTask[];
  done: PrintedTask[];
}

interface Source {
  tasks: Record<string, Task>;
  steps: Record<string, Step>;
  starredFirst: boolean;
}

/** A list's tasks for printing or sending, in the order the list shows them */
export function listContent(
  list: List,
  { tasks, steps, starredFirst }: Source,
  now: LocalDate = today(),
): PrintedList {
  const mine = Object.values(tasks).filter(
    (t) => t.listId === list.id && t.deletedAt === null,
  );
  const stepsOf = (taskId: string) =>
    Object.values(steps)
      .filter((s) => s.taskId === taskId && s.deletedAt === null)
      .sort(byPosition)
      .map((s) => ({ title: s.title, done: s.completedAt !== null }));
  const shown = (t: Task): PrintedTask => ({
    title: t.title,
    done: t.completedAt !== null,
    important: t.important,
    due: t.dueDate && formatDue(t.dueDate, now),
    steps: stepsOf(t.id),
  });

  const open = mine
    .filter((t) => t.completedAt === null)
    .sort(orderings.position);
  const ordered = list.sort
    ? sortTasks(open, list.sort, now)
    : starredFirst
      ? starredOnTop(open)
      : open;
  const done = mine
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return { title: list.title, open: ordered.map(shown), done: done.map(shown) };
}

const line = (t: PrintedTask) => {
  const extras = [t.important ? "important" : "", t.due ? `due ${t.due}` : ""]
    .filter(Boolean)
    .join(", ");
  return [
    `${t.done ? "☑" : "☐"} ${t.title}${extras ? ` (${extras})` : ""}`,
    ...t.steps.map((s) => `    ${s.done ? "☑" : "☐"} ${s.title}`),
  ];
};

/** Plain text, for an email or anywhere else text goes */
export function listAsText({ title, open, done }: PrintedList): string {
  const out = [title, "", ...open.flatMap(line)];
  if (open.length === 0) out.push("Nothing left to do.");
  if (done.length) out.push("", "Completed", ...done.flatMap(line));
  return out.join("\n");
}

/** Opens the user's mail app with the list in a new message */
export function emailLink(content: PrintedList): string {
  const q = (s: string) => encodeURIComponent(s);
  return `mailto:?subject=${q(content.title)}&body=${q(listAsText(content))}`;
}
