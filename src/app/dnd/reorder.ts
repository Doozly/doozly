import type { Placement } from "../../state/actions.ts";

/** The new neighbours of the item at `from` once it sits at `to` */
export function placementAt(
  ids: string[],
  from: number,
  to: number,
): Placement {
  const order = ids.filter((_, i) => i !== from);
  order.splice(to, 0, ids[from] ?? "");
  return { prevId: order[to - 1] ?? null, nextId: order[to + 1] ?? null };
}

/** One step up or down, null when it's at the edge already */
export function nudge(ids: string[], id: string, by: -1 | 1): Placement | null {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  return placementAt(ids, from, to);
}

/** Alt+Up and Alt+Down move the focused item, the keyboard way to reorder */
export function moveKey(e: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): -1 | 1 | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === "ArrowUp") return -1;
  if (e.key === "ArrowDown") return 1;
  return null;
}

/** Tell aria-keyshortcuts about it */
export const MOVE_KEYS = "Alt+ArrowUp Alt+ArrowDown";
