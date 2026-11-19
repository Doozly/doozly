import { type DraggableSyntheticListeners, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  type SortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useShallow } from "zustand/react/shallow";
import {
  INBOX_ID,
  type List,
  type ListGroup,
  type LocalDate,
  type Task,
} from "../data/model.ts";
import { useActions, useAppState } from "../state/AppContext.tsx";
import { uniqueTitle } from "../state/naming.ts";
import { byPosition } from "../state/position.ts";
import {
  ContextMenu,
  isMenuKey,
  type MenuEntry,
  menuPointFor,
} from "../ui/ContextMenu.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { InlineRename } from "../ui/InlineRename.tsx";
import { useToday } from "../ui/useToday.ts";
import { type DragData, TOP } from "./dnd/DragAndDrop.tsx";
import { MOVE_KEYS, moveKey, nudge } from "./dnd/reorder.ts";
import { useListMenu } from "./lists/useListMenu.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Sidebar.module.css";
import { useUi } from "./uiStore.ts";
import { listView, SMART_IDS, smartView, type View } from "./views.ts";

interface SidebarProps {
  /** Wide screens get a button to hide the sidebar */
  onCollapse?: () => void;
  /** Called after picking or making a list, so the drawer can close */
  onNavigate?: () => void;
}

export function Sidebar({ onCollapse, onNavigate }: SidebarProps) {
  const lists = useAppState(
    useShallow((s) =>
      Object.values(s.lists)
        .filter((l) => l.deletedAt === null)
        .sort(byPosition),
    ),
  );
  const now = useToday();
  const counts = useAppState(useShallow((s) => openTaskCounts(s, now)));
  const groups = useAppState(
    useShallow((s) =>
      Object.values(s.groups)
        .filter((g) => g.deletedAt === null)
        .sort(byPosition),
    ),
  );
  const { moveList, moveGroup } = useActions();
  const listMenu = useListMenu({ onDone: onNavigate });
  const groupMenu = useGroupMenu();
  const inbox = lists.find((l) => l.id === INBOX_ID);
  // Groups and ungrouped lists share one order, lists in a group have their own
  const top = [
    ...lists
      .filter((l) => l.id !== INBOX_ID && l.groupId === null)
      .map((list) => ({
        kind: "list" as const,
        list,
        position: list.position,
        id: list.id,
      })),
    ...groups.map((group) => ({
      kind: "group" as const,
      group,
      position: group.position,
      id: group.id,
    })),
  ].sort(byPosition);
  const topIds = top.map((e) => e.id);
  // A list held over a group goes into it, so nothing should make room there
  const topStrategy: SortingStrategy = (args) =>
    top[args.activeIndex]?.kind === "list" &&
    top[args.overIndex]?.kind === "group"
      ? null
      : verticalListSortingStrategy(args);

  const item = (list: List, siblings: string[]) => (
    <SortableListItem
      key={list.id}
      list={list}
      count={counts[list.id]}
      onNavigate={onNavigate}
      onMenu={listMenu.open}
      onMove={(by) => {
        const at = nudge(siblings, list.id, by);
        if (at) moveList(list.id, { ...at, groupId: list.groupId });
      }}
    />
  );

  return (
    <nav aria-label="Lists" className={styles.sidebar}>
      {onCollapse && (
        <div className={styles.top}>
          <IconButton icon="menu" label="Hide sidebar" onPress={onCollapse} />
        </div>
      )}
      <div className={styles.scroll}>
        {/* Smart lists first, then the built-in Tasks list, like To Do */}
        <ul className={styles.section}>
          {SMART_IDS.map((id) => (
            <DropListItem
              key={id}
              view={smartView(id, now)}
              count={counts[id]}
              onNavigate={onNavigate}
            />
          ))}
          {inbox && (
            <DropListItem
              view={listView(inbox)}
              count={counts[inbox.id]}
              onNavigate={onNavigate}
              onMenu={listMenu.open}
            />
          )}
        </ul>
        {top.length > 0 && (
          <SortableContext id={TOP} items={topIds} strategy={topStrategy}>
            <ul className={`${styles.section} ${styles.own}`}>
              {top.map((entry) =>
                entry.kind === "list" ? (
                  item(entry.list, topIds)
                ) : (
                  <GroupItem
                    key={entry.id}
                    group={entry.group}
                    lists={lists.filter((l) => l.groupId === entry.id)}
                    renderList={item}
                    onMenu={groupMenu.open}
                    onMove={(by) => {
                      const at = nudge(topIds, entry.id, by);
                      if (at) moveGroup(entry.id, at);
                    }}
                  />
                ),
              )}
            </ul>
          </SortableContext>
        )}
      </div>
      <div className={styles.bottom}>
        <NewList
          taken={lists.map((l) => l.title)}
          onCreated={() => onNavigate?.()}
        />
        <NewGroup taken={groups.map((g) => g.title)} />
      </div>
      {listMenu.element}
      {groupMenu.element}
    </nav>
  );
}

