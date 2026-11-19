import { Button } from "react-aria-components";
import type { GroupBy, List, SortBy } from "../../data/model.ts";
import { useActions } from "../../state/AppContext.tsx";
import type { MenuEntry } from "../../ui/ContextMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { MenuButton } from "../../ui/MenuButton.tsx";
import { defaultDirection } from "../tasks/arrange.ts";
import styles from "./SortAndGroup.module.css";

const fields: MenuEntry[] = [
  { id: "importance", label: "Importance", icon: "important" },
  { id: "dueDate", label: "Due date", icon: "dueDate" },
  { id: "myDay", label: "Added to My Day", icon: "myDay" },
  { id: "title", label: "Alphabetically", icon: "alphabetical" },
  { id: "createdAt", label: "Creation date", icon: "createdAt" },
];

const sortedBy: Record<SortBy, string> = {
  importance: "Sorted by importance",
  dueDate: "Sorted by due date",
  myDay: "Sorted by added to My Day",
  title: "Sorted alphabetically",
  createdAt: "Sorted by creation date",
};

const groupedBy: Record<GroupBy, string> = {
  importance: "Grouped by importance",
  dueDate: "Grouped by due date",
  myDay: "Grouped by My Day",
  title: "Grouped alphabetically",
  createdAt: "Grouped by creation date",
};

/** The Sort and Group buttons for the list toolbar */
export function SortAndGroupButtons({ list }: { list: List }) {
  const { updateList } = useActions();
  return (
    <>
      <MenuButton
        icon="sort"
        label="Sort"
        title="Sort by"
        items={fields}
        onAction={(id) => {
          const by = id as SortBy;
          updateList(list.id, {
            sort: { by, direction: defaultDirection[by] },
          });
        }}
      />
      <MenuButton
        icon="groupBy"
        label="Group"
        title="Group by"
        items={fields}
        onAction={(id) => updateList(list.id, { group: id as GroupBy })}
      />
    </>
  );
}

/** What the list is sorted and grouped by, under the title, with a way to flip or drop it */
export function SortAndGroupChips({ list }: { list: List }) {
  const { updateList } = useActions();
  const { sort } = list;
  const group = list.group ?? null;
  if (!sort && !group) return null;

  return (
    <div className={styles.chips}>
      {sort && (
        <span className={styles.chip}>
          {sortedBy[sort.by]}
          <Button
            className={styles.chipButton}
            aria-label="Reverse sort order"
            onPress={() =>
              updateList(list.id, {
                sort: {
                  ...sort,
                  direction: sort.direction === "asc" ? "desc" : "asc",
                },
              })
            }
          >
            <Icon
              name={sort.direction === "asc" ? "ascending" : "descending"}
              size={16}
            />
          </Button>
          <Button
            className={styles.chipButton}
            aria-label="Remove sort order option"
            onPress={() => updateList(list.id, { sort: null })}
          >
            <Icon name="close" size={16} />
          </Button>
        </span>
      )}
      {group && (
        <span className={styles.chip}>
          {groupedBy[group]}
          <Button
            className={styles.chipButton}
            aria-label="Remove group by option"
            onPress={() => updateList(list.id, { group: null })}
          >
            <Icon name="close" size={16} />
          </Button>
        </span>
      )}
    </div>
  );
}
