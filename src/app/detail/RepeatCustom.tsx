import { type RefObject, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Popover,
  ToggleButton,
} from "react-aria-components";
import type { LocalDate, RepeatRule, Weekday } from "../../data/model.ts";
import { dayOfWeek } from "../../data/repeat.ts";
import styles from "./RepeatCustom.module.css";
import { DAY_NAMES, unitWord, WEEK } from "./repeatLabel.ts";

interface RepeatCustomProps {
  triggerRef: RefObject<HTMLElement | null>;
  value: RepeatRule | null;
  /** The due date, or today when there's none */
  on: LocalDate;
  onSave: (rule: RepeatRule) => void;
  onClose: () => void;
}

const UNITS: RepeatRule["unit"][] = ["day", "week", "month", "year"];

// Its own chunk, loaded the first time someone opens Custom
export default function RepeatCustom({
  triggerRef,
  value,
  on,
  onSave,
  onClose,
}: RepeatCustomProps) {
  const [every, setEvery] = useState(String(value?.interval ?? 1));
  const [unit, setUnit] = useState(value?.unit ?? "week");
  const [days, setDays] = useState<Weekday[]>(
    value?.weekdays?.length ? value.weekdays : [dayOfWeek(on)],
  );
  const parsed = Number.parseInt(every, 10);
  const interval = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 999)
    : 1;

  const toggle = (day: Weekday, selected: boolean) => {
    // At least one day stays picked, a weekly repeat on no day makes no sense
    if (!selected && days.length === 1) return;
    setDays(selected ? [...days, day] : days.filter((d) => d !== day));
  };

  const save = () => {
    if (unit === "week") {
      onSave({
        unit,
        interval,
        weekdays: WEEK.filter((d) => days.includes(d)),
      });
    } else if (unit === "day") {
      onSave({ unit, interval });
    } else {
      const monthDay = value?.monthDay ?? Number(on.slice(8, 10));
      onSave({ unit, interval, monthDay });
    }
  };

  return (
    <Popover
      triggerRef={triggerRef}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="bottom start"
      className={styles.popover}
    >
      <Dialog aria-labelledby="repeat-custom-title" className={styles.dialog}>
        <Heading id="repeat-custom-title" slot="title" className={styles.title}>
          Repeat every…
        </Heading>
        <div className={styles.every}>
          <input
            type="number"
            aria-label="Interval"
            className={styles.field}
            min={1}
            max={999}
            value={every}
            onChange={(e) => setEvery(e.target.value)}
            onBlur={() => setEvery(String(interval))}
            autoFocus
          />
          <select
            aria-label="Unit"
            className={styles.field}
            value={unit}
            onChange={(e) => setUnit(e.target.value as RepeatRule["unit"])}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {unitWord(u, interval)}
              </option>
            ))}
          </select>
        </div>
        {unit === "week" && (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border and legend quirks
          <div role="group" aria-label="On these days" className={styles.days}>
            {WEEK.map((d) => (
              <ToggleButton
                key={d}
                aria-label={DAY_NAMES[d]}
                className={styles.day}
                isSelected={days.includes(d)}
                onChange={(selected) => toggle(d, selected)}
              >
                {DAY_NAMES[d]?.slice(0, 2)}
              </ToggleButton>
            ))}
          </div>
        )}
        <div className={styles.buttons}>
          <Button className={styles.save} onPress={save}>
            Save
          </Button>
        </div>
      </Dialog>
    </Popover>
  );
}
