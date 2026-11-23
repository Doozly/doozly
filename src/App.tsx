import { Suspense } from "react";
import { UpdateNotice } from "./app/pwa/UpdateNotice.tsx";
import { Reminders } from "./app/reminders/Reminders.tsx";
import { Shell } from "./app/Shell.tsx";
import { useThemeSync } from "./app/theme.ts";
import { useWelcome } from "./app/welcome/useWelcome.ts";
import { preloadable } from "./ui/preloadable.tsx";

// Only a first visit sees it. main.tsx starts fetching it early for them, nobody else downloads it.
export const Landing = preloadable(() =>
  import("./app/welcome/Landing.tsx").then((m) => m.Landing),
);

export function App() {
  useThemeSync();
  const welcome = useWelcome();
  if (welcome.show) {
    return (
      <>
        <Suspense>
          <Landing onDone={welcome.done} />
        </Suspense>
        <UpdateNotice />
      </>
    );
  }
  return (
    <>
      <Shell />
      <Reminders />
      <UpdateNotice />
    </>
  );
}
