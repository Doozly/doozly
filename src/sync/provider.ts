export interface FileInfo {
  path: string;
  etag: string;
  size: number;
}

/** Drive's appDataFolder or the OneDrive app folder. Paths are relative to it, like "lists/abc.json". */
export interface StorageProvider {
  /** null when the file isn't there */
  read(path: string): Promise<{ data: Uint8Array; etag: string } | null>;
  /** With the ETag we last saw it throws `ConflictError` if the file changed since; a deleted one may just get made again. null: only create. */
  write(
    path: string,
    data: Uint8Array,
    ifMatch?: string | null,
  ): Promise<{ etag: string }>;
  /** Fine if it's already gone */
  delete(path: string): Promise<void>;
  list(): Promise<FileInfo[]>;
  /** Paths changed or deleted since `token`, plus the next token. No token lists everything. */
  changesSince(token?: string): Promise<{ changed: string[]; token: string }>;
}

/** Someone else wrote the file since we read it. Pull, merge, try again. */
export class ConflictError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`${path} changed on the server`);
    this.name = "ConflictError";
    this.path = path;
  }
}

/** Network down, token expired, quota, anything that's worth trying again later */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

/** The sign-in ran out or was revoked. Nothing to retry until the user signs in again. */
export class AuthError extends ProviderError {
  constructor(message = "Signed out") {
    super(message, false);
    this.name = "AuthError";
  }
}

/** The account has no storage to sync with, like a work account without OneDrive. Retrying won't help. */
export class NoStorageError extends ProviderError {
  constructor(message: string) {
    super(message, false);
    this.name = "NoStorageError";
  }
}

export type SignInFailure = "cancelled" | "noDriveAccess" | "failed";

/** The sign-in popup didn't end with a usable account */
export class SignInError extends Error {
  readonly reason: SignInFailure;
  constructor(reason: SignInFailure, message: string) {
    super(message);
    this.name = "SignInError";
    this.reason = reason;
  }
}
