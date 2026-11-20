export type ShortcutAction =
  | "newTask"
  | "newList"
  | "search"
  | "complete"
  | "myDay"
  | "star"
  | "delete"
  | "sync"
  | "sidebar"
  | "help";

export interface Shortcut {
  action: ShortcutAction;
  /** As shown in the help, the first one is also what `aria-keyshortcuts` gets */
  keys: string[];
  label: string;
}

// To Do's own letters (Ctrl+N, Ctrl+L, Ctrl+T, Ctrl+D, Ctrl+F, Ctrl+R, Ctrl+1), but without
// Ctrl: in a browser those all belong to the browser already
export const SHORTCUTS: Shortcut[] = [
  { action: "newTask", keys: ["N"], label: "Add a task" },
  { action: "newList", keys: ["L"], label: "New list" },
  { action: "search", keys: ["F", "/"], label: "Search" },
  { action: "complete", keys: ["D"], label: "Complete the selected task" },
  { action: "myDay", keys: ["T"], label: "Add the selected task to My Day" },
  { action: "star", keys: ["S"], label: "Mark the selected task as important" },
  { action: "delete", keys: ["Delete"], label: "Delete the selected task" },
  { action: "sync", keys: ["R"], label: "Sync now" },
  { action: "sidebar", keys: ["1"], label: "Show or hide the sidebar" },
  { action: "help", keys: ["?"], label: "Show keyboard shortcuts" },
];

/** What works without any setting, shown in the help under the shortcuts */
export const NAVIGATION: { keys: string[]; label: string }[] = [
  { keys: ["↑", "↓"], label: "Previous or next task, or list in the sidebar" },
  { keys: ["Home", "End"], label: "First or last task or list" },
  { keys: ["Enter"], label: "Open the task or list" },
  { keys: ["Esc"], label: "Close the task details" },
  { keys: ["Alt+↑", "Alt+↓"], label: "Move the task or list up or down" },
  { keys: ["Shift+F10"], label: "Open the menu for the task or list" },
];

const byKey = new Map<string, ShortcutAction>();
for (const s of SHORTCUTS) {
  for (const k of s.keys) byKey.set(k.toLowerCase(), s.action);
}
byKey.set("backspace", "delete");

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** The action for a key press, or null. Doesn't look at where the focus is, see `typingIn`. */
export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  let key = e.key.toLowerCase();
  // Another layout (Cyrillic, Greek…) still gets the letters where they are on the keyboard
  if (/^\p{L}$/u.test(key) && !/^[a-z]$/.test(key)) {
    key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key;
  }
  // Shift+N is someone typing a capital somewhere, not "add a task"
  if (e.shiftKey && /^[a-z0-9]$/.test(key)) return null;
  return byKey.get(key) ?? null;
}

// To Do's real keys. In the desktop app no browser owns Ctrl, so there they work like in To Do.
const TODO_KEYS: Partial<Record<ShortcutAction, string>> = {
  newTask: "N",
  newList: "L",
  myDay: "T",
  complete: "D",
  search: "F",
  sync: "R",
  sidebar: "1",
};
const byToDoKey = new Map(
  Object.entries(TODO_KEYS).map(([action, k]) => [
    k.toLowerCase(),
    action as ShortcutAction,
  ]),
);

/** Ctrl (⌘ on a Mac) with To Do's key, for the desktop app. Works while typing too, as in To Do. */
export function toDoShortcutFor(
  e: KeyLike,
  mac: boolean,
): ShortcutAction | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey || e.isComposing) return null;
  // By where the key sits, so other layouts get them too
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3).toLowerCase()
    : /^Digit\d$/.test(e.code)
      ? e.code.slice(5)
      : e.key.toLowerCase();
  return byToDoKey.get(key) ?? null;
}

/** The help's rows, with To Do's Ctrl keys first in the desktop app */
export function helpRows(desktop: boolean, mac: boolean): Shortcut[] {
  if (!desktop) return SHORTCUTS;
  return SHORTCUTS.map((s) => {
    const k = TODO_KEYS[s.action];
    return k ? { ...s, keys: [mac ? `⌘${k}` : `Ctrl+${k}`, ...s.keys] } : s;
  });
}

/** Whether keys pressed here are text, so a letter must stay a letter */
export function typingIn(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLInputElement) {
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "range",
    ].includes(el.type);
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // React Aria's date fields are spinbuttons made of plain elements
  return ["textbox", "combobox", "spinbutton", "searchbox"].includes(
    el.getAttribute("role") ?? "",
  );
}

/** Whether the focus is in a menu, dialog or popover, which have their own keys */
export function inOverlay(el: Element | null): boolean {
  return (
    el?.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ) != null
  );
}
