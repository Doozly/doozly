import { fromBase64, open } from "./crypto.ts";

// What the service worker does with a push and a click. Kept out of the worker
// itself, so the tests can run it with fakes.

/** What the relay sends: the reminder id and the payload, still sealed */
export interface PushMessage {
  id: string;
  payload: string;
}

interface ShowDeps {
  /** The user's key from IndexedDB, null when there's none on this device */
  key: () => Promise<CryptoKey | null>;
  show: (title: string, options: NotificationOptions) => Promise<void>;
}

const taskPath = (listId: string, taskId: string) =>
  `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;

function asMessage(data: unknown): PushMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { id, payload } = data as Record<string, unknown>;
  return typeof id === "string" && typeof payload === "string"
    ? { id, payload }
    : null;
}

/**
 * Always shows something: browsers punish a push that shows nothing. If the
 * payload doesn't open (like a key that changed on another device), a plain one.
 */
export async function showReminder(data: unknown, { key, show }: ShowDeps) {
  const message = asMessage(data);
  let content = null;
  if (message) {
    const k = await key().catch(() => null);
    if (k) content = await open(k, message.id, fromBase64(message.payload));
  }
  await show(content?.title ?? "Reminder", {
    body: content?.list ?? "Open Doozly to see it",
    tag: message?.id,
    icon: "/icon-192.png",
    data: { path: content ? taskPath(content.listId, content.taskId) : "/" },
  });
}

interface WindowLike {
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

interface OpenDeps {
  windows: () => Promise<readonly WindowLike[]>;
  openWindow: (path: string) => Promise<unknown>;
}

export interface OpenMessage {
  type: "doozly:open";
  path: string;
}

/** An open Doozly gets focused and goes to the task, else a new window opens on it */
export async function openFromNotification(
  data: unknown,
  { windows, openWindow }: OpenDeps,
) {
  const raw = (data as { path?: unknown } | null)?.path;
  // Only our own paths, never somewhere else
  const path = typeof raw === "string" && /^\/(?![/\\])/.test(raw) ? raw : "/";
  const [win] = await windows();
  if (win) {
    await win.focus();
    win.postMessage({ type: "doozly:open", path } satisfies OpenMessage);
    return;
  }
  await openWindow(path);
}
