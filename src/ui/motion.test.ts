import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { animateRows } from "./motion.ts";

interface Call {
  el: Element;
  keyframes: Keyframe[];
  animation: { onfinish: (() => void) | null; oncancel: (() => void) | null };
}

let calls: Call[] = [];
/** Where each element sits, jsdom lays nothing out */
let tops = new Map<string, number>();
let covered = new Set<string>();

const keyOf = (el: Element) =>
  (el as HTMLElement).dataset.taskId ?? (el as HTMLElement).dataset.exit ?? "";

beforeEach(() => {
  calls = [];
  tops = new Map();
  covered = new Set();
  Element.prototype.animate = vi.fn(function (this: Element, keyframes) {
    const animation = { onfinish: null, oncancel: null };
    calls.push({ el: this, keyframes: keyframes as Keyframe[], animation });
    return animation as unknown as Animation;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top = tops.get(keyOf(this)) ?? 99_999;
      return {
        top,
        bottom: top + 40,
        left: 0,
        width: 300,
        height: 40,
      } as DOMRect;
    },
  );
  document.elementFromPoint = (_x, y) => {
    for (const el of document.querySelectorAll("[data-task-id], [data-exit]")) {
      if (tops.get(keyOf(el)) === y - 20) {
        if (!covered.has(keyOf(el))) return el;
        return document.querySelector("[data-exit]") ?? el;
      }
    }
    return null;
  };
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const html = (ids: string[], extra = "") =>
  `<ul data-accent="red">${ids.map((id) => `<li data-task-id="${id}">${id}</li>`).join("")}</ul>${extra}`;

const animated = (id: string) =>
  calls.find((c) => (c.el as HTMLElement).dataset.taskId === id);

test("without the Web Animations API the change just happens", () => {
  Reflect.deleteProperty(Element.prototype, "animate");
  const update = vi.fn();
  animateRows(update);
  expect(update).toHaveBeenCalledOnce();
});

test("moved rows slide from where they were, new ones fade in", () => {
  document.body.innerHTML = html(["a", "b", "far"]);
  tops = new Map([
    ["a", 0],
    ["b", 40],
  ]);
  animateRows(() => {
    // "c" is added on top, "a" and "b" move down, "far" stays off screen
    document.body.innerHTML = html(["c", "a", "b", "far"]);
    tops = new Map([
      ["c", 0],
      ["a", 40],
      ["b", 80],
    ]);
  });
  expect(animated("a")?.keyframes[0]?.transform).toBe("translate(0px, -40px)");
  expect(animated("b")?.keyframes[0]?.transform).toBe("translate(0px, -40px)");
  expect(animated("c")?.keyframes[0]?.opacity).toBe(0);
  expect(animated("far")).toBeUndefined();
  expect(document.querySelector("[data-ghost]")).toBeNull();
});

test("a row that goes leaves a copy that fades where it was, then goes too", () => {
  document.body.innerHTML = html(["a", "b"]);
  tops = new Map([
    ["a", 0],
    ["b", 40],
  ]);
  animateRows(() => {
    document.body.innerHTML = html(["b"]);
    tops = new Map([["b", 0]]);
  });
  const ghost = document.querySelector<HTMLElement>("[data-ghost]");
  expect(ghost?.textContent).toBe("a");
  expect(ghost?.style.top).toBe("0px");
  expect(ghost?.dataset.accent).toBe("red");
  expect(ghost?.firstElementChild).toHaveAttribute("aria-hidden", "true");
  const fade = calls.find((c) => c.el === ghost);
  fade?.animation.onfinish?.();
  expect(document.querySelector("[data-ghost]")).toBeNull();
});

test("the details pane slides out, a row hidden under it doesn't show", () => {
  document.body.innerHTML = html(
    ["a"],
    `<aside data-exit="slide"><textarea></textarea></aside>`,
  );
  (document.querySelector("textarea") as HTMLTextAreaElement).value = "typed";
  tops = new Map([
    ["a", 0],
    ["slide", 0],
  ]);
  covered.add("a");
  animateRows(() => {
    document.body.innerHTML = html([]);
  });
  const ghosts = document.querySelectorAll<HTMLElement>("[data-ghost]");
  expect(ghosts).toHaveLength(1);
  expect(ghosts[0]?.querySelector("textarea")?.value).toBe("typed");
  const slide = calls.find((c) => c.el === ghosts[0]);
  expect(slide?.keyframes[1]?.transform).toBe("translateX(32px)");
});

test("reduced motion changes at once", () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q) => ({ matches: q.includes("reduced-motion") }) as MediaQueryList,
  );
  document.body.innerHTML = html(["a"]);
  tops = new Map([["a", 0]]);
  const update = vi.fn(() => {
    document.body.innerHTML = html([]);
  });
  animateRows(update);
  expect(update).toHaveBeenCalledOnce();
  expect(calls).toEqual([]);
  expect(document.querySelector("[data-ghost]")).toBeNull();
});

test("a dialog's scrim over the row doesn't stop its copy, it closes with the change", () => {
  document.body.innerHTML = `${html(["a"])}<div id="scrim"></div>`;
  tops = new Map([["a", 0]]);
  document.elementFromPoint = () => document.getElementById("scrim");
  animateRows(() => {
    document.body.innerHTML = html([]);
  });
  expect(document.querySelectorAll("[data-ghost]")).toHaveLength(1);
});

test("headings marked data-flip travel with the rows, they never leave a copy", () => {
  document.body.innerHTML = `${html(["a"])}<h2 data-flip="done">Completed</h2>`;
  tops = new Map([
    ["a", 0],
    ["flip:done", 40],
  ]);
  const at = (el: Element) => {
    const h = el as HTMLElement;
    return tops.get(h.dataset.taskId ?? `flip:${h.dataset.flip}`) ?? 99_999;
  };
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(
    function (this: Element) {
      const top = at(this);
      return {
        top,
        bottom: top + 40,
        left: 0,
        width: 300,
        height: 40,
      } as DOMRect;
    },
  );
  animateRows(() => {
    document.body.innerHTML = html([]);
    document.body.innerHTML += `<h2 data-flip="done">Completed</h2>`;
    tops = new Map([["flip:done", 0]]);
  });
  const heading = calls.find((c) => (c.el as HTMLElement).dataset.flip);
  expect(heading?.keyframes[0]?.transform).toBe("translate(0px, 40px)");
  expect(
    [...document.querySelectorAll("[data-ghost]")].map((g) => g.textContent),
  ).toEqual(["a"]);
});
