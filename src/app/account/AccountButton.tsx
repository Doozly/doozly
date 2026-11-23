import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Popover,
} from "react-aria-components";
import { useShallow } from "zustand/shallow";
import { unsubscribePush } from "../../reminders/push.ts";
import type { Account } from "../../sync/session.ts";
import { Icon } from "../../ui/Icon.tsx";
import { useRelay } from "../reminders/useRelay.ts";
import styles from "./AccountButton.module.css";
import { ProviderButton } from "./ProviderButton.tsx";
import { useSession, useSessionState } from "./SessionContext.tsx";
import { type ConfirmMerge, useConfirmMerge, useSignIn } from "./signIn.tsx";
import { storageList, storageNames, syncMessage } from "./syncMessage.ts";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

/** True once `on` has held for `ms`, so a quick sync doesn't blink */
function useAfter(on: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [on, ms]);
  return on && late;
}

/** The account in the header: sign in, see how sync is doing, sign out */
export function AccountButton() {
  const session = useSession();
  const account = useSessionState((s) => s.account);
  const attention = useSessionState((s) => syncMessage(s)?.attention ?? false);
  const syncing = useAfter(
    useSessionState((s) => s.sync?.phase === "syncing"),
    500,
  );
  const { confirmMerge, dialog } = useConfirmMerge();

  if (!session || session.providers.length === 0) return null;

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
              ? `Account and sync, signed in as ${account.name}${attention ? ", needs attention" : syncing ? ", syncing" : ""}`
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
          {syncing && <span className={styles.ring} aria-hidden />}
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
      {dialog}
    </>
  );
}

function SignedOut({ confirmMerge }: { confirmMerge: ConfirmMerge }) {
  const session = useSession();
  const { signIn, signingIn, error } = useSignIn(confirmMerge);
  return (
    <div className={styles.body}>
      <Heading slot="title" className={styles.title}>
        Sync your tasks
      </Heading>
      <p className={styles.text}>
        Sign in to back up your lists and see them on all your devices. They're
        kept in your own {storageList(session?.providers ?? [])}, in a folder
        only Doozly uses.
      </p>
      {session?.providers.map((kind) => (
        <ProviderButton
          key={kind}
          kind={kind}
          signingIn={signingIn === kind}
          isDisabled={signingIn !== null}
          onPress={() => signIn(kind)}
        />
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
  confirmMerge: ConfirmMerge;
}) {
  const session = useSession();
  const relay = useRelay();
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
      {message?.total ? (
        // By hand: React Aria's ProgressBar would land in the first load's shared chunk
        <div
          role="progressbar"
          aria-label="Sync progress"
          aria-valuemin={0}
          aria-valuemax={message.total}
          aria-valuenow={message.done}
          className={styles.progress}
        >
          <span
            className={styles.progressFill}
            style={{
              transform: `scaleX(${(message.done ?? 0) / message.total})`,
            }}
          />
        </div>
      ) : null}
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
          onPress={async () => {
            // This device stops getting pushes, while the relay still knows who we are
            await unsubscribePush(relay).catch(() => {});
            await session?.signOut();
          }}
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
