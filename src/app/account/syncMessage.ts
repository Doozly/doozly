import type { ProviderKind, SessionState } from "../../sync/session.ts";
import type { IconName } from "../../ui/Icon.tsx";

export const providerNames: Record<ProviderKind, string> = {
  google: "Google",
  microsoft: "Microsoft",
  dropbox: "Dropbox",
};

export const storageNames: Record<ProviderKind, string> = {
  google: "Google Drive",
  microsoft: "OneDrive",
  dropbox: "Dropbox",
};

/** "OneDrive, Google Drive or Dropbox" */
export const storageList = (kinds: readonly ProviderKind[]) =>
  new Intl.ListFormat("en-GB", { type: "disjunction" }).format(
    kinds.map((k) => storageNames[k]),
  );

export interface SyncMessage {
  icon: IconName;
  text: string;
  /** Something's wrong that the user should see on the account button too */
  attention: boolean;
  action?: "signIn" | "reload";
  /** Set while files move, for a progress bar */
  done?: number;
  total?: number;
}

const waiting = (n: number) =>
  n === 1 ? "1 change waiting to sync." : `${n} changes waiting to sync.`;

/** What to tell the user about sync, null when signed out */
export function syncMessage(s: SessionState): SyncMessage | null {
  if (!s.account) return null;
  const where = storageNames[s.account.provider];
  if (s.elsewhere) {
    return {
      icon: "synced",
      text: "Syncing in another Doozly tab.",
      attention: false,
    };
  }
  const sync = s.sync;
  switch (sync?.phase) {
    case undefined:
    case "off":
      return { icon: "sync", text: "Syncing…", attention: false };
    case "syncing": {
      if (!sync.direction || sync.total === 0) {
        return { icon: "sync", text: "Syncing…", attention: false };
      }
      const way =
        sync.direction === "down" ? "Downloading from" : "Uploading to";
      return {
        icon: "sync",
        text: `${way} ${where}, ${sync.done} of ${sync.total}…`,
        attention: false,
        done: sync.done,
        total: sync.total,
      };
    }
    case "idle":
      return {
        icon: "synced",
        text: sync.pending
          ? waiting(sync.pending)
          : `Up to date with ${where}.`,
        attention: false,
      };
    case "offline":
      return {
        icon: "offline",
        text: `Can't reach ${where} right now. Your changes are saved on this device and sync when it's back.${sync.pending ? ` ${waiting(sync.pending)}` : ""}`,
        attention: false,
      };
    case "signedOut":
      return {
        icon: "warning",
        text: "Sign in again to keep syncing.",
        attention: true,
        action: "signIn",
      };
    case "newerApp":
      return {
        icon: "warning",
        text: "A newer version of Doozly changed your data. Reload to update and keep syncing.",
        attention: true,
        action: "reload",
      };
    case "noStorage":
      return {
        icon: "warning",
        text: `This account has no ${where}, so Doozly can't sync with it. Your tasks on this device are safe.`,
        attention: true,
      };
    case "error":
      return {
        icon: "warning",
        text: `Sync stopped because a file in your ${where} couldn't be read. Your tasks on this device are safe.`,
        attention: true,
      };
  }
}
