import { useEffect, useRef, useState } from "react";
import type { Task } from "../data/model.ts";
import { useActions } from "../state/AppContext.tsx";
import { relativeDay } from "../ui/dates.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { useAutoGrow } from "../ui/useAutoGrow.ts";
import { useDebounced } from "../ui/useDebounced.ts";
import styles from "./DetailPane.module.css";
import { DueDate } from "./detail/DueDate.tsx";
import { MyDay } from "./detail/MyDay.tsx";
import { Steps } from "./detail/Steps.tsx";
import { StarToggle } from "./tasks/StarToggle.tsx";
import { TaskCheck } from "./tasks/TaskCheck.tsx";
import { useDeleteTask } from "./tasks/useDeleteTask.tsx";
import { useToggleCompleted } from "./tasks/useToggleCompleted.ts";

interface DetailPaneProps {
  task: Task;
  onClose: () => void;
}

export function DetailPane({ task, onClose }: DetailPaneProps) {
  const toggleCompleted = useToggleCompleted();
  const { toggleImportant } = useActions();
  const deleting = useDeleteTask();

  return (
    <aside
      aria-label="Task details"
      className={styles.detail}
      data-done={task.completedAt !== null || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={styles.top}>
        <IconButton icon="close" label="Close details" onPress={onClose} />
      </div>
      <div className={styles.scroll}>
        <section className={styles.card}>
          <div className={styles.titleRow}>
            <TaskCheck
              done={task.completedAt !== null}
              label={task.title}
              onToggle={() => toggleCompleted(task)}
            />
            <TitleField task={task} />
            <StarToggle
              important={task.important}
              taskTitle={task.title}
              onToggle={() => toggleImportant(task.id)}
            />
          </div>
          <Steps taskId={task.id} />
        </section>
        <section className={styles.card}>
          <MyDay task={task} />
        </section>
        <section className={styles.card}>
          <DueDate task={task} />
        </section>
        <section className={styles.card}>
          <NotesField task={task} />
        </section>
      </div>
      <footer className={styles.footer}>
        <span className={styles.created}>
          Created {relativeDay(task.createdAt)}
        </span>
        <IconButton
          icon="delete"
          label="Delete task"
          onPress={() => deleting.request(task)}
        />
      </footer>
      {deleting.element}
    </aside>
  );
}

function TitleField({ task }: { task: Task }) {
  const { updateTask } = useActions();
  const [value, setValue] = useState(task.title);
  const typing = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const save = useDebounced((title: string) => {
    const clean = title.trim();
    if (clean && clean !== task.title) updateTask(task.id, { title: clean });
  }, 400);

  // Changes from elsewhere (the list, another tab) show up, but never while typing
  useEffect(() => {
    if (!typing.current) setValue(task.title);
  }, [task.title]);

  // A title can wrap over a few lines
  useAutoGrow(field, value);

  return (
    <textarea
      ref={field}
      className={styles.title}
      aria-label="Task title"
      rows={1}
      maxLength={255}
      value={value}
      onFocus={() => {
        typing.current = true;
      }}
      onChange={(e) => {
        // A title is one line, pasted line breaks become spaces
        const next = e.target.value.replace(/\s*\n\s*/g, " ");
        setValue(next);
        save.call(next);
      }}
      onBlur={() => {
        typing.current = false;
        save.flush();
        if (!value.trim()) setValue(task.title);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function NotesField({ task }: { task: Task }) {
  const { updateTask } = useActions();
  const [value, setValue] = useState(task.note);
  const typing = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(field, value);

  const save = useDebounced((note: string) => {
    if (note !== task.note) updateTask(task.id, { note });
  }, 400);

  useEffect(() => {
    if (!typing.current) setValue(task.note);
  }, [task.note]);

  return (
    <textarea
      ref={field}
      className={styles.note}
      aria-label="Note"
      placeholder="Add note"
      rows={3}
      maxLength={10000}
      value={value}
      onFocus={() => {
        typing.current = true;
      }}
      onChange={(e) => {
        setValue(e.target.value);
        save.call(e.target.value);
      }}
      onBlur={() => {
        typing.current = false;
        save.flush();
      }}
    />
  );
}
