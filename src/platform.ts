/** Inside the desktop app: Tauri's webview sets this before any of our code runs */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** For ⌘ instead of Ctrl */
export function isMac(): boolean {
  return /Mac/.test(navigator.platform || navigator.userAgent);
}

/** Tauri's API, only ever loaded inside the desktop app */
export async function loadTauri() {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return { invoke, listen };
}

/** Calls `handler` for each Rust-side event, from inside an effect. Gives the cleanup. Does nothing on the web. */
export function onDesktopEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  if (!isDesktop()) return () => {};
  let gone = false;
  let stop: (() => void) | undefined;
  void loadTauri()
    .then(({ listen }) => listen<T>(event, (e) => handler(e.payload)))
    .then((unlisten) => {
      if (gone) unlisten();
      else stop = unlisten;
    });
  return () => {
    gone = true;
    stop?.();
  };
}
