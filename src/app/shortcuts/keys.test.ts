import { expect, test } from "vitest";
import {
  helpRows,
  inOverlay,
  shortcutFor,
  toDoShortcutFor,
  typingIn,
} from "./keys.ts";

const press = (key: string, more: Partial<KeyboardEventInit> = {}) =>
  shortcutFor({
    key,
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...more,
  });

test("To Do's letters without Ctrl", () => {
  expect(press("n")).toBe("newTask");
  expect(press("l")).toBe("newList");
  expect(press("t")).toBe("myDay");
  expect(press("d")).toBe("complete");
  expect(press("f")).toBe("search");
  expect(press("/")).toBe("search");
  expect(press("r")).toBe("sync");
  expect(press("1")).toBe("sidebar");
  expect(press("s")).toBe("star");
  expect(press("Delete")).toBe("delete");
  expect(press("Backspace")).toBe("delete");
  expect(press("?", { shiftKey: true })).toBe("help");
  expect(press("x")).toBeNull();
});

test("anything with a modifier stays the browser's or the screen reader's", () => {
  for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
    expect(press("n", { [mod]: true })).toBeNull();
  }
  expect(press("N", { shiftKey: true })).toBeNull();
  expect(press("!", { shiftKey: true, code: "Digit1" })).toBeNull();
  expect(press("n", { isComposing: true })).toBeNull();
});

test("other layouts use where the key sits", () => {
  // Russian layout: the N key types "т"
  expect(press("т", { code: "KeyN" })).toBe("newTask");
  expect(press("в", { code: "KeyD" })).toBe("complete");
});

test("text fields keep their letters, buttons and checkboxes don't", () => {
  document.body.innerHTML = `
    <input id="text"><input id="check" type="checkbox"><textarea id="area"></textarea>
    <div id="edit" contenteditable="true"></div><div id="spin" role="spinbutton"></div>
    <button id="button">x</button><a id="link" href="/">x</a>`;
  const el = (id: string) => document.getElementById(id);
  for (const id of ["text", "area", "spin"])
    expect(typingIn(el(id))).toBe(true);
  for (const id of ["check", "button", "link"]) {
    expect(typingIn(el(id))).toBe(false);
  }
  expect(typingIn(null)).toBe(false);
});

test("menus and dialogs have their own keys", () => {
  document.body.innerHTML = `
    <div role="dialog"><button id="in">x</button></div><button id="out">x</button>`;
  expect(inOverlay(document.getElementById("in"))).toBe(true);
  expect(inOverlay(document.getElementById("out"))).toBe(false);
});

const combo = (
  code: string,
  mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>,
) => ({
  key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code.slice(5),
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("the desktop app takes To Do's own Ctrl keys, ⌘ on a Mac", () => {
  expect(toDoShortcutFor(combo("KeyN", { ctrlKey: true }), false)).toBe(
    "newTask",
  );
  expect(toDoShortcutFor(combo("KeyT", { ctrlKey: true }), false)).toBe(
    "myDay",
  );
  expect(toDoShortcutFor(combo("Digit1", { ctrlKey: true }), false)).toBe(
    "sidebar",
  );
  expect(toDoShortcutFor(combo("KeyN", { metaKey: true }), true)).toBe(
    "newTask",
  );
  // The other platform's modifier, extra modifiers or keys To Do doesn't have
  expect(toDoShortcutFor(combo("KeyN", { metaKey: true }), false)).toBeNull();
  expect(toDoShortcutFor(combo("KeyN", { ctrlKey: true }), true)).toBeNull();
  expect(
    toDoShortcutFor(combo("KeyN", { ctrlKey: true, shiftKey: true }), false),
  ).toBeNull();
  expect(toDoShortcutFor(combo("KeyS", { ctrlKey: true }), false)).toBeNull();
  expect(toDoShortcutFor(combo("KeyN", {}), false)).toBeNull();
});

test("the desktop help shows the Ctrl keys first", () => {
  const add = (rows: ReturnType<typeof helpRows>) =>
    rows.find((r) => r.action === "newTask")?.keys;
  expect(add(helpRows(false, false))).toEqual(["N"]);
  expect(add(helpRows(true, false))).toEqual(["Ctrl+N", "N"]);
  expect(add(helpRows(true, true))).toEqual(["⌘N", "N"]);
});
