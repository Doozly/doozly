import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useLocation } from "wouter";
import { isDesktop, loadTauri, onDesktopEvent } from "../../platform.ts";
import { createDesktopScheduler } from "../../reminders/desktop.ts";
import { showNotification } from "../../reminders/notify.ts";
import type { OpenMessage } from "../../reminders/pushMessages.ts";
import {
  pendingReminders,
  type Reminder,
  type ReminderScheduler,
} from "../../reminders/reminders.ts";
import { createTabScheduler } from "../../reminders/tabScheduler.ts";
import { formatTime } from "../../reminders/times.ts";
import { useAppState } from "../../state/AppContext.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { paths } from "../routes.ts";
import styles from "./Reminders.module.css";
import { useRelayReminders } from "./useRelayReminders.ts";

/**
 * Fires reminders while the app is open. A system notification when that's
 * allowed, else a card in the corner, so a reminder never goes by unseen.
 */
export function Reminders() {
  const tasks = useAppState((s) => s.tasks);
  const lists = useAppState((s) => s.lists);
  const [, navigate] = useLocation();
  const [cards, setCards] = useState<Reminder[]>([]);
  const scheduler = useRef<ReminderScheduler | null>(null);

  const open = (r: Reminder) => navigate(paths.task(r.listId, r.taskId));
  const dismiss = (id: string) =>
    setCards((all) => all.filter((c) => c.id !== id));

  const fire = useEffectEvent((r: Reminder) => {
    if (showNotification(r, () => open(r))) return;
    setCards((all) => [...all.filter((c) => c.taskId !== r.taskId), r]);
  });

  const reminders = useMemo(
    () => pendingReminders(tasks, lists),
    [tasks, lists],
  );
  const current = useEffectEvent(() => reminders);
  const go = useEffectEvent((path: string) => navigate(path));

  useEffect(() => {
    if (!isDesktop()) {
      const s = createTabScheduler((r) => fire(r));
      scheduler.current = s;
      return () => {
        s.dispose();
        scheduler.current = null;
      };
    }
    // The Rust side fires them, also with the window closed, and says which task a click opens
    let gone = false;
    void loadTauri().then(({ invoke }) => {
      if (gone) return;
      const s = createDesktopScheduler(invoke, (r) =>
        paths.task(r.listId, r.taskId),
      );
      scheduler.current = s;
      void s.sync(current());
    });
    const stop = onDesktopEvent<string>("doozly:open", go);
    return () => {
      gone = true;
      stop();
      scheduler.current = null;
    };
  }, []);

  useEffect(() => {
    void scheduler.current?.sync(reminders);
  }, [reminders]);
  useRelayReminders(reminders);

  // A click on a pushed reminder, while Doozly was open already
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent<Partial<OpenMessage>>) => {
      const { type, path } = e.data ?? {};
      if (type === "doozly:open" && typeof path === "string") navigate(path);
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [navigate]);

  if (cards.length === 0) return null;
  return (
    <section aria-label="Reminders" className={styles.stack}>
      {cards.map((r) => (
        <div key={r.id} role="alert" className={styles.card}>
          <Icon name="reminder" className={styles.icon} />
          <div className={styles.text}>
            <span className={styles.title}>{r.title}</span>
            <span className={styles.meta}>
              {r.body} · {formatTime(r.fireAt)}
            </span>
          </div>
          <div className={styles.buttons}>
            <Button
              className={`${styles.button} ${styles.primary}`}
              onPress={() => {
                open(r);
                dismiss(r.id);
              }}
            >
              Open
            </Button>
            <Button className={styles.button} onPress={() => dismiss(r.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
