import { UpdateNotice } from "./app/pwa/UpdateNotice.tsx";
import { Reminders } from "./app/reminders/Reminders.tsx";
import { Shell } from "./app/Shell.tsx";
import { useThemeSync } from "./app/theme.ts";

export function App() {
  useThemeSync();
  return (
    <>
      <Shell />
      <Reminders />
      <UpdateNotice />
    </>
  );
}
