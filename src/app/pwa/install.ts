import { createStore } from "zustand/vanilla";

/** Chromium's install offer. Not in the DOM types, as it's not a standard. */
export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const install = createStore<{ offer: InstallPrompt | null }>()(() => ({
  offer: null,
}));

/** Call early: the browser can make its offer before the app has rendered */
export function listenForInstall(target: Window = window) {
  target.addEventListener("beforeinstallprompt", (e) => {
    install.setState({ offer: e as InstallPrompt });
  });
  target.addEventListener("appinstalled", () => {
    install.setState({ offer: null });
  });
}

/** Shows the browser's install dialog. An offer can only be used once. */
export async function promptInstall(): Promise<boolean> {
  const { offer } = install.getState();
  if (!offer) return false;
  install.setState({ offer: null });
  await offer.prompt();
  return (await offer.userChoice).outcome === "accepted";
}
