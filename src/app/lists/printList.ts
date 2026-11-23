import type { PrintedList, PrintedTask } from "./listText.ts";
import "./printList.css";

const ROOT = "print-root";

function el(tag: string, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function item(t: PrintedTask) {
  const li = el("li", undefined, t.done ? "done" : undefined);
  li.append(el("span", t.done ? "☑" : "☐", "box"), el("span", t.title));
  if (t.important) li.append(el("span", "★", "star"));
  if (t.due) li.append(el("span", t.due, "due"));
  if (t.steps.length) {
    const steps = el("ul");
    for (const s of t.steps) {
      const step = el("li", undefined, s.done ? "done" : undefined);
      step.append(el("span", s.done ? "☑" : "☐", "box"), el("span", s.title));
      steps.append(step);
    }
    li.append(steps);
  }
  return li;
}

/** Prints the list on its own, not the app around it. Built with textContent, so titles stay text. */
export function printList({ title, open, done }: PrintedList) {
  document.getElementById(ROOT)?.remove();
  const root = el("div");
  root.id = ROOT;
  root.append(el("h1", title));
  const list = el("ul");
  list.append(...open.map(item));
  root.append(open.length ? list : el("p", "Nothing left to do."));
  if (done.length) {
    const finished = el("ul");
    finished.append(...done.map(item));
    root.append(el("h2", "Completed"), finished);
  }
  document.body.append(root);
  window.addEventListener("afterprint", () => root.remove(), { once: true });
  window.print();
}
