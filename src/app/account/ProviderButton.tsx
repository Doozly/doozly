import { Button } from "react-aria-components";
import type { ProviderKind } from "../../sync/session.ts";
import styles from "./ProviderButton.module.css";
import { providerNames } from "./syncMessage.ts";

// Both logos as the providers ship them, see their sign-in branding guidelines.
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
