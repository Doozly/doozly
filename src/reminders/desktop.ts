import type { Reminder, ReminderScheduler } from "./reminders.ts";

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Hands the set to the desktop app's Rust side, which keeps the timers and shows
 * native notifications, also with the window closed.
 */
export function createDesktopScheduler(
  invoke: Invoke,
  pathOf: (r: Reminder) => string,
): ReminderScheduler {
  let sent: string | null = null;
  return {
    async sync(reminders) {
      const set = reminders.map((r) => ({
        id: r.id,
        fireAt: r.fireAt,
        title: r.title,
        body: r.body,
        path: pathOf(r),
      }));
      // Typing a title changes the set on every key, but most changes leave it as it was
      const json = JSON.stringify(set);
      if (json === sent) return;
      sent = json;
      await invoke("set_reminders", { reminders: set });
    },
  };
}
