import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without vitest globals, Testing Library can't clean up by itself
afterEach(cleanup);

// jsdom has no matchMedia. Width-only queries answer against this, set it with setViewportWidth.
let viewportWidth = 1280;

export function setViewportWidth(width: number) {
  viewportWidth = width;
}

afterEach(() => {
  viewportWidth = 1280;
});

function matches(query: string): boolean {
  const max = /max-width:\s*(\d+)px/.exec(query);
  const min = /min-width:\s*(\d+)px/.exec(query);
  if (max && viewportWidth > Number(max[1])) return false;
  if (min && viewportWidth < Number(min[1])) return false;
  return Boolean(max || min);
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return matches(query);
      },
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
