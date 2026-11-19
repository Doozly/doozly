interface ImportMetaEnv {
  /** The OAuth client for the web app, from Google Cloud. Not a secret. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** The app registration in Microsoft Entra, also not a secret */
  readonly VITE_MICROSOFT_CLIENT_ID?: string;
  /** The Go relay, like http://localhost:8080. Without it Google sign-ins last an hour. */
  readonly VITE_RELAY_URL?: string;
}
