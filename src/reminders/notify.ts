import type { Reminder } from "./reminders.ts";

export type NotifyPermission = NotificationPermission | "unsupported";

export function notifyPermission(): NotifyPermission {
  return typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
}

/** Asks once, from a click. Browsers ignore the prompt without one. */
export async function askToNotify(): Promise<NotifyPermission> {
  const now = notifyPermission();
  if (now !== "default") return now;
  try {
    return await Notification.requestPermission();
  } catch {
    // Old Safari only knows the callback form
    return new Promise((resolve) => {
      Notification.requestPermission(resolve);
    });
  }
}

/**
 * A system notification, or false when we may not show one. The tag makes the
 * same reminder from two open tabs show up once.
 */
export function showNotification(
  reminder: Reminder,
  onClick: () => void,
): boolean {
  if (notifyPermission() !== "granted") return false;
  try {
    const n = new Notification(reminder.title, {
      body: reminder.body,
      tag: reminder.id,
      icon: "/apple-touch-icon.png",
    });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
    return true;
  } catch {
    // Android Chrome only shows them through a service worker, that's the next step
    return false;
  }
}
