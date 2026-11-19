import { createContext, type ReactNode, use } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Session, SessionState } from "../../sync/session.ts";

const SessionContext = createContext<Session | null>(null);

// Without a session (tests, no client IDs) everything reads as signed out
const nobody = createStore<SessionState>()(() => ({
  account: null,
  sync: null,
  elsewhere: false,
  signingIn: null,
}));

export function SessionProvider({
  value,
  children,
}: {
  value: Session | null;
  children: ReactNode;
}) {
  return <SessionContext value={value}>{children}</SessionContext>;
}

export const useSession = (): Session | null => use(SessionContext);

export function useSessionState<T>(selector: (s: SessionState) => T): T {
  return useStore(use(SessionContext)?.state ?? nobody, selector);
}
