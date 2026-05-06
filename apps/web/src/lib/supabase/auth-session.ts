import type { AuthError } from "@supabase/supabase-js";

/**
 * True when cookies reference a session the auth server no longer has
 * (common after `supabase db reset` or revoked sessions). Callers should
 * `signOut()` so SSR clears cookies and the browser stops retrying refresh.
 */
export function isStaleBrowserSessionError(
  error: AuthError | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code;
  if (code === "refresh_token_not_found" || code === "invalid_refresh_token") {
    return true;
  }
  const msg =
    typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    msg.includes("refresh token") &&
    (msg.includes("not found") || msg.includes("invalid"))
  );
}

/**
 * Match the same shape on raw values that Supabase's `_recoverAndRefresh()` logs
 * via `console.error(error)` before our `getUser()` wrapper ever sees the result.
 * Used to silence those duplicated lines without touching unrelated console output.
 */
export function isStaleRefreshTokenLog(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    code?: unknown;
    __isAuthError?: unknown;
    message?: unknown;
  };
  if (v.__isAuthError !== true) return false;
  if (
    v.code === "refresh_token_not_found" ||
    v.code === "invalid_refresh_token"
  ) {
    return true;
  }
  const msg = typeof v.message === "string" ? v.message.toLowerCase() : "";
  return (
    msg.includes("refresh token") &&
    (msg.includes("not found") || msg.includes("invalid"))
  );
}

/**
 * Runs `fn` while filtering Supabase's stale-refresh-token `console.error` lines
 * out of stdout. Other console output is unaffected. Restores the original on exit.
 */
export async function withSilencedStaleRefreshTokenLogs<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (args.length === 1 && isStaleRefreshTokenLog(args[0])) {
      return;
    }
    original(...args);
  };
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}
