import { useState } from "react";
import { Button } from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import { addDays, inMyDay, today } from "../../data/localDate.ts";
import { INBOX_ID, type Task } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { byPosition } from "../../state/position.ts";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useSelection } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import styles from "./TaskList.module.css";
import { TaskRow } from "./TaskRow.tsx";
import { useDeleteTask } from "./useDeleteTask.tsx";
import { useToggleCompleted } from "./useToggleCompleted.ts";

export function TaskList({ listId }: { listId: string }) {
  const { taskId } = useSelection();
  const open = useAppState(
    useShallow((s) =>
      Object.values(s.tasks)
        .filter(
          (t) =>
            t.listId === listId &&
            t.deletedAt === null &&
            t.completedAt === null,
        )
        .sort(byPosition),
    ),
  );
  const done = useAppState(
    useShallow((s) =>
      Object.values(s.tasks)
        .filter(
          (t) =>
            t.listId === listId &&
            t.deletedAt === null &&
            t.completedAt !== null,
        )
        // Most recently finished first
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    ),
  );
  const showCompleted = useAppState(
    (s) => s.lists[listId]?.showCompleted ?? true,
  );
  const progress = useAppState(useShallow(stepProgress));
  const starredFirst = useAppState((s) => setting(s, "moveStarredToTop"));
  const { toggleImportant, toggleMyDay, updateTask } = useActions();
  const setDue = (id: string, dueDate: string | null) =>
    updateTask(id, { dueDate });
  const folded = useUi((s) => s.completedFolded[listId] ?? false);
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
      listId={listId}
      selected={task.id === taskId}
      pop={task.id === pop}
      steps={progress[task.id]}
      onToggle={toggle}
      onStar={(t) => toggleImportant(t.id)}
      onMenu={(t, at) => setMenu({ task: t, ...at })}
    />
  );

  const empty = open.length === 0 && done.length === 0;

  return (
    <>
      <AddTask listId={listId} />

      {empty ? (
        <p className={styles.empty}>
          {listId === INBOX_ID
            ? "Tasks that aren't in any of your lists live here."
            : "Nothing here yet. Add a task to get going."}
        </p>
      ) : (
        <ul className={styles.tasks} aria-label="Tasks">
          {(starredFirst ? starredOnTop(open) : open).map(row)}
        </ul>
      )}

      {showCompleted && done.length > 0 && (
        <section className={styles.completed}>
          <Button
            className={styles.completedToggle}
            aria-expanded={!folded}
            onPress={() => toggleFolded(listId)}
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

function AddTask({ listId }: { listId: string }) {
  const [title, setTitle] = useState("");
  const { addTask } = useActions();

  return (
    <form
      className={styles.add}
      onSubmit={(e) => {
        e.preventDefault();
        if (addTask(listId, title)) setTitle("");
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
