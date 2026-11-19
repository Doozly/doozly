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
  toggleSidebar(): void;
  setDrawerOpen(open: boolean): void;
  toggleCompleted(listId: string): void;
  setRenaming(listId: string | null): void;
}

export const useUi = create<UiState>()((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  drawerOpen: false,
  completedFolded: {},
  renamingListId: null,
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
}));