/** Open tasks per list id, and per smart list id */
function openTaskCounts(
  s: { tasks: Record<string, Task> },
  now: LocalDate,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const smart = SMART_IDS.map((id) => smartView(id, now));
  for (const t of Object.values(s.tasks)) {
    if (t.deletedAt !== null || t.completedAt !== null) continue;
    add(t.listId);
    for (const v of smart) if (v.includes(t)) add(v.id);
  }
  return counts;
}

interface ListItemProps {
  view: View;
  count: number | undefined;
  onNavigate?: () => void;
  /** Only real lists have a menu */
  onMenu?: (list: List, at: { x: number; y: number }) => void;
  /** Alt+Up and Alt+Down, for the user's own lists */
  onMove?: (by: -1 | 1) => void;
  drag?: {
    ref: (el: HTMLElement | null) => void;
    style?: CSSProperties;
    listeners?: DraggableSyntheticListeners;
    dragging?: boolean;
    /** A task is held over it */
    dropTarget?: boolean;
  };
}

const typeOf = (x: { data: { current?: unknown } } | null) =>
  (x?.data.current as DragData | undefined)?.type;

/** One of the user's lists: drag it around, and drop tasks on it */
function SortableListItem({
  list,
  ...props
}: Omit<ListItemProps, "view" | "drag"> & { list: List }) {
  const data: DragData = { type: "list", list };
  const {
    setNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id: list.id, data });
  return (
    <ListItem
      {...props}
      view={listView(list)}
      drag={{
        ref: setNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        listeners,
        dragging: isDragging,
        dropTarget: isOver && typeOf(active) === "task",
      }}
    />
  );
}

/** Smart lists and Tasks stay put, but take tasks dropped on them */
function DropListItem(props: Omit<ListItemProps, "drag">) {
  const { view } = props;
  // All has nothing to set on a task, so there's nothing a drop could do
  const takes =
    view.list !== null || Object.keys(view.newTask?.fields ?? {}).length > 0;
  const data: DragData = { type: "view", view };
  const { setNodeRef, isOver, active } = useDroppable({
    id: `view:${view.id}`,
    data,
    disabled: !takes,
  });
  return (
    <ListItem
      {...props}
      drag={{
        ref: setNodeRef,
        dropTarget: isOver && typeOf(active) === "task",
      }}
    />
  );
}

