import { expect, test } from "vitest";
import css from "./backgrounds.css?raw";
import { backgroundLabels, backgrounds } from "./backgrounds.ts";
import { contrast } from "./contrast.ts";

const rules = new Map(
  [...css.matchAll(/\[data-background="([a-z]+)"\] \{([^}]+)\}/g)].map((m) => [
    m[1],
    m[2] ?? "",
  ]),
);

test("every background has a CSS rule and a label, and nothing is left over", () => {
  expect(new Set(rules.keys())).toEqual(new Set(backgrounds));
  expect(Object.keys(backgroundLabels).sort()).toEqual([...backgrounds].sort());
});

test.each(backgrounds)("white text passes AA on every colour of %s", (name) => {
  const colours = rules.get(name)?.match(/#[0-9a-f]{6}\b/gi) ?? [];
  expect(colours.length).toBeGreaterThan(0);
  for (const c of colours) {
    expect(contrast("#ffffff", c), c).toBeGreaterThanOrEqual(4.5);
  }
});
