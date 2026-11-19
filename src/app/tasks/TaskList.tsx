import { useState } from "react";
import { Button } from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import { INBOX_ID, type Task } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { byPosition } from "../../state/position.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { playDing } from "../../ui/sound.ts";
import { useSelection } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import styles from "./TaskList.module.css";
import { TaskRow } from "./TaskRow.tsx";

export function TaskList({ listId }: { listId: string }) {
  const { taskId } = useSelection();
  const actions = useActions();
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
  const sound = useAppState((s) => setting(s, "playCompletionSound"));
  const confirmDelete = useAppState((s) => setting(s, "confirmBeforeDelete"));
  const folded = useUi((s) => s.completedFolded[listId] ?? false);
  const toggleFolded = useUi((s) => s.toggleCompleted);

  const [pop, setPop] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: Task; x: number; y: number } | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<Task | null>(null);

  const toggle = (task: Task) => {
    const completing = task.completedAt === null;
    actions.toggleCompleted(task.id);
    setPop(completing ? task.id : null);
    if (completing && sound) playDing();
  };

  const remove = (task: Task) => {
    if (confirmDelete) setToDelete(task);
    else actions.deleteTask(task.id);
  };

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      listId={listId}
      selected={task.id === taskId}
      pop={task.id === pop}
      onToggle={toggle}
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
          {open.map(row)}
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
          if (id === "delete") remove(menu.task);
        }}
      />

      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete "${toDelete?.title ?? ""}"?`}
        message="It will be gone for good."
        confirmLabel="Delete task"
        onConfirm={() => {
          if (toDelete) actions.deleteTask(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}

function taskMenu(task: Task): MenuEntry[] {
  const done = task.completedAt !== null;
  return [
    {
      id: "toggle",
      label: done ? "Mark as not completed" : "Mark as completed",
      icon: done ? "incomplete" : "complete",
    },
    {
      id: "delete",
      label: "Delete task",
      icon: "delete",
      danger: true,
      separated: true,
    },
  ];
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
