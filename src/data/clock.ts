// "<ms, 13 digits>:<counter, 4 base36>:<node>", so plain string compare = time order.
// A hybrid logical clock: wall time when it can, a counter when it can't.
export type Stamp = string;

/**
 * A remote stamp further ahead than this is a broken clock, we don't follow it.
 * Generous, also a device set to the wrong time zone is still followed.
 */
export const MAX_DRIFT_MS = 24 * 3_600_000;

const MAX_COUNTER = 36 ** 4 - 1;

export function stampTime(s: Stamp): number {
  return Number(s.slice(0, 13));
}

function stampCounter(s: Stamp): number {
  return Number.parseInt(s.slice(14, 18), 36);
}

export function createClock(node: string = crypto.randomUUID().slice(0, 8)) {
  let lastMs = 0;
  let counter = 0;

  const format = () =>
    `${String(lastMs).padStart(13, "0")}:${counter.toString(36).padStart(4, "0")}:${node}`;

  const tick = () => {
    // Out of counter in one ms, also we borrow the next one
    if (counter >= MAX_COUNTER) {
      lastMs++;
      counter = 0;
    } else {
      counter++;
    }
  };

  return {
    node,

    /** A new stamp for a local change. Never goes backwards, even when the wall clock does. */
    stamp(now = Date.now()): Stamp {
      if (now > lastMs) {
        lastMs = now;
        counter = 0;
      } else {
        tick();
      }
      return format();
    },

    /**
     * Takes in a stamp from another device, so our next stamp sorts after it.
     * That's what makes "edit after seeing their change" win, whatever our wall clock says.
     */
    receive(remote: Stamp, now = Date.now()): void {
      const remoteMs = stampTime(remote);
      if (!Number.isFinite(remoteMs) || remoteMs > now + MAX_DRIFT_MS) return;
      if (remoteMs > lastMs) {
        lastMs = remoteMs;
        counter = stampCounter(remote);
      } else if (remoteMs === lastMs) {
        counter = Math.max(counter, stampCounter(remote));
      }
    },
  };
}

export type Clock = ReturnType<typeof createClock>;

/** This device's clock */
export const clock = createClock();

export const stamp = (now?: number): Stamp => clock.stamp(now);
