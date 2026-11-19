import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Popover,
} from "react-aria-components";
import { useShallow } from "zustand/shallow";
import { SignInError } from "../../sync/provider.ts";
import type { Account, ProviderKind } from "../../sync/session.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./AccountButton.module.css";
import { useSession, useSessionState } from "./SessionContext.tsx";
import { providerNames, storageNames, syncMessage } from "./syncMessage.ts";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

function failureText(err: unknown): string | null {
  if (err instanceof SignInError) {
    if (err.reason === "cancelled") return null;
    if (err.reason === "noDriveAccess") return err.message;
  }
  return "Couldn't sign in. Check your connection and try again.";
}

/** The account in the header: sign in, see how sync is doing, sign out */
export function AccountButton() {
  const session = useSession();
  const account = useSessionState((s) => s.account);
  const attention = useSessionState((s) => syncMessage(s)?.attention ?? false);
  const [merge, setMerge] = useState<{
    account: Account;
    answer: (ok: boolean) => void;
  } | null>(null);

  if (!session || session.providers.length === 0) return null;

  const confirmMerge = (next: Account) =>
    new Promise<boolean>((resolve) => {
      setMerge({
        account: next,
        answer: (ok) => {
          setMerge(null);
          resolve(ok);
        },
      });
    });

  return (
    <>
      <DialogTrigger
        onOpenChange={(open) => {
          if (open) session.prepare();
        }}
      >
        <Button
          className={styles.trigger}
          aria-label={
            account
              ? `Account and sync, signed in as ${account.name}${attention ? ", needs attention" : ""}`
              : "Sign in to sync"
          }
        >
          {account ? (
            <span className={styles.avatar} aria-hidden>
              {initials(account.name)}
            </span>
          ) : (
            <Icon name="account" />
          )}
          {attention && <span className={styles.badge} aria-hidden />}
        </Button>
        <Popover placement="bottom end" className={styles.popover}>
          <Dialog aria-label="Account and sync" className={styles.card}>
            {account ? (
              <SignedIn account={account} confirmMerge={confirmMerge} />
            ) : (
              <SignedOut confirmMerge={confirmMerge} />
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ConfirmDialog
        isOpen={merge !== null}
        title="Add this device's tasks?"
        message={`This device has tasks from another account. Add them to ${merge?.account.email ?? "this account"} and sync them to its ${merge ? storageNames[merge.account.provider] : "storage"}?`}
        confirmLabel="Add them"
        tone="accent"
        onConfirm={() => merge?.answer(true)}
        onCancel={() => merge?.answer(false)}
      />
    </>
  );
}

type Confirm = (account: Account) => Promise<boolean>;

function useSignIn(confirmMerge: Confirm) {
  const session = useSession();
  const signingIn = useSessionState((s) => s.signingIn);
  const [error, setError] = useState<string | null>(null);
  const signIn = (kind: ProviderKind) => {
    setError(null);
    session?.signIn(kind, confirmMerge).catch((err: unknown) => {
      setError(failureText(err));
    });
  };
  return { signIn, signingIn, error };
}

function SignedOut({ confirmMerge }: { confirmMerge: Confirm }) {
  const session = useSession();
  const { signIn, signingIn, error } = useSignIn(confirmMerge);
  return (
    <div className={styles.body}>
      <Heading slot="title" className={styles.title}>
        Sync your tasks
      </Heading>
      <p className={styles.text}>
        Sign in to back up your lists and see them on all your devices. They're
        kept in your own Google Drive or OneDrive, in a folder only Doozly uses.
      </p>
      {session?.providers.map((kind) => (
        <Button
          key={kind}
          className={styles.primary}
          isDisabled={signingIn !== null}
          onPress={() => signIn(kind)}
        >
          {signingIn === kind
            ? "Signing in…"
            : `Sign in with ${providerNames[kind]}`}
        </Button>
      ))}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SignedIn({
  account,
  confirmMerge,
}: {
  account: Account;
  confirmMerge: Confirm;
}) {
  const session = useSession();
  const message = useSessionState(useShallow(syncMessage));
  const busy = useSessionState(
    (s) => s.elsewhere || s.sync?.phase === "syncing",
  );
  const { signIn, signingIn, error } = useSignIn(confirmMerge);

  return (
    <div className={styles.body}>
      <div className={styles.who}>
        <span className={`${styles.avatar} ${styles.large}`} aria-hidden>
          {initials(account.name)}
        </span>
        <div className={styles.names}>
          <Heading slot="title" className={styles.name}>
            {account.name}
          </Heading>
          <span className={styles.email}>{account.email}</span>
          <span className={styles.where}>{storageNames[account.provider]}</span>
        </div>
      </div>

      {message && (
        <p className={styles.status} role="status">
          <Icon name={message.icon} size={16} className={styles.statusIcon} />
          <span>{message.text}</span>
        </p>
      )}
      {message?.action === "signIn" && (
        <Button
          className={styles.primary}
          isDisabled={signingIn !== null}
          onPress={() => signIn(account.provider)}
        >
          {signingIn ? "Signing in…" : "Sign in again"}
        </Button>
      )}
      {message?.action === "reload" && (
        <Button className={styles.primary} onPress={() => location.reload()}>
          Reload
        </Button>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button
          className={styles.secondary}
          isDisabled={busy || message?.action !== undefined}
          onPress={() => void session?.syncNow()}
        >
          <Icon name="sync" size={16} />
          Sync now
        </Button>
        <Button
          className={styles.secondary}
          onPress={() => void session?.signOut()}
        >
          <Icon name="signOut" size={16} />
          Sign out
        </Button>
      </div>
      <p className={styles.hint}>
        Signing out keeps your tasks on this device.
      </p>
    </div>
  );
}
