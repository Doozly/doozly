import { useState } from "react";
import { useLocation } from "wouter";
import { isDesktop } from "../../platform.ts";
import { useAppState } from "../../state/AppContext.tsx";
import { useSessionState } from "../account/SessionContext.tsx";

const WELCOMED_KEY = "doozly:welcomed";

export function welcomedBefore() {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The landing page is for a first visit to "/" only. Deep links, people who already have
 * tasks or are signed in go straight in. Desktop too, its sign-in isn't there yet.
 */
export function useWelcome() {
  const [location] = useLocation();
  const [welcomed, setWelcomed] = useState(welcomedBefore);
  const hasTasks = useAppState((s) =>
    Object.values(s.tasks).some((t) => t.deletedAt === null),
  );
  const signedIn = useSessionState((s) => s.account !== null);

  const show =
    location === "/" && !welcomed && !hasTasks && !signedIn && !isDesktop();

  const done = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      // Private mode can refuse, then it's just shown again next time
    }
    setWelcomed(true);
  };
  return { show, done };
}
