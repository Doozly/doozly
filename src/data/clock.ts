// "<ms, 13 digits>:<counter, 4 base36>:<node>", so plain string compare = time order.
// It's the local half of a hybrid logical clock, receiving remote stamps comes with sync.
export type Stamp = string;

const node = crypto.randomUUID().slice(0, 8);
let lastMs = 0;
let counter = 0;

export function stamp(now = Date.now()): Stamp {
  // If the wall clock jumps back we keep the old ms and count up, so stamps never go backwards
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    counter++;
  }
  return `${String(lastMs).padStart(13, "0")}:${counter.toString(36).padStart(4, "0")}:${node}`;
}

export function stampTime(s: Stamp): number {
  return Number(s.slice(0, 13));
}
