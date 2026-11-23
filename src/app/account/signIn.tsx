import { useState } from "react";
import { SignInError } from "../../sync/provider.ts";
import type { Account, ProviderKind } from "../../sync/session.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { useSession, useSessionState } from "./SessionContext.tsx";
import { storageNames } from "./syncMessage.ts";

export type ConfirmMerge = (account: Account) => Promise<boolean>;

function failureText(err: unknown): string | null {
  if (err instanceof SignInError) {
    if (err.reason === "cancelled") return null;
    if (err.reason === "noDriveAccess") return err.message;
  }
  return "Couldn't sign in. Check your connection and try again.";
}

/** Asks before this device's tasks go into another account. Render `dialog` somewhere. */
export function useConfirmMerge() {
  const [merge, setMerge] = useState<{
    account: Account;
    answer: (ok: boolean) => void;
  } | null>(null);

  const confirmMerge: ConfirmMerge = (next) =>
    new Promise<boolean>((resolve) => {
      setMerge({
        account: next,
        answer: (ok) => {
          setMerge(null);
          resolve(ok);
        },
      });
    });

  const dialog = (
    <ConfirmDialog
      isOpen={merge !== null}
      title="Add this device's tasks?"
      message={`This device has tasks from another account. Add them to ${merge?.account.email ?? "this account"} and sync them to its ${merge ? storageNames[merge.account.provider] : "storage"}?`}
      confirmLabel="Add them"
      tone="accent"
      onConfirm={() => merge?.answer(true)}
      onCancel={() => merge?.answer(false)}
    />
  );
  return { confirmMerge, dialog };
}

export function useSignIn(
  confirmMerge: ConfirmMerge,
  onSignedIn?: (account: Account) => void,
) {
  const session = useSession();
  const signingIn = useSessionState((s) => s.signingIn);
  const [error, setError] = useState<string | null>(null);
  const signIn = (kind: ProviderKind) => {
    setError(null);
    session?.signIn(kind, confirmMerge).then(
      (account) => account && onSignedIn?.(account),
      (err: unknown) => setError(failureText(err)),
    );
  };
  return { signIn, signingIn, error };
}
