import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

// The sign-in popup lands here and hands the answer back to the app, then closes
broadcastResponseToMainFrame().catch((err: unknown) => {
  console.error(err);
  document.body.textContent = "Sign-in didn't work. You can close this window.";
});
