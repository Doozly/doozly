import { answerDropbox } from "./dropbox/popup.ts";

// The sign-in popups land here and hand the answer back to the app, then close
if (answerDropbox(location.search)) {
  window.close();
} else {
  import("@azure/msal-browser/redirect-bridge")
    .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
    .catch((err: unknown) => {
      console.error(err);
      document.body.textContent =
        "Sign-in didn't work. You can close this window.";
    });
}
