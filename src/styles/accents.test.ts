import { expect, test } from "vitest";
import { accents, defaultAccent } from "./accents.ts";
import tokens from "./tokens.css?raw";

test("every accent has a CSS rule, and no rule is left over", () => {
  const inCss = [...tokens.matchAll(/\[data-accent="([a-z]+)"\]/g)].map(
    (m) => m[1],
  );
  expect(new Set(inCss)).toEqual(new Set(accents));
});

test("the default accent is also the :root one", () => {
  expect(tokens).toContain(`:root,\n[data-accent="${defaultAccent}"]`);
});
