import { useState } from "react";
import { Button } from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import {
  addDays,
  DUE_BUCKETS,
  dueBucket,
  inMyDay,
  today,
} from "../../data/localDate.ts";
import {
  INBOX_ID,
  type List,
  type LocalDate,
  type Task,
} from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { byPosition } from "../../state/position.ts";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useToday } from "../../ui/useToday.ts";
import { useSelection } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import type { View } from "../views.ts";
import styles from "./TaskList.module.css";
import { TaskRow } from "./TaskRow.tsx";
import { useDeleteTask } from "./useDeleteTask.tsx";
import { useToggleCompleted } from "./useToggleCompleted.ts";

export function TaskList({ view }: { view: View }) {
  const { taskId } = useSelection();
  const now = useToday();
  const visible = (t: Task) => t.deletedAt === null && view.includes(t);
  const open = useAppState(
    useShallow((s) =>
      Object.values(s.tasks)
        .filter((t) => visible(t) && t.completedAt === null)
        .sort(orderings[view.order]),
    ),
  );
  const done = useAppState(
    useShallow((s) =>
      Object.values(s.tasks)
        .filter((t) => visible(t) && t.completedAt !== null)
        // Most recently finished first
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    ),
  );
  const lists = useAppState((s) => s.lists);
  const progress = useAppState(useShallow(stepProgress));
  const starredFirst = useAppState((s) => setting(s, "moveStarredToTop"));
  const { toggleImportant, toggleMyDay, updateTask } = useActions();
  const setDue = (id: string, dueDate: string | null) =>
    updateTask(id, { dueDate });
  const folded = useUi((s) => s.completedFolded[view.id] ?? false);
  const toggleFolded = useUi((s) => s.toggleCompleted);
  const toggleCompleted = useToggleCompleted();
  const deleting = useDeleteTask();

  const [pop, setPop] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: Task; x: number; y: number } | null>(
    null,
  );

  const toggle = (task: Task) => {
    setPop(toggleCompleted(task) ? task.id : null);
  };

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      listId={view.id}
      // Across lists each row says where it lives, unless a group heading does already
      listName={
        view.list || view.group === "list"
          ? undefined
          : lists[task.listId]?.title
      }
      hideMyDay={view.id === "my-day"}
      selected={task.id === taskId}
      pop={task.id === pop}
      steps={progress[task.id]}
      onToggle={toggle}
      onStar={(t) => toggleImportant(t.id)}
      onMenu={(t, at) => setMenu({ task: t, ...at })}
    />
  );

  const ordered =
    starredFirst && view.order === "position" ? starredOnTop(open) : open;
  const empty = open.length === 0 && (done.length === 0 || !view.showCompleted);

  return (
    <>
      <AddTask view={view} />

      {empty ? (
        <p className={styles.empty}>{view.emptyText}</p>
      ) : view.group !== "none" ? (
        (view.group === "list"
          ? groupByList(ordered, lists)
          : groupByDue(ordered, now)
        ).map(({ key, title, tasks }) => (
          <section key={key} className={styles.group}>
            <h2 className={styles.groupTitle}>{title}</h2>
            <ul className={styles.tasks} aria-label={title}>
              {tasks.map(row)}
            </ul>
          </section>
        ))
      ) : (
        <ul className={styles.tasks} aria-label="Tasks">
          {ordered.map(row)}
        </ul>
      )}

      {view.showCompleted && done.length > 0 && (
        <section className={styles.completed}>
          <Button
            className={styles.completedToggle}
            aria-expanded={!folded}
            onPress={() => toggleFolded(view.id)}
          >
            <Icon name={folded ? "chevronRight" : "chevronDown"} size={16} />
            Completed
            <span className={styles.completedCount}>{done.length}</span>
          </Button>
          {!folded && (
            <ul className={styles.tasks} aria-label="Completed tasks">
              {done.map(row)}
            </ul>
          )}
        </section>
      )}

      <ContextMenu
        at={menu}
        label={`Actions for ${menu?.task.title ?? "task"}`}
        items={menu ? taskMenu(menu.task) : []}
        onClose={() => setMenu(null)}
        onAction={(id) => {
          if (!menu) return;
          if (id === "toggle") toggle(menu.task);
          if (id === "delete") deleting.request(menu.task);
          if (id === "myDay") toggleMyDay(menu.task.id);
          if (id === "dueToday") setDue(menu.task.id, today());
          if (id === "dueTomorrow") setDue(menu.task.id, addDays(today(), 1));
          if (id === "dueRemove") setDue(menu.task.id, null);
        }}
      />
      {deleting.element}
    </>
  );
}

