import { createContext, type ReactNode, use } from "react";
import { useStore } from "zustand";
import type { Actions } from "./actions.ts";
import type { App, AppState } from "./store.ts";

interface AppContextValue {
  app: App;
  actions: Actions;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}) {
  return <AppContext value={value}>{children}</AppContext>;
}

function useAppContext() {
  const value = use(AppContext);
  if (!value) throw new Error("useAppState needs an <AppProvider> above it");
  return value;
}

/** A selector that builds a new array or object each time needs useShallow, else React renders forever */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(useAppContext().app.store, selector);
}

export function useActions(): Actions {
  return useAppContext().actions;
}
