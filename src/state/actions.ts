import { generateNKeysBetween } from "fractional-indexing";
import { clock, stamp } from "../data/clock.ts";
import type { Snapshot } from "../data/db.ts";
import { today } from "../data/localDate.ts";
import {
  createGroup,
  createList,
  createStep,
  createTask,
  defaultSettings,
  type Entity,
  INBOX_ID,
  type List,
  type ListGroup,
  type LocalDate,
  type Settings,
  type Step,
  type Task,
} from "../data/model.ts";
import { nextDates } from "../data/repeat.ts";
import { changes, latestStamp, mergeSnapshots } from "../sync/merge.ts";
import { uniqueTitle } from "./naming.ts";
import { byPosition, positionBetween } from "./position.ts";
import type { App, AppState, Undo } from "./store.ts";

type Editable<T> = Partial<Omit<T, keyof Entity>>;

/** Where to put something: between two neighbours, by id. null is the start or the end. */
export interface Placement {
  prevId: string | null;
  nextId: string | null;
}

const touch = <T extends Entity>(r: T, patch: Partial<NoInfer<T>> = {}): T => ({
  ...r,
  ...patch,
  updatedAt: stamp(),
});

const tombstone = <T extends Entity>(r: T): T =>
  touch(r, { deletedAt: Date.now() } as Partial<T>);

/** Everything but the identity and stamps, for making a copy */
function contentOf<T extends Entity>(r: T): Omit<T, keyof Entity> {
  const { id, createdAt, updatedAt, deletedAt, ...content } = r;
  return content;
}

const live = <T extends Entity>(rows: Record<string, T>): T[] =>
  Object.values(rows).filter((r) => r.deletedAt === null);

export function setting<K extends keyof Settings>(
  state: Pick<AppState, "settings">,
  key: K,
): Settings[K] {
  const record = state.settings[key];
  return (record?.value as Settings[K] | undefined) ?? defaultSettings[key];
}

