import { loadTauri } from "../../platform.ts";
import {
  AuthError,
  ProviderError,
  SignInError,
  type SignInFailure,
} from "../provider.ts";
import type { Account, AccountAuth, ProviderKind } from "../session.ts";

type Profile = Omit<Account, "provider">;
type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** What src-tauri/src/auth.rs rejects with */
interface RustError {
  kind: "cancelled" | "noDriveAccess" | "signedOut" | "network" | "failed";
  message?: string;
}

const storage: Record<ProviderKind, string> = {
  google: "Google Drive",
  microsoft: "OneDrive",
  dropbox: "Dropbox",
};

const tauriInvoke: Invoke = async (cmd, args) =>
  (await loadTauri()).invoke(cmd, args);

const rustError = (err: unknown): RustError =>
  typeof err === "object" && err !== null && "kind" in err
    ? (err as RustError)
    : { kind: "failed", message: String(err) };

/**
 * Sign-in for the desktop app. The providers all refuse an embedded webview, so the Rust
 * side signs in in the system browser and keeps the refresh token in the OS keychain.
 */
export function createDesktopAuth(
  provider: ProviderKind,
  invoke: Invoke = tauriInvoke,
): AccountAuth {
  return {
    async signIn() {
      try {
        return await invoke<Profile>("sign_in", { provider });
      } catch (err) {
        const e = rustError(err);
        const reason: SignInFailure =
          e.kind === "cancelled" || e.kind === "noDriveAccess"
            ? e.kind
            : "failed";
        throw new SignInError(
          reason,
          reason === "noDriveAccess"
            ? `Doozly needs access to its own folder in ${storage[provider]} to sync`
            : (e.message ?? e.kind),
        );
      }
    },

    async token() {
      try {
        return await invoke<string>("access_token", { provider });
      } catch (err) {
        const e = rustError(err);
        if (e.kind === "signedOut") throw new AuthError("Signed out");
        throw new ProviderError(e.message ?? e.kind, e.kind === "network");
      }
    },

    restore: () => invoke<Profile | null>("restored_account", { provider }),

    expire() {
      void invoke("drop_access_token", { provider }).catch(() => {});
    },

    async signOut() {
      await invoke("sign_out", { provider });
    },
  };
}
