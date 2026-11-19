import { expect, test } from "vitest";
import { uniqueTitle } from "./naming.ts";

test("uses the plain name while it's free", () => {
  expect(uniqueTitle("Untitled list", ["Groceries"])).toBe("Untitled list");
});

test("numbers it from 1, filling the first gap", () => {
  expect(uniqueTitle("Untitled list", ["Untitled list"])).toBe(
    "Untitled list (1)",
  );
  expect(
    uniqueTitle("Untitled list", [
      "Untitled list",
      "Untitled list (1)",
      "Untitled list (3)",
    ]),
  ).toBe("Untitled list (2)");
});
