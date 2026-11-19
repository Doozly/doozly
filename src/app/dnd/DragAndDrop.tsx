import {
  type Active,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DroppableContainer,
  MeasuringStrategy,
  type Modifier,
  MouseSensor,
  type Over,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SortableData } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import type { List, ListGroup, Task } from "../../data/model.ts";
import { useActions } from "../../state/AppContext.tsx";
import type { Placement } from "../../state/actions.ts";
import { Icon } from "../../ui/Icon.tsx";
import { listView, type View } from "../views.ts";
import styles from "./DragAndDrop.module.css";
import { placementAt } from "./reorder.ts";

/** What hangs on each draggable and drop target, so a drop knows what met what */
export type DragData =
  | { type: "task"; task: Task; reorder: boolean }
  | { type: "list"; list: List }
  | { type: "group"; group: ListGroup }
  /** Smart lists and Tasks in the sidebar, they only take tasks */
  | { type: "view"; view: View };

/** The container id of the sidebar's top level, groups use their own id */
export const TOP = "top";

const dataOf = (x: Active | Over | DroppableContainer | null) =>
  x?.data.current as (DragData & Partial<SortableData>) | undefined;

export function useDragSensors(
  mouse: { distance: number } | { delay: number; tolerance: number } = {
    distance: 5,
  },
) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: mouse }),
    // Hold to drag on touch, so a swipe still scrolls
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );
}

/** The click after letting go would open the task or list, swallow it */
export function swallowNextClick() {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

const collisions: CollisionDetection = (args) => {
  const active = dataOf(args.active);
  const only = (keep: (d: ReturnType<typeof dataOf>) => boolean) => ({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      keep(dataOf(c)),
    ),
  });
  if (active?.type === "task") {
    // A list in the sidebar takes the task when the pointer is right on it
    const lists = pointerWithin(
      only((d) => d?.type === "view" || d?.type === "list"),
    );
    if (lists.length > 0) return lists;
    return closestCenter(only((d) => d?.type === "task"));
  }
  if (active?.type === "group") {
    return closestCenter(
      only((d) => d?.type !== "task" && d?.sortable?.containerId === TOP),
    );
  }
  return closestCenter(only((d) => d?.type === "list" || d?.type === "group"));
};

/** A task row is wide and its preview isn't, so the preview starts right by the pointer */
const nearPointer: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  const at = activatorEvent && getEventCoordinates(activatorEvent);
  if (!at || !draggingNodeRect) return transform;
  return { ...transform, x: transform.x + at.x - draggingNodeRect.left - 24 };
};

/** Where the active item lands among what it's over */
function placement(active: Active, over: Over): Placement | null {
  const from = dataOf(active)?.sortable;
  const to = dataOf(over)?.sortable;
  if (!from || !to) return null;
  if (from.containerId === to.containerId) {
    if (from.index === to.index) return null;
    return placementAt(from.items.map(String), from.index, to.index);
  }
  // From another container: before or after it, by which half it's dropped on
  const rect = active.rect.current.translated;
  const after = rect
    ? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
    : false;
  const items = to.items.map(String);
  return after
    ? { prevId: String(over.id), nextId: items[to.index + 1] ?? null }
    : { prevId: items[to.index - 1] ?? null, nextId: String(over.id) };
}

/** One drag context for the sidebar and the task list, so tasks can be dropped on lists */
export function DragAndDrop({ children }: { children: ReactNode }) {
  const actions = useActions();
  const sensors = useDragSensors();
  const [dragging, setDragging] = useState<DragData | null>(null);

  const dropTaskOn = (task: Task, view: View) => {
    if (view.list) {
      actions.moveTaskToList(task.id, view.list.id);
    } else if (view.newTask) {
      // Smart lists set what makes a task belong there, like My Day or the star
      actions.updateTask(task.id, view.newTask.fields);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    swallowNextClick();
    const from = dataOf(active);
    const to = dataOf(over);
    if (!from || !to || !over) return;

    if (from.type === "task") {
      if (to.type === "task") {
        const at = to.reorder ? placement(active, over) : null;
        const sameList =
          from.sortable?.containerId === to.sortable?.containerId;
        if (at && sameList) actions.moveTask(from.task.id, at);
      }
      if (to.type === "list") dropTaskOn(from.task, listView(to.list));
      if (to.type === "view") dropTaskOn(from.task, to.view);
    }

    if (from.type === "list") {
      if (to.type === "group") {
        if (from.list.groupId !== to.group.id) {
          actions.moveListToGroup(from.list.id, to.group.id);
        }
        return;
      }
      const at = placement(active, over);
      if (to.type === "list" && at) {
        actions.moveList(from.list.id, { ...at, groupId: to.list.groupId });
      }
    }

    if (from.type === "group") {
      const at = placement(active, over);
      if (at) actions.moveGroup(from.group.id, at);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      // A dragged group folds up, also the spots around it move mid-drag
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }) => setDragging(dataOf(active) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      {children}
      {createPortal(
        <DragOverlay
          dropAnimation={null}
          modifiers={dragging?.type === "task" ? [nearPointer] : []}
        >
          {dragging && <DragPreview data={dragging} />}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function DragPreview({ data }: { data: DragData }) {
  const [icon, title] =
    data.type === "task"
      ? (["incomplete", data.task.title] as const)
      : data.type === "list"
        ? (["list", data.list.title] as const)
        : data.type === "group"
          ? (["group", data.group.title] as const)
          : (["list", data.view.title] as const);
  return (
    <div className={styles.preview} data-kind={data.type}>
      <Icon name={icon} />
      <span className={styles.title}>{title}</span>
    </div>
  );
}
