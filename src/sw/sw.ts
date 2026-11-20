import { openDB } from "idb";
import { importReminderKey } from "../reminders/crypto.ts";
import {
  openFromNotification,
  showReminder,
} from "../reminders/pushMessages.ts";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** The user's reminder key, straight from the app's IndexedDB */
async function reminderKey(): Promise<CryptoKey | null> {
  // No version: we read whatever is there. If there's no database yet we mustn't
  // make an empty one, the app's first migration would then never run.
  const db = await openDB("doozly", undefined, {
    upgrade(_db, _old, _new, tx) {
      tx.abort();
    },
    blocking() {
      db.close();
    },
  });
  try {
    if (!db.objectStoreNames.contains("settings")) return null;
    const record = (await db.get("settings", "reminderKey")) as
      | { value?: unknown }
      | undefined;
    return typeof record?.value === "string" && record.value
      ? await importReminderKey(record.value)
      : null;
  } finally {
    db.close();
  }
}

self.addEventListener("push", (event) => {
  let data: unknown = null;
  try {
    data = event.data?.json();
  } catch {
    // Not JSON, then it's shown as a plain reminder
  }
  event.waitUntil(
    showReminder(data, {
      key: reminderKey,
      show: (title, options) =>
        self.registration.showNotification(title, options),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    openFromNotification(event.notification.data, {
      windows: () =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true }),
      openWindow: (path) => self.clients.openWindow(path),
    }),
  );
});

// The browser renewed the subscription by itself, the relay needs the new one
self.addEventListener("pushsubscriptionchange", (event) => {
  const relay = import.meta.env.VITE_RELAY_URL;
  if (!relay) return;
  (event as ExtendableEvent).waitUntil(
    (async () => {
      const res = await fetch(`${relay}/v1/push/key`);
      const { publicKey } = (await res.json()) as { publicKey: string };
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      await fetch(`${relay}/v1/push/subscription`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
