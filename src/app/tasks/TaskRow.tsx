import { Checkbox } from "react-aria-components";
import { Link } from "wouter";
import type { Task } from "../../data/model.ts";
import { isMenuKey, menuPointFor } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { paths } from "../routes.ts";
import styles from "./TaskRow.module.css";

interface TaskRowProps {
  task: Task;
  listId: string;
  selected: boolean;
  /** Plays the check pop, for the row just ticked off */
  pop: boolean;
  onToggle: (task: Task) => void;
  onMenu: (task: Task, at: { x: number; y: number }) => void;
}

export function TaskRow({
  task,
  listId,
  selected,
  pop,
  onToggle,
  onMenu,
}: TaskRowProps) {
  const done = task.completedAt !== null;

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
      <Checkbox
        className={styles.check}
        isSelected={done}
        onChange={() => onToggle(task)}
        aria-label={task.title}
        data-pop={pop || undefined}
      >
        <span className={styles.circle} aria-hidden>
          <Icon name="check" size={12} className={styles.tick} />
        </span>
      </Checkbox>
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
    </li>
  );
}
