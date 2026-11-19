import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useShallow } from "zustand/react/shallow";
import {
  INBOX_ID,
  type List,
  type LocalDate,
  type Task,
} from "../data/model.ts";
import { useActions, useAppState } from "../state/AppContext.tsx";
import { uniqueTitle } from "../state/naming.ts";
import { byPosition } from "../state/position.ts";
import { isMenuKey, menuPointFor } from "../ui/ContextMenu.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useToday } from "../ui/useToday.ts";
import { useListMenu } from "./lists/useListMenu.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Sidebar.module.css";
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
  const listMenu = useListMenu({ onDone: onNavigate });
  const inbox = lists.find((l) => l.id === INBOX_ID);
  const own = lists.filter((l) => l.id !== INBOX_ID);

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
            <ListItem
              key={id}
              view={smartView(id, now)}
              count={counts[id]}
              onNavigate={onNavigate}
            />
          ))}
          {inbox && (
            <ListItem
              view={listView(inbox)}
              count={counts[inbox.id]}
              onNavigate={onNavigate}
              onMenu={listMenu.open}
            />
          )}
        </ul>
        {own.length > 0 && (
          <ul className={`${styles.section} ${styles.own}`}>
            {own.map((list) => (
              <ListItem
                key={list.id}
                view={listView(list)}
                count={counts[list.id]}
                onNavigate={onNavigate}
                onMenu={listMenu.open}
              />
            ))}
          </ul>
        )}
      </div>
      <NewList
        taken={lists.map((l) => l.title)}
        onCreated={() => onNavigate?.()}
      />
      {listMenu.element}
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
}

function ListItem({ view, count, onNavigate, onMenu }: ListItemProps) {
  const { listId } = useSelection();
  const { list } = view;
  return (
    <li>
      <Link
        href={paths.list(view.id)}
        className={styles.item}
        aria-current={view.id === listId ? "page" : undefined}
        data-accent={view.accent}
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
