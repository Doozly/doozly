import { useMemo } from "react";
import { createRelay, type Relay } from "../../reminders/relay.ts";
import { useSession } from "../account/SessionContext.tsx";

/** The relay for the signed-in account's push settings, null without a relay or session */
export function useRelay(
  url: string | undefined = import.meta.env.VITE_RELAY_URL,
): Relay | null {
  const session = useSession();
  return useMemo(
    () =>
      url && session
        ? createRelay({ url, renewSession: () => session.renewRelay() })
        : null,
    [url, session],
  );
}
