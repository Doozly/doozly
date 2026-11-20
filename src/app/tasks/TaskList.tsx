import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { startTransition, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import { addDays, inMyDay, today } from "../../data/localDate.ts";
import {
  INBOX_ID,
  type List,
  type ListGroup,
  type Task,
} from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { byPosition } from "../../state/position.ts";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { animateRows } from "../../ui/motion.ts";
import { useToday } from "../../ui/useToday.ts";
import { nudge } from "../dnd/reorder.ts";
import { useSelection } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import type { View } from "../views.ts";
import {
  defaultDirection,
  groupByList,
  groupTasks,
  orderings,
  sortTasks,
  starredOnTop,
  type TaskGroup,
} from "./arrange.ts";
import styles from "./TaskList.module.css";
import { TaskRow } from "./TaskRow.tsx";
import { useDeleteTask } from "./useDeleteTask.tsx";
import { useToggleCompleted } from "./useToggleCompleted.ts";

// Enough to fill the screen. A huge view like All paints these first, the rest follows.
const FIRST_ROWS = 100;

function useRowLimit() {
  const [all, setAll] = useState(false);
  useEffect(() => startTransition(() => setAll(true)), []);
  return all ? Number.POSITIVE_INFINITY : FIRST_ROWS;
}

/** The groups cut to the first `limit` tasks, in screen order */
function clip(groups: TaskGroup[], limit: number): TaskGroup[] {
  let left = limit;
  return groups.flatMap((g) => {
    const tasks = g.tasks.slice(0, Math.max(0, left));
    left -= g.tasks.length;
    return tasks.length ? [{ ...g, tasks }] : [];
  });
}

export function TaskList({ view }: { view: View }) {
  const { taskId } = useSelection();
  const now = useToday();
  const limit = useRowLimit();
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
  const listGroups = useAppState((s) => s.groups);
  const progress = useAppState(useShallow(stepProgress));
  const starredFirst = useAppState((s) => setting(s, "moveStarredToTop"));
  const { toggleImportant, toggleMyDay, updateTask, moveTask, moveTaskToList } =
    useActions();
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

  const { sort, group } = view;
  const ordered = sort
    ? sortTasks(open, sort, now)
    : starredFirst && view.order === "position"
      ? starredOnTop(open)
      : open;
  // Dragging and Alt+arrows only where the order on screen is the user's own
  const reorderable = view.list !== null && !sort && group === "none";
  const orderedIds = ordered.map((t) => t.id);
  const move = (task: Task, by: -1 | 1) => {
    const at = nudge(orderedIds, task.id, by);
    if (at) moveTask(task.id, at);
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
      onStar={(t) => animateRows(() => toggleImportant(t.id))}
      onMenu={(t, at) => setMenu({ task: t, ...at })}
      onMove={reorderable && task.completedAt === null ? move : undefined}
    />
  );

  const groups =
    group === "none"
      ? null
      : group === "list"
        ? groupByList(ordered, lists)
        : groupTasks(
            ordered,
            group,
            // Grouped and sorted by the same thing, the headings follow the sort
            sort?.by === group ? sort.direction : defaultDirection[group],
            now,
          );
  const shownOpen = ordered.slice(0, limit);
  const shownDone = done.slice(0, Math.max(0, limit - ordered.length));
  const empty = open.length === 0 && (done.length === 0 || !view.showCompleted);

  return (
    <>
      {view.newTask && <AddTask newTask={view.newTask} />}

      {empty ? (
        <p className={styles.empty}>{view.emptyText}</p>
      ) : groups ? (
        clip(groups, limit).map(({ key, title, tasks }) => (
          <section key={key} className={styles.group}>
            <h2 className={styles.groupTitle} data-flip={`group-${key}`}>
              {title}
            </h2>
            <SortableContext id={key} items={tasks.map((t) => t.id)}>
              <ul className={styles.tasks} aria-label={title}>
                {tasks.map(row)}
              </ul>
            </SortableContext>
          </section>
        ))
      ) : (
        <SortableContext
          id="open"
          items={shownOpen.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.tasks} aria-label="Tasks">
            {shownOpen.map(row)}
          </ul>
        </SortableContext>
      )}

      {view.showCompleted && done.length > 0 && (
        <section className={styles.completed}>
          <Button
            className={styles.completedToggle}
            data-flip="completed"
            aria-expanded={!folded}
            onPress={() => toggleFolded(view.id)}
          >
            <Icon name={folded ? "chevronRight" : "chevronDown"} size={16} />
            Completed
            <span className={styles.completedCount}>{done.length}</span>
          </Button>
          {!folded && (
            <SortableContext id="done" items={shownDone.map((t) => t.id)}>
              <ul className={styles.tasks} aria-label="Completed tasks">
                {shownDone.map(row)}
              </ul>
            </SortableContext>
          )}
        </section>
      )}

      <ContextMenu
        at={menu}
        label={`Actions for ${menu?.task.title ?? "task"}`}
        items={menu ? taskMenu(menu.task, sidebarOrder(lists, listGroups)) : []}
        onClose={() => setMenu(null)}
        onAction={(id) => {
          if (!menu) return;
          if (id === "toggle") toggle(menu.task);
          if (id === "delete") deleting.request(menu.task);
          const { task } = menu;
          if (id.startsWith("move:")) {
            animateRows(() => moveTaskToList(task.id, id.slice(5)));
          }
          // In My Day or Planned these move the row, or take it out
          animateRows(() => {
            if (id === "myDay") toggleMyDay(task.id);
            if (id === "important") toggleImportant(task.id);
            if (id === "dueToday") setDue(task.id, today());
            if (id === "dueTomorrow") setDue(task.id, addDays(today(), 1));
            if (id === "dueRemove") setDue(task.id, null);
          });
        }}
      />
      {deleting.element}
    </>
  );
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

/** Live lists as the sidebar shows them: Tasks, then the rest with each group's lists in its place */
function sidebarOrder(
  lists: Record<string, List>,
  groups: Record<string, ListGroup>,
): List[] {
  const live = Object.values(lists)
    .filter((l) => l.deletedAt === null)
    .sort(byPosition);
  const top = [
    ...live
      .filter((l) => l.id !== INBOX_ID && l.groupId === null)
      .map((l) => ({ id: l.id, position: l.position, lists: [l] })),
    ...Object.values(groups)
      .filter((g) => g.deletedAt === null)
      .map((g) => ({
        id: g.id,
        position: g.position,
        lists: live.filter((l) => l.groupId === g.id),
      })),
  ].sort(byPosition);
  return [
    ...live.filter((l) => l.id === INBOX_ID),
    ...top.flatMap((entry) => entry.lists),
  ];
}

function taskMenu(task: Task, lists: List[]): MenuEntry[] {
  const done = task.completedAt !== null;
  const entries: MenuEntry[] = [
    inMyDay(task)
      ? { id: "myDay", label: "Remove from My Day", icon: "myDay" }
      : { id: "myDay", label: "Add to My Day", icon: "myDay" },
    task.important
      ? { id: "important", label: "Remove importance", icon: "important" }
      : { id: "important", label: "Mark as important", icon: "important" },
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
  const others = lists.filter((l) => l.id !== task.listId);
  if (others.length > 0) {
    entries.push({
      id: "move",
      label: "Move task to...",
      icon: "list",
      separated: true,
      children: others.map((l) => ({
        id: `move:${l.id}`,
        label: l.title,
        icon: l.id === INBOX_ID ? "tasks" : "list",
      })),
    });
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

function AddTask({ newTask }: { newTask: NonNullable<View["newTask"]> }) {
  const [title, setTitle] = useState("");
  const { addTask } = useActions();
  const shortcuts = useAppState((s) => setting(s, "keyboardShortcuts"));

  return (
    <form
      className={styles.add}
      onSubmit={(e) => {
        e.preventDefault();
        const { listId, fields } = newTask;
        if (!title.trim()) return;
        setTitle("");
        animateRows(() => addTask(listId, title, fields));
      }}
    >
      <Icon name="add" className={styles.addIcon} />
      <input
        className={styles.addInput}
        aria-label="Add a task"
        aria-keyshortcuts={shortcuts ? "N" : undefined}
        data-shortcut="add-task"
        placeholder="Add a task"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
