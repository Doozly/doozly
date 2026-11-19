import { expect, test } from "vitest";
import { moveKey, nudge, placementAt } from "./reorder.ts";

const ids = ["a", "b", "c", "d"];

test("placementAt gives the neighbours after the move", () => {
  expect(placementAt(ids, 0, 2)).toEqual({ prevId: "c", nextId: "d" });
  expect(placementAt(ids, 3, 0)).toEqual({ prevId: null, nextId: "a" });
  expect(placementAt(ids, 1, 3)).toEqual({ prevId: "d", nextId: null });
});

test("nudge stops at the edges", () => {
  expect(nudge(ids, "b", -1)).toEqual({ prevId: null, nextId: "a" });
  expect(nudge(ids, "b", 1)).toEqual({ prevId: "c", nextId: "d" });
  expect(nudge(ids, "a", -1)).toBeNull();
  expect(nudge(ids, "d", 1)).toBeNull();
  expect(nudge(ids, "x", 1)).toBeNull();
});

test("only plain Alt with an up or down arrow counts", () => {
  const key = (key: string, mods: Partial<Record<string, boolean>> = {}) =>
    moveKey({ key, altKey: true, ctrlKey: false, metaKey: false, ...mods });
  expect(key("ArrowUp")).toBe(-1);
  expect(key("ArrowDown")).toBe(1);
  expect(key("ArrowLeft")).toBeNull();
  expect(key("ArrowUp", { altKey: false })).toBeNull();
  expect(key("ArrowUp", { ctrlKey: true })).toBeNull();
});
