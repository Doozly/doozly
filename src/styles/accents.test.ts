import { expect, test } from "vitest";
import { accents, defaultAccent } from "./accents.ts";
import { contrast } from "./contrast.ts";
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

/** The light and dark value of a light-dark() token in tokens.css */
function pair(css: string): [string, string] {
  const m = css.match(/light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/i);
  if (!m?.[1] || !m[2]) throw new Error(`no light-dark pair in ${css}`);
  return [m[1], m[2]];
}

const token = (name: string) =>
  pair(tokens.match(new RegExp(`${name}: ([^;]+);`))?.[1] ?? "");

test.each(accents)(
  "%s passes AA as text and behind text, in both themes",
  (name) => {
    const rule = tokens.match(
      new RegExp(`\\[data-accent="${name}"\\] \\{\\s*--accent: ([^;]+);`),
    );
    const [light, dark] = pair(rule?.[1] ?? "");
    const [surfaceL, surfaceD] = token("--color-surface");
    const [bgL, bgD] = token("--color-bg");
    const [onL, onD] = token("--accent-on");
    for (const [fg, bg] of [
      [light, surfaceL],
      [light, bgL],
      [light, onL],
      [dark, surfaceD],
      [dark, bgD],
      [dark, onD],
    ] as const) {
      expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  },
);
