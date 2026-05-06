import type { AuthError } from "@supabase/supabase-js";

/**
 * True when cookies reference a session the auth server no longer has
 * (common after `supabase db reset` or revoked sessions). Callers should
 * `signOut()` so SSR clears cookies and the browser stops retrying refresh.
 */
export function isStaleBrowserSessionError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code;
  if (code === "refresh_token_not_found" || code === "invalid_refresh_token") {
    return true;
  }
  const msg = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return msg.includes("refresh token") && (msg.includes("not found") || msg.includes("invalid"));
}