function ListItem({
  view,
  count,
  onNavigate,
  onMenu,
  onMove,
  drag,
}: ListItemProps) {
  const { listId } = useSelection();
  const { list } = view;
  return (
    <li
      ref={drag?.ref}
      style={drag?.style}
      className={styles.listItem}
      data-dragging={drag?.dragging || undefined}
      data-drop-target={drag?.dropTarget || undefined}
      {...drag?.listeners}
    >
      <Link
        href={paths.list(view.id)}
        className={styles.item}
        aria-current={view.id === listId ? "page" : undefined}
        aria-keyshortcuts={onMove ? MOVE_KEYS : undefined}
        data-accent={view.accent}
        draggable={false}
        onClick={onNavigate}
        onContextMenu={(e) => {
          if (!list || !onMenu) return;
          e.preventDefault();
          onMenu(list, { x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if (list && onMenu && isMenuKey(e)) {
            e.preventDefault();
            onMenu(list, menuPointFor(e.currentTarget));
          }
          const by = moveKey(e);
          if (by && onMove) {
            e.preventDefault();
            onMove(by);
          }
        }}
      >
        <Icon name={view.icon} />
        <span className={styles.title}>{view.title}</span>
        {/* The space keeps title and count apart for screen readers, flex hides it */}{" "}
        {count ? (
          <span className={styles.count}>
            {count}{" "}
            <span className="visually-hidden">
              {count === 1 ? "open task" : "open tasks"}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NewList({
  taken,
  onCreated,
}: {
  taken: string[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [, navigate] = useLocation();
  const { addList } = useActions();

  return (
    <form
      className={styles.newList}
      onSubmit={(e) => {
        e.preventDefault();
        const list = addList(
          title.trim() || uniqueTitle("Untitled list", taken),
        );
        setTitle("");
        navigate(paths.list(list.id));
        onCreated();
      }}
    >
      <Icon name="add" />
      <input
        className={styles.newListInput}
        aria-label="New list"
        placeholder="New list"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            e.currentTarget.blur();
          }
        }}
      />
    </form>
  );
}

interface GroupItemProps {
  group: ListGroup;
  lists: List[];
  renderList: (list: List, siblings: string[]) => ReactNode;
  onMenu: (
    group: ListGroup,
    at: { x: number; y: number },
    empty: boolean,
  ) => void;
  onMove: (by: -1 | 1) => void;
}

function GroupItem({
  group,
  lists,
  renderList,
  onMenu,
  onMove,
}: GroupItemProps) {
  const userFolded = useUi((s) => s.groupsFolded[group.id] ?? false);
  const renaming = useUi((s) => s.renamingGroupId === group.id);
  const { toggleGroup, setRenamingGroup } = useUi();
  const { updateGroup } = useActions();
  const empty = lists.length === 0;
  const data: DragData = { type: "group", group };
  // The header is the drag handle and the drop spot, the lists come along under it
  const {
    setNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id: group.id, data });
  // Folded while it's dragged, so it takes up as little room as it measures
  const folded = userFolded || isDragging;
  const sorted = [...lists].sort(byPosition);
  const ids = sorted.map((l) => l.id);

  return (
    <li
      className={styles.group}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging || undefined}
    >
      <div
        ref={setNodeRef}
        data-drop-target={(isOver && typeOf(active) === "list") || undefined}
        {...listeners}
      >
        {renaming ? (
          <InlineRename
            value={group.title}
            label="Group name"
            className={styles.groupInput}
            onSave={(title) => updateGroup(group.id, { title })}
            onDone={() => setRenamingGroup(null)}
          />
        ) : (
          <button
            type="button"
            className={styles.groupHeader}
            aria-expanded={!folded}
            aria-keyshortcuts={MOVE_KEYS}
            onClick={() => toggleGroup(group.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(group, { x: e.clientX, y: e.clientY }, empty);
            }}
            onKeyDown={(e) => {
              if (isMenuKey(e)) {
                e.preventDefault();
                onMenu(group, menuPointFor(e.currentTarget), empty);
              }
              const by = moveKey(e);
              if (by) {
                e.preventDefault();
                onMove(by);
              }
            }}
          >
            <Icon name="group" />
            <span className={styles.title}>{group.title}</span>
            <Icon name={folded ? "chevronRight" : "chevronDown"} size={16} />
          </button>
        )}
      </div>
      {!folded && (
        <SortableContext
          id={group.id}
          items={ids}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.groupLists} aria-label={group.title}>
            {empty ? (
              <li className={styles.groupEmpty}>
                Drag lists here, or move them from their menu
              </li>
            ) : (
              sorted.map((list) => renderList(list, ids))
            )}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}

function useGroupMenu() {
  const [menu, setMenu] = useState<{
    group: ListGroup;
    empty: boolean;
    x: number;
    y: number;
  } | null>(null);
  const { ungroup, deleteGroup } = useActions();
  const setRenamingGroup = useUi((s) => s.setRenamingGroup);

  const entries = (empty: boolean): MenuEntry[] => [
    { id: "rename", label: "Rename group", icon: "rename" },
    empty
      ? { id: "delete", label: "Delete group", icon: "delete", danger: true }
      : { id: "ungroup", label: "Ungroup lists", icon: "group" },
  ];

  return {
    open: (group: ListGroup, at: { x: number; y: number }, empty: boolean) =>
      setMenu({ group, empty, ...at }),
    element: (
      <ContextMenu
        at={menu}
        label={`Options for ${menu?.group.title ?? "group"}`}
        items={menu ? entries(menu.empty) : []}
        onClose={() => setMenu(null)}
        onAction={(id) => {
          if (!menu) return;
          if (id === "rename") setRenamingGroup(menu.group.id);
          if (id === "ungroup") ungroup(menu.group.id);
          if (id === "delete") deleteGroup(menu.group.id);
        }}
      />
    ),
  };
}

function NewGroup({ taken }: { taken: string[] }) {
  const { addGroup } = useActions();
  const setRenamingGroup = useUi((s) => s.setRenamingGroup);
  return (
    <IconButton
      icon="newGroup"
      label="New group"
      onPress={() => {
        const group = addGroup(uniqueTitle("Untitled group", taken));
        setRenamingGroup(group.id);
      }}
    />
  );
}
