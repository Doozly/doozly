import { useEffect, useEffectEvent, useRef } from "react";
import { importReminderKey, newReminderKey } from "../../reminders/crypto.ts";
import { createRelay, createRelayScheduler } from "../../reminders/relay.ts";
import type { Reminder } from "../../reminders/reminders.ts";
import { useActions, useApp, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { useSession, useSessionState } from "../account/SessionContext.tsx";

interface Options {
  url?: string;
  wait?: number;
}

/**
 * Keeps the relay's copy of the reminders current, for when the app is closed.
 * Only the tab that syncs does it, and only after its first pull: by then a key
 * made on another device has arrived, and we don't make a second one.
 */
export function useRelayReminders(
  reminders: Reminder[],
  { url = import.meta.env.VITE_RELAY_URL, wait }: Options = {},
) {
  const session = useSession();
  const app = useApp();
  const { setSetting } = useActions();
  const ready = useSessionState((s) => s.sync?.lastSyncedAt != null);
  const keyRaw = useAppState((s) => setting(s, "reminderKey"));
  const scheduler = useRef<ReturnType<typeof createRelayScheduler> | null>(
    null,
  );
  const first = useEffectEvent((s: { sync(r: Reminder[]): unknown }) => {
    void s.sync(reminders);
  });

  useEffect(() => {
    if (!url || !session || !ready) return;
    const relay = createRelay({
      url,
      renewSession: () => session.renewRelay(),
    });
    let imported: { raw: string; key: Promise<CryptoKey> } | null = null;
    const key = async () => {
      let raw = setting(app.store.getState(), "reminderKey");
      if (!raw) {
        raw = newReminderKey();
        setSetting("reminderKey", raw);
      }
      if (imported?.raw !== raw) {
        imported = { raw, key: importReminderKey(raw) };
      }
      return { raw, key: await imported.key };
    };
    const s = createRelayScheduler({ relay, key, wait });
    scheduler.current = s;
    first(s);
    return () => {
      s.dispose();
      scheduler.current = null;
    };
  }, [url, wait, session, ready, app, setSetting]);

  // A key that came in from another device seals everything anew
  useEffect(() => {
    void keyRaw;
    void scheduler.current?.sync(reminders);
  }, [reminders, keyRaw]);
}
