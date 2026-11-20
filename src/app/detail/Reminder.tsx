import { lazy, Suspense, useRef, useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import { formatDue, today, weekdayOf } from "../../data/localDate.ts";
import type { Task } from "../../data/model.ts";
import {
  askToNotify,
  type NotifyPermission,
  notifyPermission,
} from "../../reminders/notify.ts";
import { formatTime, reminderPicks } from "../../reminders/times.ts";
import { useActions } from "../../state/AppContext.tsx";
import menu from "../../ui/ContextMenu.module.css";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { useToday } from "../../ui/useToday.ts";
import styles from "./PickerRow.module.css";

const ReminderPicker = lazy(() => import("./ReminderPicker.tsx"));

export function Reminder({ task }: { task: Task }) {
  const { updateTask } = useActions();
  const [picking, setPicking] = useState(false);
  // The picks are worked out when the menu opens, "later today" moves with the clock
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [permission, setPermission] =
    useState<NotifyPermission>(notifyPermission);
  const trigger = useRef<HTMLButtonElement>(null);
  const now = useToday();
  const at = task.reminderAt;
  const picks = reminderPicks(openedAt);

  const set = (reminderAt: number | null) => {
    updateTask(task.id, { reminderAt });
    if (reminderAt !== null) void askToNotify().then(setPermission);
  };

  const day = at === null ? null : formatDue(today(at), now, { long: true });
  const label = at === null ? "Remind me" : `Remind me at ${formatTime(at)}`;

  return (
    <>
      <div className={styles.row} data-set={at !== null || undefined}>
        <MenuTrigger
          onOpenChange={(open) => {
            if (open) setOpenedAt(Date.now());
          }}
        >
          <Button
            ref={trigger}
            className={styles.button}
            aria-label={day ? `${label}, ${day}` : label}
          >
            <Icon name="reminder" />
            <span className={styles.lines}>
              {label}
              {day && <span className={styles.sub}>{day}</span>}
            </span>
          </Button>
          <Popover placement="bottom start" className={menu.popover}>
            <Menu
              aria-label="Reminder"
              className={menu.menu}
              onAction={(key) => {
                const pick = picks.find((p) => p.id === key);
                if (pick) set(pick.at);
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
                  <Icon name="reminder" />
                  <span className={styles.pickLabel}>{p.label}</span>
                  <span className={styles.hint}>
                    {p.id === "later"
                      ? formatTime(p.at)
                      : `${weekdayOf(today(p.at))} ${formatTime(p.at)}`}
                  </span>
                </MenuItem>
              ))}
              <Separator className={menu.separator} />
              <MenuItem
                id="pick"
                textValue="Pick a date & time"
                className={menu.item}
              >
                <Icon name="planned" />
                Pick a date &amp; time
              </MenuItem>
              {at !== null && (
                <MenuItem
                  id="remove"
                  textValue="Remove reminder"
                  className={`${menu.item} ${menu.danger}`}
                >
                  <Icon name="delete" />
                  Remove reminder
                </MenuItem>
              )}
            </Menu>
          </Popover>
        </MenuTrigger>
        {at !== null && (
          <IconButton
            icon="close"
            label="Remove reminder"
            className={styles.remove}
            onPress={() => set(null)}
          />
        )}
        {picking && (
          <Suspense fallback={null}>
            <ReminderPicker
              triggerRef={trigger}
              value={at}
              onPick={(reminderAt) => {
                set(reminderAt);
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          </Suspense>
        )}
      </div>
      {at !== null &&
        (permission === "denied" || permission === "unsupported") && (
          <p className={styles.note}>
            Notifications are blocked for Doozly, so reminders only show while
            it's open.
          </p>
        )}
    </>
  );
}
