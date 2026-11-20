import type { Accent } from "../styles/accents.ts";
import type { Background } from "../styles/backgrounds.ts";
import { type Stamp, stamp } from "./clock.ts";

// Everything that syncs is merged per record, so every record carries these
export interface Entity {
  id: string;
  /** Epoch ms, for "sort by creation date" */
  createdAt: number;
  /** Last-writer-wins stamp, bumped on every change including the delete */
  updatedAt: Stamp;
  /** Tombstone in epoch ms. Deleted records stay until the retention prune. */
  deletedAt: number | null;
}

/** A calendar date with no time zone, "YYYY-MM-DD" */
export type LocalDate = string;

/** Fractional index: compare as plain strings, insert between two without touching others */
export type Position = string;

export type SortBy = "importance" | "dueDate" | "myDay" | "title" | "createdAt";

export interface ListSort {
  by: SortBy;
  direction: "asc" | "desc";
}

/** Headings to split a list's tasks under, by the same fields it can sort on */
export type GroupBy = SortBy;

export interface List extends Entity {
  title: string;
  accent: Accent;
  background: Background | null;
  groupId: string | null;
  position: Position;
  /** null means the user's own drag order */
  sort: ListSort | null;
  group: GroupBy | null;
  showCompleted: boolean;
}

export interface ListGroup extends Entity {
  title: string;
  position: Position;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RepeatRule {
  unit: "day" | "week" | "month" | "year";
  interval: number;
  /** Only for unit "week". Sunday is 0, like Date#getDay. */
  weekdays?: Weekday[];
  /**
   * Only for "month" and "year": the day of the month it was set on. Short months
   * clamp to their last day, and the next long one goes back to it.
   */
  monthDay?: number;
}

export interface Task extends Entity {
  listId: string;
  title: string;
  completedAt: number | null;
  important: boolean;
  /** The day it was added to My Day. It's only in My Day while this is today. */
  myDay: LocalDate | null;
  dueDate: LocalDate | null;
  /** Epoch ms */
  reminderAt: number | null;
  repeat: RepeatRule | null;
  note: string;
  position: Position;
}

export interface Step extends Entity {
  taskId: string;
  title: string;
  completedAt: number | null;
  position: Position;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  confirmBeforeDelete: boolean;
  addNewTasksOnTop: boolean;
  moveStarredToTop: boolean;
  playCompletionSound: boolean;
  /** Single-key shortcuts like N and D. They can be turned off, for WCAG 2.1.4. */
  keyboardShortcuts: boolean;
  /**
   * AES key (base64) that seals reminder payloads for the relay. Not a preference, but
   * settings.json is how the user's other devices get it. "" until the first one's needed.
   */
  reminderKey: string;
}

export const defaultSettings: Settings = {
  theme: "system",
  confirmBeforeDelete: true,
  addNewTasksOnTop: true,
  moveStarredToTop: true,
  playCompletionSound: true,
  keyboardShortcuts: true,
  reminderKey: "",
};

// One record per setting, so two devices changing different settings don't clash
export type SettingRecord = {
  [K in keyof Settings]: { key: K; value: Settings[K]; updatedAt: Stamp };
}[keyof Settings];

/** The built-in "Tasks" list. Same id on every device, so it merges instead of doubling. */
export const INBOX_ID = "inbox";

function entity(id: string = crypto.randomUUID()): Entity {
  return { id, createdAt: Date.now(), updatedAt: stamp(), deletedAt: null };
}

export function createList(
  fields: Pick<List, "title" | "position"> & Partial<List>,
): List {
  return {
    ...entity(fields.id),
    accent: "teal",
    background: null,
    groupId: null,
    sort: null,
    group: null,
    showCompleted: true,
    ...fields,
  };
}

export function createInbox(): List {
  return createList({ id: INBOX_ID, title: "Tasks", position: "a0" });
}

export function createGroup(
  fields: Pick<ListGroup, "title" | "position"> & Partial<ListGroup>,
): ListGroup {
  return { ...entity(fields.id), ...fields };
}

export function createTask(
  fields: Pick<Task, "listId" | "title" | "position"> & Partial<Task>,
): Task {
  return {
    ...entity(fields.id),
    completedAt: null,
    important: false,
    myDay: null,
    dueDate: null,
    reminderAt: null,
    repeat: null,
    note: "",
    ...fields,
  };
}

export function createStep(
  fields: Pick<Step, "taskId" | "title" | "position"> & Partial<Step>,
): Step {
  return { ...entity(fields.id), completedAt: null, ...fields };
}
