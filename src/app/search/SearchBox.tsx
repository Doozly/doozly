import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { INBOX_ID } from "../../data/model.ts";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { paths, useSelection } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import { SEARCH_ID } from "../views.ts";
import styles from "./SearchBox.module.css";

/** The search field in the header. Typing opens the results, Escape goes back where you were. */
export function SearchBox() {
  const query = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const [location, navigate] = useLocation();
  const { listId } = useSelection();
  const searching = listId === SEARCH_ID;
  const cameFrom = useRef<string | null>(null);

  // Leaving the results some other way, like the sidebar, ends the search
  useEffect(() => {
    if (!searching) setSearch("");
  }, [searching, setSearch]);

  const close = () => {
    setSearch("");
    navigate(cameFrom.current ?? paths.list(INBOX_ID));
    cameFrom.current = null;
  };

  return (
    <search className={styles.box}>
      <Icon name="search" size={16} className={styles.icon} />
      <input
        type="search"
        className={styles.input}
        aria-label="Search"
        placeholder="Search"
        value={query}
        maxLength={255}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!searching) {
            cameFrom.current = location;
            navigate(paths.list(SEARCH_ID));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && searching) {
            e.preventDefault();
            close();
            e.currentTarget.blur();
          }
        }}
      />
      {searching && (
        <IconButton
          icon="close"
          label="Close search"
          className={styles.clear}
          onPress={close}
        />
      )}
    </search>
  );
}
