interface ImportMetaEnv {
  /** The OAuth client for the web app, from Google Cloud. Not a secret. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** The app registration in Microsoft Entra, also not a secret */
  readonly VITE_MICROSOFT_CLIENT_ID?: string;
  /** The app key of the Dropbox app (App folder access), not a secret either */
  readonly VITE_DROPBOX_CLIENT_ID?: string;
  /** The Go relay, like http://localhost:8080. Without it Google sign-ins last an hour, Dropbox ones 4. */
  readonly VITE_RELAY_URL?: string;
}