const orderings: Record<View["order"], (a: Task, b: Task) => number> = {
  position: byPosition,
  newest: (a, b) => b.createdAt - a.createdAt,
  // Soonest first; same day keeps the newest on top
  due: (a, b) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
    b.createdAt - a.createdAt,
};

interface Group {
  key: string;
  title: string;
  tasks: Task[];
}

/** Tasks under their list, lists in sidebar order (Tasks first) */
function groupByList(tasks: Task[], lists: Record<string, List>): Group[] {
  const byList = new Map<string, Task[]>();
  for (const t of tasks) {
    byList.set(t.listId, [...(byList.get(t.listId) ?? []), t]);
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

/** Planned's Earlier / Today / Tomorrow / This week / Later, empty ones left out */
function groupByDue(tasks: Task[], now: LocalDate): Group[] {
  return DUE_BUCKETS.map((bucket) => ({
    key: bucket,
    title: bucket,
    tasks: tasks.filter(
      (t) => t.dueDate !== null && dueBucket(t.dueDate, now) === bucket,
    ),
  })).filter((g) => g.tasks.length > 0);
}

/** Starred ones first, keeping the user's order within each group */
function starredOnTop(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(b.important) - Number(a.important));
}

/** "1 of 3" per task id, for tasks that have steps */
function stepProgress(s: {
  steps: Record<
    string,
    { taskId: string; deletedAt: number | null; completedAt: number | null }
  >;
}): Record<string, string> {
  const counts: Record<string, { done: number; total: number }> = {};
  for (const step of Object.values(s.steps)) {
    if (step.deletedAt !== null) continue;
    const c = counts[step.taskId] ?? { done: 0, total: 0 };
    counts[step.taskId] = c;
    c.total++;
    if (step.completedAt !== null) c.done++;
  }
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(counts))
    out[id] = `${c.done} of ${c.total}`;
  return out;
}

function taskMenu(task: Task): MenuEntry[] {
  const done = task.completedAt !== null;
  const entries: MenuEntry[] = [
    inMyDay(task)
      ? { id: "myDay", label: "Remove from My Day", icon: "myDay" }
      : { id: "myDay", label: "Add to My Day", icon: "myDay" },
    {
      id: "toggle",
      label: done ? "Mark as not completed" : "Mark as completed",
      icon: done ? "incomplete" : "complete",
    },
    { id: "dueToday", label: "Due today", icon: "dueDate", separated: true },
    { id: "dueTomorrow", label: "Due tomorrow", icon: "dueDate" },
  ];
  if (task.dueDate) {
    entries.push({ id: "dueRemove", label: "Remove due date", icon: "close" });
  }
  entries.push({
    id: "delete",
    label: "Delete task",
    icon: "delete",
    danger: true,
    separated: true,
  });
  return entries;
}

function AddTask({ view }: { view: View }) {
  const [title, setTitle] = useState("");
  const { addTask } = useActions();

  return (
    <form
      className={styles.add}
      onSubmit={(e) => {
        e.preventDefault();
        const { listId, fields } = view.newTask;
        if (addTask(listId, title, fields)) setTitle("");
      }}
    >
      <Icon name="add" className={styles.addIcon} />
      <input
        className={styles.addInput}
        aria-label="Add a task"
        placeholder="Add a task"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
