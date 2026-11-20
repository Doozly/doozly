import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { decodeExport, encodeExport } from "../../sync/files.ts";
import { renderApp } from "../../test/render.tsx";

afterEach(() => vi.restoreAllMocks());

const openSettings = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  return screen.findByRole("region", { name: "Your data" });
};

test("export downloads everything as a dated JSON file", async () => {
  let saved: Blob | undefined;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    saved = blob;
    return "blob:x";
  });
  URL.revokeObjectURL = vi.fn();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});

  await renderApp("/lists/inbox", (actions) =>
    actions.addTask(INBOX_ID, "Milk"),
  );
  await openSettings();
  await userEvent.click(screen.getByRole("button", { name: "Export" }));

  expect(click).toHaveBeenCalledOnce();
  const link = click.mock.contexts[0] as HTMLAnchorElement;
  expect(link.download).toMatch(/^doozly-\d{4}-\d\d-\d\d\.json$/);
  const data = new Uint8Array(await (saved as Blob).arrayBuffer());
  expect(decodeExport("x", data).tasks.map((t) => t.title)).toEqual(["Milk"]);
});

test("import merges a file in and says what came", async () => {
  const other = await renderApp("/lists/inbox", (actions) => {
    const list = actions.addList("Groceries");
    actions.addTask(list.id, "Bread");
  });
  const s = other.state();
  const file = new File(
    [
      encodeExport({
        lists: Object.values(s.lists),
        groups: [],
        tasks: Object.values(s.tasks),
        steps: [],
        settings: [],
      }),
    ],
    "backup.json",
    { type: "application/json" },
  );
  other.view.unmount();

  // Another device, with a database of its own
  globalThis.indexedDB = new IDBFactory();
  const { state } = await renderApp();
  await openSettings();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  await userEvent.upload(input, file);

  expect(
    await screen.findByText(/^Imported \d lists? and 1 task\.$/),
  ).toHaveAttribute("role", "status");
  expect(Object.values(state().tasks).map((t) => t.title)).toEqual(["Bread"]);

  await userEvent.upload(
    input,
    new File(["{}"], "nope.json", { type: "application/json" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That file isn't a Doozly export.",
  );
});
