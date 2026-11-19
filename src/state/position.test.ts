import { expect, test } from "vitest";
import { byPosition, positionBetween } from "./position.ts";

test("lands between, before the start and after the end", () => {
  const mid = positionBetween("a0", "a1");
  expect(mid > "a0" && mid < "a1").toBe(true);
  expect(positionBetween(null, "a0") < "a0").toBe(true);
  expect(positionBetween("a0", null) > "a0").toBe(true);
  expect(positionBetween(null, null)).toBeTypeOf("string");
});

test("doesn't throw when two neighbours share a position", () => {
  expect(positionBetween("a1", "a1") > "a1").toBe(true);
  expect(positionBetween("a2", "a1") > "a2").toBe(true);
});

test("sorts by code units, then by id on a tie", () => {
  const rows = [
    { id: "b", position: "a1" },
    { id: "x", position: "Zz" },
    { id: "a", position: "a1" },
  ];
  expect(rows.sort(byPosition).map((r) => r.id)).toEqual(["x", "a", "b"]);
});
