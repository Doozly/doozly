import type { List, Task } from "../data/model.ts";

export interface Reminder {
  /** Changes when the time does, so an edited reminder counts as a new one */
  id: string;
  taskId: string;
  listId: string;
  /** Epoch ms */
  fireAt: number;
  title: string;
  /** The list's name, shown under the title */
  body: string;
}

/** The in-tab scheduler, and later the relay, take the same full set */
export interface ReminderScheduler {
  /** The full set wanted from now on. Calling it twice with the same set changes nothing. */
  sync(reminders: Reminder[]): Promise<void>;
}

/** Every reminder of a task that's still open */
export function pendingReminders(
  tasks: Record<string, Task>,
  lists: Record<string, List>,
): Reminder[] {
  const out: Reminder[] = [];
  for (const t of Object.values(tasks)) {
    if (t.reminderAt === null || t.completedAt !== null) continue;
    if (t.deletedAt !== null) continue;
    const list = lists[t.listId];
    if (!list || list.deletedAt !== null) continue;
    out.push({
      id: `${t.id}@${t.reminderAt}`,
      taskId: t.id,
      listId: t.listId,
      fireAt: t.reminderAt,
      title: t.title,
      body: list.title,
    });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}
