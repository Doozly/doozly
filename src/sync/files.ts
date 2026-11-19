import type { Snapshot } from "../data/db.ts";
import type {
  List,
  ListGroup,
  SettingRecord,
  Step,
  Task,
} from "../data/model.ts";

/** Bump with a migration in `decode` when a file's shape changes */
export const SCHEMA_VERSION = 1;

export const MANIFEST_PATH = "manifest.json";
export const SETTINGS_PATH = "settings.json";
export const listPath = (listId: string) =>
  `lists/${encodeURIComponent(listId)}.json`;

/** The list id back from a path like "lists/abc.json", null for any other file */
export function listIdOf(path: string): string | null {
  const m = path.match(/^lists\/([^/]+)\.json$/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** Groups, and which list files exist, so a device can find them without listing the folder */
export interface Manifest {
  schema: typeof SCHEMA_VERSION;
  groups: ListGroup[];
  listIds: string[];
}

export interface SettingsFile {
  schema: typeof SCHEMA_VERSION;
  settings: SettingRecord[];
}

/** One list: its record, its tasks and their steps, tombstones included */
export interface ListFile {
  schema: typeof SCHEMA_VERSION;
  list: List;
  tasks: Task[];
  steps: Step[];
}

/** The file was written by a newer Doozly. We mustn't touch it, the app needs updating. */
export class NewerSchemaError extends Error {
  readonly path: string;
  readonly schema: number;
  constructor(path: string, schema: number) {
    super(
      `${path} has schema ${schema}, this app knows up to ${SCHEMA_VERSION}`,
    );
    this.name = "NewerSchemaError";
    this.path = path;
    this.schema = schema;
  }
}

/** Not JSON, or not the shape we expect */
export class BadFileError extends Error {
  readonly path: string;
  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "BadFileError";
    this.path = path;
  }
}

export function encode(file: Manifest | SettingsFile | ListFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parse(path: string, data: Uint8Array): Obj {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new BadFileError(path, "not JSON");
  }
  if (!isObj(json)) throw new BadFileError(path, "not an object");
  const { schema } = json;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) {
    throw new BadFileError(path, "no schema version");
  }
  if (schema > SCHEMA_VERSION) throw new NewerSchemaError(path, schema);
  return json;
}

// Just enough checking that merging can't trip over a broken record
function entity(path: string, v: unknown): Obj {
  if (
    !isObj(v) ||
    typeof v.id !== "string" ||
    typeof v.updatedAt !== "string" ||
    !(v.deletedAt === null || typeof v.deletedAt === "number")
  ) {
    throw new BadFileError(path, "a record without id, stamp or tombstone");
  }
  return v;
}

function entities<T>(path: string, v: unknown, field: string): T[] {
  if (!Array.isArray(v)) throw new BadFileError(path, `${field} isn't a list`);
  return v.map((r) => entity(path, r) as T);
}

export function decodeManifest(path: string, data: Uint8Array): Manifest {
  const f = parse(path, data);
  if (
    !Array.isArray(f.listIds) ||
    !f.listIds.every((id) => typeof id === "string")
  ) {
    throw new BadFileError(path, "listIds isn't a list of ids");
  }
  return {
    schema: SCHEMA_VERSION,
    groups: entities<ListGroup>(path, f.groups, "groups"),
    listIds: f.listIds as string[],
  };
}

function settingRecords(path: string, v: unknown): SettingRecord[] {
  if (!Array.isArray(v)) throw new BadFileError(path, "settings isn't a list");
  return v.map((r) => {
    if (
      !isObj(r) ||
      typeof r.key !== "string" ||
      typeof r.updatedAt !== "string"
    ) {
      throw new BadFileError(path, "a setting without key or stamp");
    }
    return r as SettingRecord;
  });
}

export function decodeSettings(path: string, data: Uint8Array): SettingsFile {
  const f = parse(path, data);
  return { schema: SCHEMA_VERSION, settings: settingRecords(path, f.settings) };
}

export function decodeList(path: string, data: Uint8Array): ListFile {
  const f = parse(path, data);
  const list = entity(path, f.list) as unknown as List;
  if (listIdOf(path) !== list.id) {
    throw new BadFileError(path, "the list inside isn't the one the name says");
  }
  return {
    schema: SCHEMA_VERSION,
    list,
    tasks: entities<Task>(path, f.tasks, "tasks"),
    steps: entities<Step>(path, f.steps, "steps"),
  };
}

/** Everything on this device in one file, for a backup or to move to another provider */
export interface ExportFile extends Snapshot {
  doozly: "export";
  schema: typeof SCHEMA_VERSION;
  exportedAt: string;
}

export function encodeExport(
  snapshot: Snapshot,
  now = new Date(),
): Uint8Array<ArrayBuffer> {
  const file: ExportFile = {
    doozly: "export",
    schema: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    ...snapshot,
  };
  // Indented, people do open these
  return new TextEncoder().encode(JSON.stringify(file, null, 2));
}

export function decodeExport(name: string, data: Uint8Array): Snapshot {
  const f = parse(name, data);
  if (f.doozly !== "export") {
    throw new BadFileError(name, "not a Doozly export");
  }
  return {
    lists: entities<List>(name, f.lists, "lists"),
    groups: entities<ListGroup>(name, f.groups, "groups"),
    tasks: entities<Task>(name, f.tasks, "tasks"),
    steps: entities<Step>(name, f.steps, "steps"),
    settings: settingRecords(name, f.settings),
  };
}
