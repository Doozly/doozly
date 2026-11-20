import type { KeyboardEvent } from "react";

/**
 * Up, Down, Home and End from one item to the next. Items carry `data-nav` with the same
 * value, inside one `data-nav-root`. Says whether it handled the key.
 */
export function arrowFocus(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return false;
  const kind = e.currentTarget.dataset.nav;
  const root = e.currentTarget.closest("[data-nav-root]");
  if (!kind || !root) return false;
  const items = [...root.querySelectorAll<HTMLElement>(`[data-nav="${kind}"]`)];
  const at = items.indexOf(e.currentTarget);
  const next =
    e.key === "ArrowUp"
      ? items[at - 1]
      : e.key === "ArrowDown"
        ? items[at + 1]
        : e.key === "Home"
          ? items[0]
          : items.at(-1);
  // Also at the ends, so the page doesn't scroll away under the focus
  e.preventDefault();
  next?.focus();
  return true;
}

/** Puts the focus on a task's row once it's rendered, like after closing its details */
export function focusTaskSoon(taskId: string) {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(
        `main [data-task-id="${CSS.escape(taskId)}"] [data-nav="task"]`,
      )
      ?.focus();
  });
}
