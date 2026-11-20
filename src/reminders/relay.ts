import { type ReminderContent, seal, toBase64 } from "./crypto.ts";
import type { Reminder, ReminderScheduler } from "./reminders.ts";

export class RelayError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The relay answered ${status}`);
    this.status = status;
  }
}

interface RelayOptions {
  url: string;
  /** Gets a relay session when there's none. true when that worked. */
  renewSession: () => Promise<boolean>;
  fetch?: typeof fetch;
}

/** The relay's push and reminder endpoints, signed in with its session cookie */
export function createRelay({
  url,
  renewSession,
  fetch: fetchImpl = (...args) => fetch(...args),
}: RelayOptions) {
  async function call(path: string, init: RequestInit = {}) {
    const go = () =>
      fetchImpl(`${url}${path}`, {
        ...init,
        credentials: "include",
        headers: init.body ? { "Content-Type": "application/json" } : {},
      });
    let res = await go();
    // The session ran out or never was, like after a Microsoft sign-in: one go at a new one
    if (res.status === 401 && (await renewSession())) res = await go();
    if (!res.ok) throw new RelayError(res.status);
    return res;
  }

  return {
    async putReminders(
      reminders: { id: string; fireAt: number; payload: string }[],
    ) {
      await call("/v1/reminders", {
        method: "PUT",
        body: JSON.stringify({ reminders }),
      });
    },
    async pushKey(): Promise<string> {
      const res = await call("/v1/push/key");
      return ((await res.json()) as { publicKey: string }).publicKey;
    },
    async subscribe(subscription: PushSubscriptionJSON) {
      await call("/v1/push/subscription", {
        method: "PUT",
        body: JSON.stringify(subscription),
      });
    },
    async unsubscribe(endpoint: string) {
      await call("/v1/push/subscription", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      });
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;

interface SchedulerOptions {
  relay: Pick<Relay, "putReminders">;
  /** The user's key, made on first use. `raw` tells when it changed. */
  key: () => Promise<{ raw: string; key: CryptoKey }>;
  /** Typing a title changes the set on every key, also it waits for a pause */
  wait?: number;
  retry?: number;
  /** Sent again after this long even when nothing changed, so a wiped relay fills up again */
  refresh?: number;
}

/**
 * Hands the relay the full set of reminders still to come, sealed, for when
 * the app is closed. Only sends when something changed.
 */
export function createRelayScheduler({
  relay,
  key,
  wait = 2000,
  retry = 60_000,
  refresh = 60 * 60_000,
}: SchedulerOptions): ReminderScheduler & { dispose(): void } {
  let latest: Reminder[] = [];
  let sent: { signature: string; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let disposed = false;

  const later = (ms: number) => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void flush(), ms);
  };

  async function send() {
    const now = Date.now();
    const coming = latest.filter((r) => r.fireAt > now);
    const { raw, key: k } = await key();
    const signature = JSON.stringify([
      raw,
      coming.map((r) => [r.id, r.title, r.body]),
    ]);
    if (sent?.signature === signature && now - sent.at < refresh) return;
    const reminders = await Promise.all(
      coming.map(async (r) => {
        const content: ReminderContent = {
          title: r.title,
          list: r.body,
          taskId: r.taskId,
          listId: r.listId,
        };
        return {
          id: r.id,
          fireAt: r.fireAt,
          payload: toBase64(await seal(k, r.id, content)),
        };
      }),
    );
    await relay.putReminders(reminders);
    sent = { signature, at: now };
  }

  async function flush() {
    // One at a time; a change during a send gets its own turn after
    if (running) return later(wait);
    running = send()
      .catch(() => later(retry))
      .finally(() => {
        running = null;
      });
    await running;
  }

  return {
    async sync(set) {
      latest = set;
      later(wait);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
