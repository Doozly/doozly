import { Button } from "react-aria-components";
import { useStore } from "zustand";
import { isDesktop } from "../../platform.ts";
import { installed, isAppleMobile } from "../../reminders/push.ts";
import data from "../account/DataSection.module.css";
import { install, promptInstall } from "./install.ts";

/** Settings → Install, only where there's something to say */
export function InstallSection() {
  const offer = useStore(install, (s) => s.offer);
  const apple = isAppleMobile() && !installed();
  // The desktop app is installed already
  if ((!offer && !apple) || isDesktop()) return null;

  return (
    <section className={data.section} aria-labelledby="install-title">
      <h3 id="install-title" className={data.title}>
        Install
      </h3>
      {offer ? (
        <>
          <p className={data.text}>
            Doozly opens in its own window and works offline.
          </p>
          <div className={data.buttons}>
            <Button
              className={data.button}
              onPress={() => void promptInstall()}
            >
              Install Doozly
            </Button>
          </div>
        </>
      ) : (
        <p className={data.text}>
          In Safari, tap Share, then Add to Home Screen. Doozly then opens like
          an app and works offline.
        </p>
      )}
    </section>
  );
}
