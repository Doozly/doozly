import { inMyDay } from "../data/localDate.ts";
import {
  type GroupBy,
  INBOX_ID,
  type List,
  type ListSort,
  type LocalDate,
  type Task,
} from "../data/model.ts";
import type { Accent } from "../styles/accents.ts";
import type { IconName } from "../ui/Icon.tsx";

/** Anything the list view can show: one of the user's lists, or a smart list */
export interface View {
  id: string;
  title: string;
  /** A small line under the title, My Day shows the date */
  subtitle?: string;
  icon: IconName;
  accent: Accent;
  /** The real list behind it, null for smart lists */
  list: List | null;
  includes: (task: Task) => boolean;
  /** Where a task typed into this view goes, and what it starts with. null has no "Add a task". */
  newTask: { listId: string; fields: Partial<Task> } | null;
  showCompleted: boolean;
  /** "position" is the user's drag order, "newest" and "due" are for views across lists */
  order: "position" | "newest" | "due";
  /** The user's own pick from the Sort menu, it wins over `order` */
  sort: ListSort | null;
  /** Headings to split the open tasks under */
  group: "none" | "list" | GroupBy;
  emptyText: string;
}

export const SMART_IDS = ["my-day", "important", "planned", "all"] as const;
export type SmartId = (typeof SMART_IDS)[number];

export function isSmartId(id: string): id is SmartId {
  return (SMART_IDS as readonly string[]).includes(id);
}

/** Smart lists depend on the day, `now` comes from useToday so they turn over at midnight */
export function smartView(id: SmartId, now: LocalDate): View {
  switch (id) {
    case "my-day":
      return {
        id,
        title: "My Day",
        subtitle: new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date(`${now}T12:00`)),
        icon: "myDay",
        accent: "amber",
        list: null,
        includes: (t) => inMyDay(t, now),
        newTask: { listId: INBOX_ID, fields: { myDay: now } },
        showCompleted: true,
        order: "newest",
        sort: null,
        group: "none",
        emptyText:
          "Focus on your day. Add tasks here, or pick some from Suggestions.",
      };
    case "important":
      return {
        id,
        title: "Important",
        icon: "important",
        accent: "pink",
        list: null,
        includes: (t) => t.important,
        // Like To Do: typed in Important means starred, and it lands in Tasks
        newTask: { listId: INBOX_ID, fields: { important: true } },
        showCompleted: false,
        order: "newest",
        sort: null,
        group: "none",
        emptyText: "Star the tasks that matter most and they gather here.",
      };
    case "planned":
      return {
        id,
        title: "Planned",
        icon: "planned",
        accent: "teal",
        list: null,
        includes: (t) => t.dueDate !== null,
        // Like To Do: typed in Planned means due today
        newTask: { listId: INBOX_ID, fields: { dueDate: now } },
        showCompleted: false,
        order: "due",
        sort: null,
        group: "dueDate",
        emptyText:
          "Tasks with a due date show up here, sorted by when they're due.",
      };
    case "all":
      return {
        id,
        title: "All",
        icon: "allTasks",
        accent: "slate",
        list: null,
        includes: () => true,
        newTask: { listId: INBOX_ID, fields: {} },
        showCompleted: false,
        order: "newest",
        sort: null,
        group: "list",
        emptyText: "Every open task from every list shows up here.",
      };
  }
}

export const SEARCH_ID = "search";

/** Search results across all lists, `matches` being the task ids that fit */
export function searchView(query: string, matches: Set<string>): View {
  const q = query.trim();
  return {
    id: SEARCH_ID,
    title: q ? `Searching for "${q}"` : "Search",
    icon: "search",
    accent: "slate",
    list: null,
    includes: (t) => matches.has(t.id),
    newTask: null,
    showCompleted: true,
    order: "position",
    sort: null,
    group: "list",
    emptyText: q
      ? `Nothing matches "${q}". Try a shorter word.`
      : "Search titles, steps and notes across all your lists.",
  };
}

export function listView(list: List): View {
  return {
    id: list.id,
    title: list.title,
    icon: list.id === INBOX_ID ? "tasks" : "list",
    accent: list.accent,
    list,
    includes: (t) => t.listId === list.id,
    newTask: { listId: list.id, fields: {} },
    showCompleted: list.showCompleted,
    order: "position",
    sort: list.sort,
    // Lists saved before grouping came along have no field for it
    group: list.group ?? "none",
    emptyText:
      list.id === INBOX_ID
        ? "Tasks that aren't in any of your lists live here."
        : "Nothing here yet. Add a task to get going.",
  };
}
