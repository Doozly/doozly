import { useEffect } from "react";
import type { Settings } from "../data/model.ts";
import { useAppState } from "../state/AppContext.tsx";
import { setting } from "../state/actions.ts";

// public/theme-init.js reads this key before first paint, keep the two in step
export const THEME_KEY = "doozly:theme";

// Same as --color-header, for the browser's own toolbar
const headerColour = { light: "#0a7570", dark: "#232326" };

export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const media = meta.getAttribute("media") ?? "";
    const scheme = media.includes("dark") ? "dark" : "light";
    meta.content = headerColour[theme === "system" ? scheme : theme];
  }

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Blocked storage only costs us the no-flash start, the setting itself is in IndexedDB
  }
}

/** Keeps <html data-theme> in step with the theme setting */
export function useThemeSync() {
  const theme = useAppState((s) => setting(s, "theme"));
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}
