import { Link } from "wouter";
import { formatDue, inMyDay, isBefore } from "../../data/localDate.ts";
import type { Task } from "../../data/model.ts";
import { isMenuKey, menuPointFor } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useToday } from "../../ui/useToday.ts";
import { paths } from "../routes.ts";
import { StarToggle } from "./StarToggle.tsx";
import { TaskCheck } from "./TaskCheck.tsx";
import styles from "./TaskRow.module.css";

interface TaskRowProps {
  task: Task;
  listId: string;
  selected: boolean;
  /** Plays the check pop, for the row just ticked off */
  pop: boolean;
  /** Step progress like "1 of 3", when the task has steps */
  steps?: string;
  /** Shown in views across lists, so you know where a task lives */
  listName?: string;
  /** In My Day itself the "My Day" tag says nothing new */
  hideMyDay?: boolean;
  onToggle: (task: Task) => void;
  onStar: (task: Task) => void;
  onMenu: (task: Task, at: { x: number; y: number }) => void;
}

export function TaskRow({
  task,
  listId,
  selected,
  pop,
  steps,
  listName,
  hideMyDay,
  onToggle,
  onStar,
  onMenu,
}: TaskRowProps) {
  const done = task.completedAt !== null;
  const hasNote = task.note.trim() !== "";
  const now = useToday();
  const due = task.dueDate;
  const overdue = due !== null && !done && isBefore(due, now);
  const myDay = !hideMyDay && inMyDay(task, now);

  return (
    <li
      className={styles.row}
      data-selected={selected || undefined}
      data-done={done || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(task, { x: e.clientX, y: e.clientY });
      }}
    >
      <TaskCheck
        done={done}
        label={task.title}
        pop={pop}
        onToggle={() => onToggle(task)}
      />
      <div className={styles.body}>
        <Link
          href={paths.task(listId, task.id)}
          className={styles.title}
          aria-current={selected ? "true" : undefined}
          onKeyDown={(e) => {
            if (isMenuKey(e)) {
              e.preventDefault();
              onMenu(task, menuPointFor(e.currentTarget));
            }
          }}
        >
          {task.title}
        </Link>
        {(listName || myDay || due || steps || hasNote) && (
          <div className={styles.meta}>
            {listName && <span>{listName}</span>}
            {myDay && (
              <span className={styles.metaIcon}>
                <Icon name="myDay" size={14} />
                &nbsp;My Day
              </span>
            )}
            {due && (
              <span
                className={styles.due}
                data-today={due === now || undefined}
                data-overdue={overdue || undefined}
              >
                <Icon name="dueDate" size={14} />
                <span className="visually-hidden">Due </span>
                {formatDue(due, now)}
                {overdue && <span className="visually-hidden">, overdue</span>}
              </span>
            )}
            {steps && (
              <span>
                {steps}
                <span className="visually-hidden"> steps done</span>
              </span>
            )}
            {hasNote && (
              <span className={styles.metaIcon}>
                <Icon name="note" size={14} />
                <span className="visually-hidden">Has a note</span>
              </span>
            )}
          </div>
        )}
      </div>
      <StarToggle
        important={task.important}
        taskTitle={task.title}
        onToggle={() => onStar(task)}
      />
    </li>
  );
}
