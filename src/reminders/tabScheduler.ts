import type { Reminder, ReminderScheduler } from "./reminders.ts";

// Long timeouts overflow past ~24 days and drift when the clock changes, also wake up hourly
const MAX_WAIT = 60 * 60 * 1000;

export interface TabScheduler extends ReminderScheduler {
  dispose(): void;
}

/**
 * Fires reminders while the app is open. Only times that pass while this tab
 * watches count: nothing from before it opened bursts out on load (the relay
 * covered those), but a laptop waking from sleep still gets what it slept through.
 */
export function createTabScheduler(
  onFire: (reminder: Reminder) => void,
): TabScheduler {
  let reminders: Reminder[] = [];
  let checkedUpTo = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function check() {
    clearTimeout(timer);
    const now = Date.now();
    const due = reminders.filter(
      (r) => r.fireAt > checkedUpTo && r.fireAt <= now,
    );
    checkedUpTo = Math.max(checkedUpTo, now);
    for (const r of due) onFire(r);

    const next = reminders.find((r) => r.fireAt > now);
    if (next) timer = setTimeout(check, Math.min(next.fireAt - now, MAX_WAIT));
  }

  return {
    async sync(set) {
      // What came due goes out first, so one set just now in the past never fires
      check();
      reminders = [...set].sort((a, b) => a.fireAt - b.fireAt);
      check();
    },
    dispose() {
      clearTimeout(timer);
      reminders = [];
    },
  };
}
