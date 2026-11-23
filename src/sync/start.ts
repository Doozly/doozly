import { isDesktop } from "../platform.ts";
import type { App } from "../state/store.ts";
import { createDesktopAuth } from "./desktop/auth.ts";
import { createGoogleAuth } from "./google/auth.ts";
import { createMicrosoftAuth } from "./microsoft/auth.ts";
import {
  type AccountAuth,
  createSession,
  type ProviderKind,
} from "./session.ts";

/** The signed-in session for this tab, already starting its sync */
export function startSession(app: App) {
  // A sign-in is only offered when its client ID is set
  const auths: Partial<Record<ProviderKind, AccountAuth>> = {};
  const {
    VITE_GOOGLE_CLIENT_ID: google,
    VITE_MICROSOFT_CLIENT_ID: microsoft,
    VITE_RELAY_URL: relayUrl,
  } = import.meta.env;
  if (isDesktop()) {
    // Both providers refuse an embedded webview, the Rust side signs in in the system browser
    if (google) auths.google = createDesktopAuth("google");
    if (microsoft) auths.microsoft = createDesktopAuth("microsoft");
  } else {
    if (google) auths.google = createGoogleAuth({ clientId: google, relayUrl });
    if (microsoft) {
      auths.microsoft = createMicrosoftAuth({ clientId: microsoft, relayUrl });
    }
  }
  const session = createSession({ app, auths });
  void session.start();
  return session;
}
