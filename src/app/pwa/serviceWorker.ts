import { createStore } from "zustand/vanilla";
import { isDesktop, loadTauri, onDesktopEvent } from "../../platform.ts";

interface UpdateState {
  /** A new version, installed and waiting for the user to reload */
  waiting: ServiceWorker | null;
  /** In the desktop app: the version that's downloaded and waits for a restart */
  desktop: string | null;
}

export const updates = createStore<UpdateState>()(() => ({
  waiting: null,
  desktop: null,
}));

const HOUR = 60 * 60 * 1000;

/** In the built web app only. The desktop app has no service worker. */
export function registerServiceWorker(
  sw: ServiceWorkerContainer | undefined = navigator.serviceWorker,
) {
  if (!import.meta.env.PROD || isDesktop()) return;
  if (!sw) return;
  sw.register("/sw.js").then(watchForUpdates, (err: unknown) => {
    console.warn("Service worker didn't register", err);
  });
}

export function watchForUpdates(reg: ServiceWorkerRegistration) {
  // With no controller yet this is the first install, nothing to update
  const offer = (worker: ServiceWorker | null) => {
    if (worker && navigator.serviceWorker.controller) {
      updates.setState({ waiting: worker });
    }
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });
  // A tab can stay open for days, so it looks for a new version now and then
  setInterval(() => void reg.update().catch(() => {}), HOUR);
}

/** Lets the waiting version take over, and reloads once it has */
export function applyUpdate() {
  const worker = updates.getState().waiting;
  if (!worker) return;
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => location.reload(),
    { once: true },
  );
  worker.postMessage({ type: "SKIP_WAITING" });
}

/** In the desktop app the Rust side checks and downloads, here we only hear that it's ready */
export function watchDesktopUpdates() {
  const ready = (version: string | null) =>
    updates.setState({ desktop: version });
  onDesktopEvent<string>("doozly:update", ready);
  // It may have been ready before this window was listening
  void loadTauri()
    .then(({ invoke }) => invoke<string | null>("update_ready"))
    .then(ready, () => {});
}

/** Installs the downloaded version and starts it */
export async function installDesktopUpdate() {
  const { invoke } = await loadTauri();
  await invoke("install_update");
}
