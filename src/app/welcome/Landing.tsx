import { useEffect } from "react";
import { Button } from "react-aria-components";
import type { ProviderKind } from "../../sync/session.ts";
import { Logo } from "../../ui/Logo.tsx";
import { ProviderButton } from "../account/ProviderButton.tsx";
import { useSession } from "../account/SessionContext.tsx";
import { useConfirmMerge, useSignIn } from "../account/signIn.tsx";
import { storageNames } from "../account/syncMessage.ts";
import styles from "./Landing.module.css";

// Microsoft first, most people come here from To Do
const order: ProviderKind[] = ["microsoft", "google"];

export function Landing({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const { confirmMerge, dialog } = useConfirmMerge();
  const { signIn, signingIn, error } = useSignIn(confirmMerge, onDone);
  const providers = order.filter((k) => session?.providers.includes(k));

  useEffect(() => {
    document.title = "Doozly - simple to-do lists, kept on your own drive";
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Logo height={40} className={styles.logo} />
        <h1 className={styles.title}>Your tasks, kept simple.</h1>
        <p className={styles.lead}>
          Lists, My Day, steps, due dates and reminders. Everything is saved on
          this device and works offline.
        </p>
        <p className={styles.lead}>
          Coming from Microsoft To Do? It's the same layout and the same
          shortcuts.
        </p>

        <Button className={styles.start} onPress={onDone}>
          Get started
        </Button>
        <p className={styles.hint}>No account needed.</p>

        {providers.length > 0 && (
          <section className={styles.providers} aria-labelledby="sync-title">
            <h2 id="sync-title" className={styles.divider}>
              <span>Or sync across your devices</span>
            </h2>
            {providers.map((kind) => (
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
            <p className={styles.hint}>
              Your tasks go to your own{" "}
              {providers.map((k) => storageNames[k]).join(" or ")}, in a folder
              only Doozly uses. There's no Doozly server holding them.
            </p>
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <a href="https://github.com/Doozly/doozly">Free and open source</a>
        <span aria-hidden>·</span>
        <span>Not affiliated with Microsoft</span>
      </footer>
      {dialog}
    </main>
  );
}
