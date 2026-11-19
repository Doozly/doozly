import { Shell } from "./app/Shell.tsx";
import { useThemeSync } from "./app/theme.ts";

export function App() {
  useThemeSync();
  return <Shell />;
}
