import { useSyncExternalStore } from "react";
import { today } from "../data/localDate.ts";
import type { LocalDate } from "../data/model.ts";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify() {
  for (const l of listeners) l();
}

// Wake up just after the next local midnight. A sleeping laptop can be late
// with timers, also focus and visibility check the date again too.
function schedule() {
  clearTimeout(timer);
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
  );
  timer = setTimeout(() => {
    notify();
    schedule();
  }, next.getTime() - now.getTime());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    schedule();
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      window.removeEventListener("focus", notify);
      document.removeEventListener("visibilitychange", notify);
    }
  };
}

/** Today's local date, and a re-render when it changes, like at midnight */
export function useToday(): LocalDate {
  // The date string itself is the snapshot, equal strings mean no re-render
  return useSyncExternalStore(subscribe, () => today());
}
