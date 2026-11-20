import { lazy, Suspense, useRef, useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import type { RepeatRule, Task } from "../../data/model.ts";
import {
  firstOccurrence,
  presetRule,
  type RepeatPreset,
} from "../../data/repeat.ts";
import { useActions } from "../../state/AppContext.tsx";
import menu from "../../ui/ContextMenu.module.css";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { useToday } from "../../ui/useToday.ts";
import styles from "./PickerRow.module.css";
import { describeRepeat } from "./repeatLabel.ts";

const RepeatCustom = lazy(() => import("./RepeatCustom.tsx"));

const PRESETS: { id: RepeatPreset; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

export function Repeat({ task }: { task: Task }) {
  const { updateTask } = useActions();
  const [custom, setCustom] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const now = useToday();
  const rule = task.repeat;
  const on = task.dueDate ?? now;

  // A repeat needs a due date to count from, so like To Do it gets one
  const set = (repeat: RepeatRule | null) =>
    updateTask(task.id, {
      repeat,
      ...(repeat && !task.dueDate
        ? { dueDate: firstOccurrence(repeat, now) }
        : {}),
    });

  return (
    <div className={styles.row} data-set={rule !== null || undefined}>
      <MenuTrigger>
        <Button ref={trigger} className={styles.button}>
          <Icon name="repeat" />
          {rule ? describeRepeat(rule) : "Repeat"}
        </Button>
        <Popover placement="bottom start" className={menu.popover}>
          <Menu
            aria-label="Repeat"
            className={menu.menu}
            onAction={(key) => {
              const preset = PRESETS.find((p) => p.id === key);
              if (preset) set(presetRule(preset.id, on));
              if (key === "custom") setCustom(true);
              if (key === "never") set(null);
            }}
          >
            {PRESETS.map((p) => (
              <MenuItem
                key={p.id}
                id={p.id}
                textValue={p.label}
                className={menu.item}
              >
                <Icon name="repeat" />
                {p.label}
              </MenuItem>
            ))}
            <Separator className={menu.separator} />
            <MenuItem id="custom" textValue="Custom" className={menu.item}>
              <Icon name="planned" />
              Custom
            </MenuItem>
            {rule && (
              <MenuItem
                id="never"
                textValue="Never repeat"
                className={`${menu.item} ${menu.danger}`}
              >
                <Icon name="delete" />
                Never repeat
              </MenuItem>
            )}
          </Menu>
        </Popover>
      </MenuTrigger>
      {rule && (
        <IconButton
          icon="close"
          label="Never repeat"
          className={styles.remove}
          onPress={() => set(null)}
        />
      )}
      {custom && (
        <Suspense fallback={null}>
          <RepeatCustom
            triggerRef={trigger}
            value={rule}
            on={on}
            onSave={(next) => {
              set(next);
              setCustom(false);
            }}
            onClose={() => setCustom(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
