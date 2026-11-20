import { lazy, Suspense, useRef, useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import {
  addDays,
  formatDue,
  isBefore,
  nextWeek,
  weekdayOf,
} from "../../data/localDate.ts";
import type { LocalDate, Task } from "../../data/model.ts";
import { useActions } from "../../state/AppContext.tsx";
import menu from "../../ui/ContextMenu.module.css";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { useToday } from "../../ui/useToday.ts";
import styles from "./PickerRow.module.css";

const DueCalendar = lazy(() => import("./DueCalendar.tsx"));

/** "Due today", "Due tomorrow", "Due Thu 26 November" */
export function dueLabel(due: LocalDate, now: LocalDate): string {
  const when = formatDue(due, now, { long: true });
  return /^(Today|Tomorrow|Yesterday)$/.test(when)
    ? `Due ${when.toLowerCase()}`
    : `Due ${when}`;
}

export function DueDate({ task }: { task: Task }) {
  const { updateTask } = useActions();
  const [picking, setPicking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const now = useToday();
  const due = task.dueDate;
  const overdue =
    due !== null && task.completedAt === null && isBefore(due, now);
  const set = (dueDate: LocalDate | null) => updateTask(task.id, { dueDate });

  const picks: { id: string; label: string; date: LocalDate }[] = [
    { id: "today", label: "Today", date: now },
    { id: "tomorrow", label: "Tomorrow", date: addDays(now, 1) },
    { id: "nextWeek", label: "Next week", date: nextWeek(now) },
  ];

  return (
    <div
      className={styles.row}
      data-set={due !== null || undefined}
      data-overdue={overdue || undefined}
    >
      <MenuTrigger>
        <Button ref={trigger} className={styles.button}>
          <Icon name="dueDate" />
          {due ? dueLabel(due, now) : "Add due date"}
        </Button>
        <Popover placement="bottom start" className={menu.popover}>
          <Menu
            aria-label="Due date"
            className={menu.menu}
            onAction={(key) => {
              const pick = picks.find((p) => p.id === key);
              if (pick) set(pick.date);
              if (key === "pick") setPicking(true);
              if (key === "remove") set(null);
            }}
          >
            {picks.map((p) => (
              <MenuItem
                key={p.id}
                id={p.id}
                textValue={p.label}
                className={menu.item}
              >
                <Icon name="dueDate" />
                <span className={styles.pickLabel}>{p.label}</span>
                <span className={styles.hint}>{weekdayOf(p.date)}</span>
              </MenuItem>
            ))}
            <Separator className={menu.separator} />
            <MenuItem id="pick" textValue="Pick a date" className={menu.item}>
              <Icon name="planned" />
              Pick a date
            </MenuItem>
            {due && (
              <MenuItem
                id="remove"
                textValue="Remove due date"
                className={`${menu.item} ${menu.danger}`}
              >
                <Icon name="delete" />
                Remove due date
              </MenuItem>
            )}
          </Menu>
        </Popover>
      </MenuTrigger>
      {due && (
        <IconButton
          icon="close"
          label="Remove due date"
          className={styles.remove}
          onPress={() => set(null)}
        />
      )}
      {picking && (
        <Suspense fallback={null}>
          <DueCalendar
            triggerRef={trigger}
            value={due}
            onPick={(date) => {
              set(date);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
