import { expect, test } from "vitest";
import {
  createGroup,
  createList,
  createStep,
  createTask,
  type SettingRecord,
} from "../data/model.ts";
import {
  BadFileError,
  decodeExport,
  decodeList,
  decodeManifest,
  decodeSettings,
  encode,
  encodeExport,
  listIdOf,
  listPath,
  MANIFEST_PATH,
  type Manifest,
  NewerSchemaError,
  SCHEMA_VERSION,
  SETTINGS_PATH,
  type SettingsFile,
} from "./files.ts";
import { listFileFor } from "./merge.ts";

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

test("list paths go both ways, odd ids included", () => {
  expect(listPath("inbox")).toBe("lists/inbox.json");
  expect(listIdOf(listPath("a/b c"))).toBe("a/b c");
  expect(listIdOf("manifest.json")).toBeNull();
  expect(listIdOf("lists/x/y.json")).toBeNull();
});

test("all three files survive encode and decode", () => {
  const list = createList({ title: "Shopping", position: "a0" });
  const task = createTask({ listId: list.id, title: "Milk", position: "a0" });
  const step = createStep({ taskId: task.id, title: "Oat", position: "a0" });
  const file = listFileFor(list, { tasks: [task], steps: [step] });
  expect(decodeList(listPath(list.id), encode(file))).toEqual(file);

  const manifest: Manifest = {
    schema: SCHEMA_VERSION,
    groups: [createGroup({ title: "Home", position: "a0" })],
    listIds: [list.id],
  };
  expect(decodeManifest(MANIFEST_PATH, encode(manifest))).toEqual(manifest);

  const settings: SettingsFile = {
    schema: SCHEMA_VERSION,
    settings: [
      { key: "theme", value: "dark", updatedAt: "0000000000001:0000:n1" },
    ] as SettingRecord[],
  };
  expect(decodeSettings(SETTINGS_PATH, encode(settings))).toEqual(settings);
});

test("a file from a newer app is refused, so we never overwrite what we don't understand", () => {
  expect(() =>
    decodeManifest(MANIFEST_PATH, bytes({ schema: SCHEMA_VERSION + 1 })),
  ).toThrow(NewerSchemaError);
});

test("broken files are refused with the path in the message", () => {
  const list = createList({ id: "l1", title: "L", position: "a0" });
  const bad = (
    path: string,
    v: unknown,
    decode: (path: string, data: Uint8Array) => unknown = decodeList,
  ) =>
    expect(() =>
      decode(
        path,
        typeof v === "string" ? new TextEncoder().encode(v) : bytes(v),
      ),
    ).toThrow(BadFileError);

  bad("lists/l1.json", "{not json");
  bad("lists/l1.json", [1, 2]);
  bad("lists/l1.json", { list, tasks: [], steps: [] });
  bad("lists/l1.json", { schema: 1, list, tasks: "nope", steps: [] });
  bad("lists/l1.json", { schema: 1, list, tasks: [{ id: 1 }], steps: [] });
  // The name and the content have to agree
  bad("lists/other.json", { schema: 1, list, tasks: [], steps: [] });
  bad(MANIFEST_PATH, { schema: 1, groups: [], listIds: [3] }, decodeManifest);
  bad(SETTINGS_PATH, { schema: 1, settings: [{ value: 1 }] }, decodeSettings);
});

test("an export holds every record and comes back the same", () => {
  const list = createList({ title: "Shopping", position: "a0" });
  const task = createTask({ listId: list.id, title: "Milk", position: "a0" });
  const step = createStep({ taskId: task.id, title: "Oat", position: "a0" });
  const group = createGroup({ title: "Home", position: "a0" });
  const settings: SettingRecord[] = [
    { key: "theme", value: "dark", updatedAt: "1" } as SettingRecord,
  ];
  const snapshot = {
    lists: [list],
    groups: [group],
    tasks: [{ ...task, deletedAt: 5 }],
    steps: [step],
    settings,
  };
  const data = encodeExport(snapshot, new Date(Date.UTC(2026, 10, 20)));
  const text = new TextDecoder().decode(data);
  expect(text).toContain('"exportedAt": "2026-11-20T00:00:00.000Z"');
  expect(decodeExport("backup.json", data)).toEqual(snapshot);
});

test("an import refuses what isn't a Doozly export", () => {
  expect(() => decodeExport("x.json", bytes({ schema: 1 }))).toThrow(
    "not a Doozly export",
  );
  expect(() =>
    decodeExport("x.json", new TextEncoder().encode("nope")),
  ).toThrow(BadFileError);
  expect(() =>
    decodeExport("x.json", bytes({ doozly: "export", schema: 99 })),
  ).toThrow(NewerSchemaError);
  expect(() =>
    decodeExport(
      "x.json",
      bytes({
        doozly: "export",
        schema: 1,
        lists: [{ id: 1 }],
        groups: [],
        tasks: [],
        steps: [],
        settings: [],
      }),
    ),
  ).toThrow(BadFileError);
});

test("a list file stays small: a thousand real-sized tasks under 600 kB", () => {
  const list = createList({ title: "Big one", position: "a0" });
  const tasks = Array.from({ length: 1000 }, (_, i) =>
    createTask({
      listId: list.id,
      title: `Ring the dentist about the appointment ${i}`,
      position: `a${i}`,
      note:
        i % 2 ? "A note about it with some more words, like a real one." : "",
      dueDate: i % 4 ? null : "2026-11-20",
    }),
  );
  const steps = tasks
    .filter((_, i) => i % 5 === 0)
    .flatMap((t) =>
      [0, 1, 2].map((s) =>
        createStep({ taskId: t.id, title: `Step ${s}`, position: `a${s}` }),
      ),
    );
  const size = encode({ schema: SCHEMA_VERSION, list, tasks, steps }).length;
  expect(size).toBeLessThan(600_000);
});
