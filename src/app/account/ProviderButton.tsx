import { Button } from "react-aria-components";
import type { ProviderKind } from "../../sync/session.ts";
import styles from "./ProviderButton.module.css";
import { providerNames } from "./syncMessage.ts";

// The logos as the providers ship them, see their branding guidelines.
// Google's G is rendered from their asset bundle, its SVG needs inline styles the CSP doesn't allow.
function ProviderLogo({ kind }: { kind: ProviderKind }) {
  if (kind === "google") {
    return (
      <img
        className={styles.logo}
        src="/google-g.png"
        width={20}
        height={20}
        alt=""
      />
    );
  }
  if (kind === "dropbox") {
    return (
      <svg
        className={styles.logo}
        width={20}
        height={20}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          fill="#0061ff"
          d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"
        />
      </svg>
    );
  }
  return (
    <svg
      className={styles.logo}
      width={21}
      height={21}
      viewBox="0 0 21 21"
      aria-hidden
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function ProviderButton({
  kind,
  signingIn,
  isDisabled,
  onPress,
}: {
  kind: ProviderKind;
  signingIn: boolean;
  isDisabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      className={`${styles.button} ${styles[kind]}`}
      isDisabled={isDisabled}
      onPress={onPress}
    >
      <ProviderLogo kind={kind} />
      <span>
        {signingIn ? "Signing in…" : `Sign in with ${providerNames[kind]}`}
      </span>
    </Button>
  );
}
