import { askToNotify } from "./notify.ts";
import type { Relay } from "./relay.ts";

/** "install": an iPhone or iPad in Safari, push only works once Doozly is on the Home Screen */
export type PushSupport = "ok" | "install" | "unsupported";

interface Env {
  navigator: Navigator;
  window: Window;
}

const browser = (): Env => ({ navigator, window });

function isAppleMobile({ navigator: n }: Env): boolean {
  // iPadOS says it's a Mac, the touch points give it away
  return (
    /iPhone|iPad|iPod/.test(n.userAgent) ||
    (n.platform === "MacIntel" && n.maxTouchPoints > 1)
  );
}

function installed({ navigator: n, window: w }: Env): boolean {
  return (
    w.matchMedia?.("(display-mode: standalone)").matches ||
    (n as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(env: Env = browser()): PushSupport {
  const ok =
    "serviceWorker" in env.navigator &&
    "PushManager" in env.window &&
    "Notification" in env.window;
  if (ok) return "ok";
  return isAppleMobile(env) && !installed(env) ? "install" : "unsupported";
}

/** In the built web app only. The desktop app does its own notifications. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || "__TAURI_INTERNALS__" in window) return;
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
    console.warn("Service worker didn't register", err);
  });
}

export class PushBlockedError extends Error {
  constructor() {
    super("Notifications are blocked for Doozly");
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null &&
  a.byteLength === b.length &&
  new Uint8Array(a).every((x, i) => x === b[i]);

/** Subscribes this browser and tells the relay. Call it from a click, for the permission prompt. */
export async function subscribePush(relay: Relay): Promise<void> {
  if ((await askToNotify()) !== "granted") throw new PushBlockedError();
  const registration = await navigator.serviceWorker.ready;
  const key = keyBytes(await relay.pushKey());
  let subscription = await registration.pushManager.getSubscription();
  // Made for another relay key, it can't take ours
  if (
    subscription &&
    !sameBytes(subscription.options.applicationServerKey, key)
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await relay.subscribe(subscription.toJSON());
}

/** Stops pushes to this browser. The relay is told first, while the session still works. */
export async function unsubscribePush(relay: Relay | null): Promise<void> {
  // No relay, no subscription: it's only ever made through one
  if (!relay || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await relay.unsubscribe(subscription.endpoint).catch(() => {});
  await subscription.unsubscribe();
}

export async function pushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) != null;
}
