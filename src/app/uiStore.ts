import { create } from "zustand";

// Per-device layout state. It doesn't sync, also it lives here and not in the data store.
const COLLAPSED_KEY = "doozly:sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface UiState {
  /** Wide screens: the user hid the sidebar */
  sidebarCollapsed: boolean;
  /** Narrow screens: the drawer is showing */
  drawerOpen: boolean;
  /** List ids whose Completed section is folded away */
  completedFolded: Record<string, boolean>;
  /** The list whose title is being edited in the list header */
  renamingListId: string | null;
  /** Group ids folded shut in the sidebar */
  groupsFolded: Record<string, boolean>;
  renamingGroupId: string | null;
  /** What's typed in the search box. It's not in the URL, a reload starts a fresh search. */
  search: string;
  /** The keyboard shortcuts help, and whether it was ever opened (so it loads only then) */
  shortcutsOpen: boolean;
  shortcutsUsed: boolean;
  /** A task was opened from the keyboard, so the details pane should take the focus */
  focusDetails: boolean;
  toggleSidebar(): void;
  setDrawerOpen(open: boolean): void;
  toggleCompleted(listId: string): void;
  setRenaming(listId: string | null): void;
  toggleGroup(groupId: string): void;
  setRenamingGroup(groupId: string | null): void;
  setSearch(search: string): void;
  setShortcutsOpen(open: boolean): void;
  setFocusDetails(focus: boolean): void;
}

export const useUi = create<UiState>()((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  drawerOpen: false,
  completedFolded: {},
  renamingListId: null,
  groupsFolded: {},
  renamingGroupId: null,
  search: "",
  shortcutsOpen: false,
  shortcutsUsed: false,
  focusDetails: false,
  toggleSidebar() {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    try {
      localStorage.setItem(COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // Private mode or blocked storage, then it's just not remembered
    }
  },
  setDrawerOpen(drawerOpen) {
    set({ drawerOpen });
  },
  toggleCompleted(listId) {
    const folded = get().completedFolded;
    set({ completedFolded: { ...folded, [listId]: !folded[listId] } });
  },
  setRenaming(renamingListId) {
    set({ renamingListId });
  },
  toggleGroup(groupId) {
    const folded = get().groupsFolded;
    set({ groupsFolded: { ...folded, [groupId]: !folded[groupId] } });
  },
  setRenamingGroup(renamingGroupId) {
    set({ renamingGroupId });
  },
  setSearch(search) {
    set({ search });
  },
  setFocusDetails(focusDetails) {
    set({ focusDetails });
  },
  setShortcutsOpen(shortcutsOpen) {
    set(
      shortcutsOpen
        ? { shortcutsOpen, shortcutsUsed: true }
        : { shortcutsOpen },
    );
  },
}));
