import { useEffect, useRef } from "react";

/**
 * Calls `fn` once things went quiet for `ms`. `flush` runs a waiting call right
 * now, and it also runs by itself on unmount, so closing a pane never drops an edit.
 */
export function useDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
) {
  const latest = useRef(fn);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; args: A }>(
    null,
  );
  latest.current = fn;

  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    latest.current(...p.args);
  };

  const call = (...args: A) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { timer: setTimeout(flush, ms), args };
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: flush only reads refs
  useEffect(() => flush, []);

  return { call, flush };
}
