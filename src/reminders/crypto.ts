// Reminder payloads are sealed here, so the relay only ever sees times and noise.
// The key lives in the user's settings.json, that's how their other devices get it.

/** What a push needs to show and open the reminder */
export interface ReminderContent {
  title: string;
  list: string;
  taskId: string;
  listId: string;
}

// Long titles get cut, a push message has to fit in about 4 kB with everything around it
const MAX_TEXT = 150;
const IV_BYTES = 12;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A fresh AES-256 key, base64, for the reminderKey setting */
export function newReminderKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function importReminderKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(raw) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

// By code points, so an emoji doesn't get cut in half
function cut(s: string): string {
  const chars = [...s];
  return chars.length > MAX_TEXT
    ? `${chars.slice(0, MAX_TEXT - 1).join("")}…`
    : s;
}

/** IV then ciphertext. The reminder id is bound in, so a payload can't be moved to another reminder. */
export async function seal(
  key: CryptoKey,
  reminderId: string,
  content: ReminderContent,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(
    JSON.stringify({
      ...content,
      title: cut(content.title),
      list: cut(content.list),
    }),
  );
  const sealed = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(reminderId),
    },
    key,
    plain,
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return out;
}

/** null when it doesn't open, like after the key changed on another device */
export async function open(
  key: CryptoKey,
  reminderId: string,
  data: Uint8Array,
): Promise<ReminderContent | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: data.slice(0, IV_BYTES),
        additionalData: new TextEncoder().encode(reminderId),
      },
      key,
      data.slice(IV_BYTES),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as ReminderContent;
  } catch {
    return null;
  }
}