export function createActions({ store, commit }: App) {
  const get = () => store.getState();

  const liveTask = (id: string) => {
    const t = get().tasks[id];
    return t && t.deletedAt === null ? t : undefined;
  };
  const liveStep = (id: string) => {
    const s = get().steps[id];
    return s && s.deletedAt === null ? s : undefined;
  };
  const liveGroup = (id: string) => {
    const g = get().groups[id];
    return g && g.deletedAt === null ? g : undefined;
  };
  const liveList = (id: string) => {
    const l = get().lists[id];
    return l && l.deletedAt === null ? l : undefined;
  };

  const tasksIn = (listId: string) =>
    live(get().tasks)
      .filter((t) => t.listId === listId)
      .sort(byPosition);
  const stepsOf = (taskId: string) =>
    live(get().steps)
      .filter((s) => s.taskId === taskId)
      .sort(byPosition);

  // Groups and ungrouped lists share one order in the sidebar, lists inside a group have their own
  const sidebarLevel = (groupId: string | null): (List | ListGroup)[] => {
    const lists = live(get().lists).filter((l) => l.groupId === groupId);
    return groupId === null ? [...lists, ...live(get().groups)] : lists;
  };

  const between = (
    rows: { id: string; position: string }[],
    { prevId, nextId }: Placement,
  ) =>
    positionBetween(
      rows.find((r) => r.id === prevId)?.position ?? null,
      rows.find((r) => r.id === nextId)?.position ?? null,
    );

  const atEnd = (rows: { id: string; position: string }[], top: boolean) => {
    const sorted = [...rows].sort(byPosition);
    return top
      ? positionBetween(null, sorted[0]?.position ?? null)
      : positionBetween(sorted.at(-1)?.position ?? null, null);
  };

  return {
    addTask(
      listId: string,
      title: string,
      fields: Editable<Omit<Task, "listId" | "title">> = {},
    ): Task | null {
      const clean = title.trim();
      if (!clean) return null;
      const top = setting(get(), "addNewTasksOnTop");
      const task = createTask({
        ...fields,
        listId,
        title: clean,
        position: atEnd(tasksIn(listId), top),
      });
      commit({ tasks: [task] });
      return task;
    },

    updateTask(id: string, patch: Editable<Task>): Undo | null {
      const task = liveTask(id);
      return task ? commit({ tasks: [touch(task, patch)] }) : null;
    },

    /**
     * Completing a repeating task leaves a fresh copy in its place, with the next
     * dates and its steps unticked. The done one keeps no rule, so ticking it off
     * again later doesn't make a second copy.
     */
    toggleCompleted(id: string, now: LocalDate = today()): Undo | null {
      const task = liveTask(id);
      if (!task) return null;
      if (task.completedAt !== null) {
        return commit({ tasks: [touch(task, { completedAt: null })] });
      }
      const done = touch(task, { completedAt: Date.now() });
      const next = nextDates(task, now);
      if (!next) return commit({ tasks: [done] });

      const siblings = tasksIn(task.listId);
      const before = siblings[siblings.findIndex((t) => t.id === id) - 1];
      const copy = createTask({
        ...contentOf(task),
        ...next,
        position: positionBetween(before?.position ?? null, task.position),
      });
      return commit({
        tasks: [{ ...done, repeat: null }, copy],
        steps: stepsOf(id).map((s) =>
          createStep({ ...contentOf(s), taskId: copy.id, completedAt: null }),
        ),
      });
    },

    toggleImportant(id: string): Undo | null {
      const task = liveTask(id);
      if (!task) return null;
      return commit({ tasks: [touch(task, { important: !task.important })] });
    },

    /** In My Day means added today. Tomorrow it drops out by itself. */
    toggleMyDay(id: string, now: LocalDate = today()): Undo | null {
      const task = liveTask(id);
      if (!task) return null;
      const myDay = task.myDay === now ? null : now;
      return commit({ tasks: [touch(task, { myDay })] });
    },

    deleteTask(id: string): Undo | null {
      const task = liveTask(id);
      if (!task) return null;
      return commit({
        tasks: [tombstone(task)],
        steps: stepsOf(id).map(tombstone),
      });
    },

    /** Reorder, and optionally move to another list at the same time */
    moveTask(id: string, to: Placement & { listId?: string }): Undo | null {
      const task = liveTask(id);
      const listId = to.listId ?? task?.listId;
      if (!task || !listId || !liveList(listId)) return null;
      const position = between(tasksIn(listId), to);
      return commit({ tasks: [touch(task, { listId, position })] });
    },

    /** Into another list, on top or at the end like a new task would go */
    moveTaskToList(id: string, listId: string): Undo | null {
      const task = liveTask(id);
      if (!task || task.listId === listId || !liveList(listId)) return null;
      const top = setting(get(), "addNewTasksOnTop");
      const position = atEnd(tasksIn(listId), top);
      return commit({ tasks: [touch(task, { listId, position })] });
    },

    addStep(taskId: string, title: string): Step | null {
      const clean = title.trim();
      if (!clean || !liveTask(taskId)) return null;
      const step = createStep({
        taskId,
        title: clean,
        position: atEnd(stepsOf(taskId), false),
      });
      commit({ steps: [step] });
      return step;
    },

    updateStep(id: string, patch: Editable<Step>): Undo | null {
      const step = liveStep(id);
      return step ? commit({ steps: [touch(step, patch)] }) : null;
    },

    toggleStep(id: string): Undo | null {
      const step = liveStep(id);
      if (!step) return null;
      const completedAt = step.completedAt === null ? Date.now() : null;
      return commit({ steps: [touch(step, { completedAt })] });
    },

    deleteStep(id: string): Undo | null {
      const step = liveStep(id);
      return step ? commit({ steps: [tombstone(step)] }) : null;
    },

    moveStep(id: string, to: Placement): Undo | null {
      const step = liveStep(id);
      if (!step) return null;
      const position = between(stepsOf(step.taskId), to);
      return commit({ steps: [touch(step, { position })] });
    },

    addList(title: string, fields: Editable<List> = {}): List {
      const list = createList({
        ...fields,
        title: title.trim(),
        groupId: fields.groupId ?? null,
        position: atEnd(sidebarLevel(fields.groupId ?? null), false),
      });
      commit({ lists: [list] });
      return list;
    },

    updateList(id: string, patch: Editable<List>): Undo | null {
      const list = liveList(id);
      return list ? commit({ lists: [touch(list, patch)] }) : null;
    },

    /** Takes its tasks and their steps along. The built-in Tasks list can't go. */
    deleteList(id: string): Undo | null {
      const list = liveList(id);
      if (!list || id === INBOX_ID) return null;
      const tasks = tasksIn(id);
      const taskIds = new Set(tasks.map((t) => t.id));
      return commit({
        lists: [tombstone(list)],
        tasks: tasks.map(tombstone),
        steps: live(get().steps)
          .filter((s) => taskIds.has(s.taskId))
          .map(tombstone),
      });
    },

    /** A copy right below the original, with every task and step under fresh ids */
    duplicateList(id: string): List | null {
      const list = liveList(id);
      if (!list) return null;
      const level = sidebarLevel(list.groupId).sort(byPosition);
      const next = level[level.findIndex((x) => x.id === id) + 1];
      const copy = createList({
        ...contentOf(list),
        title: uniqueTitle(
          list.title,
          live(get().lists).map((l) => l.title),
        ),
        position: positionBetween(list.position, next?.position ?? null),
      });

      const tasks: Task[] = [];
      const steps: Step[] = [];
      for (const task of tasksIn(id)) {
        const taskCopy = createTask({ ...contentOf(task), listId: copy.id });
        tasks.push(taskCopy);
        for (const step of stepsOf(task.id)) {
          steps.push(createStep({ ...contentOf(step), taskId: taskCopy.id }));
        }
      }
      commit({ lists: [copy], tasks, steps });
      return copy;
    },

    moveList(
      id: string,
      to: Placement & { groupId?: string | null },
    ): Undo | null {
      const list = liveList(id);
      if (!list || id === INBOX_ID) return null;
      const groupId = to.groupId === undefined ? list.groupId : to.groupId;
      const position = between(sidebarLevel(groupId), to);
      return commit({ lists: [touch(list, { groupId, position })] });
    },

    /** Puts a list at the end of a group, or of the top level with null */
    moveListToGroup(id: string, groupId: string | null): Undo | null {
      const list = liveList(id);
      if (!list || id === INBOX_ID) return null;
      if (groupId !== null && !liveGroup(groupId)) return null;
      const others = sidebarLevel(groupId).filter((x) => x.id !== id);
      return commit({
        lists: [touch(list, { groupId, position: atEnd(others, false) })],
      });
    },

    addGroup(title: string): ListGroup {
      const group = createGroup({
        title: title.trim(),
        position: atEnd(sidebarLevel(null), false),
      });
      commit({ groups: [group] });
      return group;
    },

    updateGroup(id: string, patch: Editable<ListGroup>): Undo | null {
      const group = liveGroup(id);
      return group ? commit({ groups: [touch(group, patch)] }) : null;
    },

    /** Groups only live at the top level, between ungrouped lists and other groups */
    moveGroup(id: string, to: Placement): Undo | null {
      const group = liveGroup(id);
      if (!group) return null;
      const position = between(sidebarLevel(null), to);
      return commit({ groups: [touch(group, { position })] });
    },

    /** Lists come out right where the group was, in their order, and the group goes */
    ungroup(id: string): Undo | null {
      const group = liveGroup(id);
      if (!group) return null;
      const inside = sidebarLevel(id).sort(byPosition);
      const level = sidebarLevel(null).sort(byPosition);
      const at = level.findIndex((x) => x.id === id);
      const positions = generateNKeysBetween(
        level[at - 1]?.position ?? null,
        level[at + 1]?.position ?? null,
        inside.length,
      );
      return commit({
        groups: [tombstone(group)],
        lists: inside.map((list, i) =>
          touch(list as List, {
            groupId: null,
            position: positions[i] ?? list.position,
          }),
        ),
      });
    },

    /** Only empty groups can be deleted, the lists in a group would need a home first */
    deleteGroup(id: string): Undo | null {
      const group = liveGroup(id);
      if (!group || sidebarLevel(id).length > 0) return null;
      return commit({ groups: [tombstone(group)] });
    },

    setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Undo {
      return commit({
        settings: [{ key, value, updatedAt: stamp() } as never],
      });
    },

    /** Takes in an export like a sync would: per record the newer one wins. null when nothing in it is new. */
    importSnapshot(
      snapshot: Snapshot,
    ): { undo: Undo; lists: number; tasks: number } | null {
      const latest = latestStamp(snapshot);
      if (latest) clock.receive(latest, Date.now());
      const s = get();
      const local: Snapshot = {
        lists: Object.values(s.lists),
        groups: Object.values(s.groups),
        tasks: Object.values(s.tasks),
        steps: Object.values(s.steps),
        settings: Object.values(s.settings),
      };
      const batch = changes(local, mergeSnapshots(local, snapshot));
      if (!Object.values(batch).some((rows) => rows?.length)) return null;
      const alive = (rows: Entity[] = []) =>
        rows.filter((r) => r.deletedAt === null).length;
      return {
        undo: commit(batch),
        lists: alive(batch.lists),
        tasks: alive(batch.tasks),
      };
    },
  };
}

export type Actions = ReturnType<typeof createActions>;
