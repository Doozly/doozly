// Dropbox's pages cut the popup off from its opener (COOP), so the answer goes over a BroadcastChannel

export const DROPBOX_CHANNEL = "doozly-dropbox-sign-in";
export const STATE_PREFIX = "dropbox.";

export interface PopupAnswer {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}

/** On the redirect page: true when this is Dropbox's answer, then it's passed on */
export function answerDropbox(search: string): boolean {
  const q = new URLSearchParams(search);
  const state = q.get("state");
  if (!state?.startsWith(STATE_PREFIX)) return false;
  const answer: PopupAnswer = {
    state,
    code: q.get("code") ?? undefined,
    error: q.get("error") ?? undefined,
    errorDescription: q.get("error_description") ?? undefined,
  };
  const channel = new BroadcastChannel(DROPBOX_CHANNEL);
  channel.postMessage(answer);
  channel.close();
  return true;
}
