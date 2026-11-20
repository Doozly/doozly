import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "wouter";
import { formatDue, inMyDay, isBefore } from "../../data/localDate.ts";
import type { Task } from "../../data/model.ts";
import { formatReminder } from "../../reminders/times.ts";
import { isMenuKey, menuPointFor } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useToday } from "../../ui/useToday.ts";
import type { DragData } from "../dnd/DragAndDrop.tsx";
import { MOVE_KEYS, moveKey } from "../dnd/reorder.ts";
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
  /** Alt+Up and Alt+Down. Left out where the order isn't the user's own. */
  onMove?: (task: Task, by: -1 | 1) => void;
}

function RepeatMark() {
  return (
    <>
      <Icon name="repeat" size={14} />
      <span className="visually-hidden">, repeats</span>
    </>
  );
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
  onMove,
}: TaskRowProps) {
  const done = task.completedAt !== null;
  const hasNote = task.note.trim() !== "";
  const now = useToday();
  const due = task.dueDate;
  const overdue = due !== null && !done && isBefore(due, now);
  const myDay = !hideMyDay && inMyDay(task, now);
  const reorder = onMove !== undefined;
  const data: DragData = { type: "task", task, reorder };
  // Always draggable onto a list in the sidebar, but only a drop spot where reordering makes sense
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: task.id, data, disabled: { droppable: !reorder } });

  return (
    <li
      ref={setNodeRef}
      className={styles.row}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-selected={selected || undefined}
      data-done={done || undefined}
      data-dragging={isDragging || undefined}
      {...listeners}
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
          aria-keyshortcuts={reorder ? MOVE_KEYS : undefined}
          draggable={false}
          onKeyDown={(e) => {
            if (isMenuKey(e)) {
              e.preventDefault();
              onMenu(task, menuPointFor(e.currentTarget));
            }
            const by = moveKey(e);
            if (by && onMove) {
              e.preventDefault();
              onMove(task, by);
            }
          }}
        >
          {task.title}
        </Link>
        {(listName ||
          myDay ||
          due ||
          task.reminderAt !== null ||
          task.repeat ||
          steps ||
          hasNote) && (
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
                {task.repeat && <RepeatMark />}
              </span>
            )}
            {task.reminderAt !== null && (
              <span className={styles.due}>
                <Icon name="reminder" size={14} />
                <span className="visually-hidden">Reminder </span>
                {formatReminder(task.reminderAt, now)}
              </span>
            )}
            {!due && task.repeat && (
              <span className={styles.metaIcon}>
                <RepeatMark />
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
