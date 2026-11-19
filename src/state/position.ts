import { generateKeyBetween } from "fractional-indexing";
import type { Position } from "../data/model.ts";

/** A position that sorts between the two, null meaning the start or the end */
export function positionBetween(
  before: Position | null,
  after: Position | null,
): Position {
  // Two devices can add at the same spot and end up with the same position.
  // Then there is no room between them, also we go right after the first one.
  if (before !== null && after !== null && before >= after) {
    return generateKeyBetween(before, null);
  }
  return generateKeyBetween(before, after);
}

/** Plain code-unit order, never localeCompare. Ties fall back to the id so all devices agree. */
export function byPosition<T extends { position: Position; id: string }>(
  a: T,
  b: T,
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
