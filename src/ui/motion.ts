import { flushSync } from "react-dom";

// FLIP on the real rows, not view transitions: those freeze the page while they run,
// so a second quick tick would get lost
const ROW = "[data-task-id]";
/** Rows, and headings like Completed that should travel with them, by a stable key */
const MOVING = "[data-task-id], [data-flip]";
const keyOf = (el: HTMLElement) =>
  el.dataset.taskId ?? `flip:${el.dataset.flip ?? ""}`;
/** Elements that animate out when a change takes them away, like the details pane */
const EXIT = "[data-exit]";

function reducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function ms(name: string): number {
  const value = token(name);
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return value.endsWith("ms") ? n : n * 1000;
}

interface Before {
  rect: DOMRect;
  /** The list's accent, a copy outside the list wouldn't have it */
  accent: string | null;
}

/**
 * Makes a change to the task rows so they slide to their new places, new ones fade in, and
 * rows (or the details pane) that go away fade out. The change itself happens at once, also
 * the page stays clickable all the time. Only rows about on screen are measured, a few
 * thousand would make every tick slow.
 */
export function animateRows(update: () => void): void {
  if (typeof document === "undefined") {
    update();
    return;
  }
  const restoreFocus = keepFocus();
  if (typeof Element.prototype.animate !== "function" || reducedMotion()) {
    flushSync(update);
    restoreFocus();
    return;
  }
  const limit = window.innerHeight * 2;
  const onScreen = (r: DOMRect) =>
    r.bottom >= 0 && r.top <= limit && r.height > 0;
  const moving = () => document.querySelectorAll<HTMLElement>(MOVING);

  const existed = new Set<string>();
  const was = new Map<string, DOMRect>();
  const leaving = new Map<HTMLElement, Before>();
  const rowsLeaving = new Map<string, [HTMLElement, Before]>();
  for (const el of moving()) {
    const id = keyOf(el);
    existed.add(id);
    const rect = el.getBoundingClientRect();
    if (!onScreen(rect)) continue;
    was.set(id, rect);
    if (!el.matches(ROW)) continue;
    // A row under the details pane (tablets) mustn't show up on top of it as it goes
    if (seen(el, rect))
      rowsLeaving.set(id, [el, { rect, accent: accentOf(el) }]);
  }
  for (const el of document.querySelectorAll<HTMLElement>(EXIT)) {
    leaving.set(el, { rect: el.getBoundingClientRect(), accent: accentOf(el) });
  }

  flushSync(update);
  restoreFocus();

  const move = {
    duration: ms("--duration-normal"),
    easing: token("--ease-standard"),
  };
  const remaining = new Set<string>();
  for (const el of moving()) {
    const id = keyOf(el);
    remaining.add(id);
    const old = was.get(id);
    const now = el.getBoundingClientRect();
    if (old) {
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (dx || dy) {
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          move,
        );
      }
    } else if (!existed.has(id) && onScreen(now)) {
      el.animate(
        [
          { opacity: 0, transform: "translateY(-8px)" },
          { opacity: 1, transform: "none" },
        ],
        { ...move, easing: token("--ease-enter") },
      );
    }
  }
  // Gone means no row for it any more: one moved to Completed is a new element, not gone
  for (const [id, [el, before]] of rowsLeaving) {
    if (!remaining.has(id)) ghost(el, before);
  }
  for (const [el, before] of leaving) {
    if (!el.isConnected) ghost(el, before);
  }
}

/** Whether the details pane isn't over it. A dialog's scrim doesn't count, it goes with the change. */
function seen(el: Element, rect: DOMRect): boolean {
  if (typeof document.elementFromPoint !== "function") return true;
  const hit = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  return hit === null || el.contains(hit) || hit.closest(EXIT) === null;
}

/**
 * A row that moved (to Completed, say) is a new element, so the focus in it would fall to
 * the page. It goes to the same control in the row's new place, or to the next row when
 * the row has left the list.
 */
function keepFocus(): () => void {
  const active = document.activeElement;
  const row = active?.closest<HTMLElement>(ROW);
  if (!(active instanceof HTMLElement) || !row) return () => {};
  const control = active.matches('input[type="checkbox"]')
    ? 'input[type="checkbox"]'
    : active.matches("[data-nav]")
      ? "[data-nav]"
      : "button";
  const order = [...document.querySelectorAll<HTMLElement>(ROW)];
  const at = order.indexOf(row);
  const ids = [row, order[at + 1], order[at - 1]].map((r) => r?.dataset.taskId);
  return () => {
    // Still there, or something else took the focus on purpose
    if (active.isConnected || document.activeElement !== document.body) return;
    for (const id of ids) {
      if (!id) continue;
      const found = document
        .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
        ?.querySelector<HTMLElement>(control);
      if (found) {
        found.focus();
        return;
      }
    }
  };
}

function accentOf(el: Element): string | null {
  return el.closest("[data-accent]")?.getAttribute("data-accent") ?? null;
}

/** A copy of something that's gone, fading out where it was. Clicks go through it. */
function ghost(el: HTMLElement, { rect, accent }: Before) {
  const copy = el.cloneNode(true) as HTMLElement;
  // Typed values live in properties, not in what cloneNode copies
  const fields = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  copy
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    .forEach((f, i) => {
      f.value = fields[i]?.value ?? f.value;
    });
  copy.removeAttribute("id");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  const box = document.createElement("div");
  box.dataset.ghost = "";
  if (accent) box.dataset.accent = accent;
  Object.assign(box.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: "none",
    zIndex: "5",
  });
  Object.assign(copy.style, {
    position: "static",
    width: "100%",
    height: "100%",
    margin: "0",
  });
  box.append(copy);
  document.body.append(box);

  const slide = el.dataset.exit === "slide";
  const animation = box.animate(
    slide
      ? [{ opacity: 1 }, { opacity: 0, transform: "translateX(32px)" }]
      : [{ opacity: 1 }, { opacity: 0, transform: "scale(0.98)" }],
    {
      duration: ms(slide ? "--duration-fast" : "--duration-normal"),
      easing: token("--ease-exit"),
      fill: "forwards",
    },
  );
  const remove = () => box.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
}
