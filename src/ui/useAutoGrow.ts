import { type RefObject, useLayoutEffect } from "react";

/** Makes a textarea as tall as its text, measured again whenever `value` changes */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger to measure again
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);
}
