import { useEffect, useState } from "react";
import { Switch } from "react-aria-components";
import {
  NoWorkerError,
  PushBlockedError,
  type PushSupport,
  pushSubscribed,
  pushSupport,
  subscribePush,
  unsubscribePush,
} from "../../reminders/push.ts";
import data from "../account/DataSection.module.css";
import { useSessionState } from "../account/SessionContext.tsx";
import settings from "../SettingsPanel.module.css";
import { useRelay } from "./useRelay.ts";

interface PushSectionProps {
  url?: string;
  support?: PushSupport;
}

/** Reminders when Doozly is closed: push through the relay, one switch per device */
export function PushSection({
  url = import.meta.env.VITE_RELAY_URL,
  support = pushSupport(),
}: PushSectionProps) {
  const relay = useRelay(url);
  const signedIn = useSessionState((s) => s.account !== null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only asked when the switch will show. Without a relay there's no subscription anyway,
  // and in some WebKit builds getSubscription() never comes back and freezes the page.
  const canPush = Boolean(url) && signedIn && support === "ok";
  useEffect(() => {
    if (canPush) void pushSubscribed().then(setOn);
  }, [canPush]);

  if (!url) return null;

  const toggle = async (next: boolean) => {
    if (!relay) return;
    setBusy(true);
    setError(null);
    try {
      if (next) await subscribePush(relay);
      else await unsubscribePush(relay);
      setOn(next);
    } catch (err) {
      setError(
        err instanceof PushBlockedError
          ? "Notifications are blocked for Doozly. Allow them in your browser's settings for this site, then try again."
          : err instanceof NoWorkerError
            ? "This browser window can't receive notifications. Try a normal window rather than a private one, or reload Doozly."
            : "Couldn't reach the Doozly server. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={data.section} aria-labelledby="push-title">
      <h3 id="push-title" className={data.title}>
        Notifications
      </h3>
      {!signedIn ? (
        <p className={data.text}>
          Sign in to get reminders when Doozly is closed.
        </p>
      ) : support === "install" ? (
        <p className={data.text}>
          On iPhone and iPad, reminders need Doozly on your Home Screen. In
          Safari, tap Share, then Add to Home Screen. Open Doozly from there and
          turn this on.
        </p>
      ) : support === "unsupported" ? (
        <p className={data.text}>
          This browser can't show reminders while Doozly is closed. They still
          show while it's open.
        </p>
      ) : (
        <>
          <Switch
            className={settings.switch}
            isSelected={on === true}
            isDisabled={busy || on === null}
            onChange={(next) => void toggle(next)}
          >
            <span className={settings.switchLabel}>
              Remind me when Doozly is closed
            </span>
            <span className={settings.track} aria-hidden>
              <span className={settings.thumb} />
            </span>
          </Switch>
          <p className={data.text}>
            Just for this device. Turn it on wherever you want reminders.
          </p>
        </>
      )}
      {error && (
        <p className={data.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
