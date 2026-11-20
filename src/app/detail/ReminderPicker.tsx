import {
  type CalendarDate,
  getLocalTimeZone,
  parseDate,
  Time,
  today,
} from "@internationalized/date";
import { type RefObject, useState } from "react";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DateSegment,
  Dialog,
  Heading,
  I18nProvider,
  Label,
  Popover,
  TimeField,
} from "react-aria-components";
import { today as localToday } from "../../data/localDate.ts";
import { atTime } from "../../reminders/times.ts";
import { Icon } from "../../ui/Icon.tsx";
import calendar from "./DueCalendar.module.css";
import styles from "./ReminderPicker.module.css";

interface ReminderPickerProps {
  triggerRef: RefObject<HTMLElement | null>;
  /** Epoch ms, or null for none yet */
  value: number | null;
  onPick: (at: number) => void;
  onClose: () => void;
}

// Its own chunk, loaded the first time someone picks a date and time
export default function ReminderPicker({
  triggerRef,
  value,
  onPick,
  onClose,
}: ReminderPickerProps) {
  const [date, setDate] = useState<CalendarDate>(() =>
    value === null ? today(getLocalTimeZone()) : parseDate(localToday(value)),
  );
  const [time, setTime] = useState<Time>(() => {
    if (value !== null) {
      const d = new Date(value);
      return new Time(d.getHours(), d.getMinutes());
    }
    // Nothing set yet, then the next full hour
    return new Time((new Date().getHours() + 1) % 24, 0);
  });

  return (
    <Popover
      triggerRef={triggerRef}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="bottom start"
      className={calendar.popover}
    >
      <Dialog aria-label="Pick a date & time" className={styles.dialog}>
        {/* en-GB, so weeks start on Monday and the time is 24-hour */}
        <I18nProvider locale="en-GB">
          <Calendar aria-label="Reminder date" value={date} onChange={setDate}>
            <header className={calendar.header}>
              <Button slot="previous" className={calendar.nav}>
                <Icon name="chevronLeft" size={16} />
              </Button>
              <Heading className={calendar.month} />
              <Button slot="next" className={calendar.nav}>
                <Icon name="chevronRight" size={16} />
              </Button>
            </header>
            <CalendarGrid className={calendar.grid}>
              {(d) => <CalendarCell date={d} className={calendar.cell} />}
            </CalendarGrid>
          </Calendar>
          <TimeField
            className={styles.time}
            value={time}
            onChange={(t) => {
              if (t) setTime(t);
            }}
            hourCycle={24}
            shouldForceLeadingZeros
          >
            <Label className={styles.label}>Time</Label>
            <DateInput className={styles.input}>
              {(segment) => (
                <DateSegment segment={segment} className={styles.segment} />
              )}
            </DateInput>
          </TimeField>
        </I18nProvider>
        <div className={styles.buttons}>
          <Button
            className={styles.save}
            onPress={() =>
              onPick(atTime(date.toString(), time.hour, time.minute))
            }
          >
            Save
          </Button>
        </div>
      </Dialog>
    </Popover>
  );
}
