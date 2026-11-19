import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import type { RefObject } from "react";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  Dialog,
  Heading,
  I18nProvider,
  Popover,
} from "react-aria-components";
import type { LocalDate } from "../../data/model.ts";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./DueCalendar.module.css";

interface DueCalendarProps {
  triggerRef: RefObject<HTMLElement | null>;
  value: LocalDate | null;
  onPick: (date: LocalDate) => void;
  onClose: () => void;
}

// Its own chunk, loaded the first time someone picks a date
export default function DueCalendar({
  triggerRef,
  value,
  onPick,
  onClose,
}: DueCalendarProps) {
  const current = value ? parseDate(value) : undefined;

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
      <Dialog aria-label="Pick a due date" className={styles.dialog}>
        {/* en-GB, so weeks start on Monday and the month reads the UK way */}
        <I18nProvider locale="en-GB">
          <Calendar
            aria-label="Due date"
            defaultValue={current}
            defaultFocusedValue={current ?? today(getLocalTimeZone())}
            onChange={(date) => onPick(date.toString())}
          >
            <header className={styles.header}>
              <Button slot="previous" className={styles.nav}>
                <Icon name="chevronLeft" size={16} />
              </Button>
              <Heading className={styles.month} />
              <Button slot="next" className={styles.nav}>
                <Icon name="chevronRight" size={16} />
              </Button>
            </header>
            <CalendarGrid className={styles.grid}>
              {(date) => <CalendarCell date={date} className={styles.cell} />}
            </CalendarGrid>
          </Calendar>
        </I18nProvider>
      </Dialog>
    </Popover>
  );
}
