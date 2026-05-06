import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { AuthError, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { after } from "next/server";
import {
  isStaleBrowserSessionError,
  withSilencedStaleRefreshTokenLogs,
} from "@/lib/supabase/auth-session";
import type { Database } from "./database.types";

type AuthGetUserResult = {
  data: { user: User | null };
  error: AuthError | null;
};

const authUserInflight = new Map<string, Promise<AuthGetUserResult>>();

function getSupabaseCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.getAll().filter((c) => c.name.startsWith("sb-"));
}

function supabaseAuthCookieKey(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): string {
  const parts = getSupabaseCookies(cookieStore)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `${c.name}=${c.value}`);
  /* v8 ignore next */
  return parts.length > 0 ? parts.join(";") : "__no_sb_cookies__";
}

/**
 * Next may run the same Server Component twice per navigation (HTML + RSC payload).
 * That would call `getUser()` twice and duplicate Supabase refresh logs. This helper:
 *   1. Skips Supabase entirely when no `sb-*` cookie exists (logged-out users).
 *   2. Shares one in-flight `getUser()` per outgoing response (the dedup map entry
 *      is cleared in `after()`).
 *   3. Filters Supabase's internal `console.error` for stale refresh-token errors
 *      so the dev terminal isn't spammed when local cookies outlive the session.
 */
export async function getAuthUserOncePerResponse(): Promise<AuthGetUserResult> {
  const cookieStore = await cookies();

  if (getSupabaseCookies(cookieStore).length === 0) {
    return { data: { user: null }, error: null };
  }

  const key = supabaseAuthCookieKey(cookieStore);

  const existing = authUserInflight.get(key);
  if (existing) {
    return existing;
  }

  const promise = withSilencedStaleRefreshTokenLogs(async () => {
    const supabase = await createClient();
    return supabase.auth.getUser();
  });

  authUserInflight.set(key, promise);

  after(() => {
    authUserInflight.delete(key);
  });

  return promise;
}

/** Clears dedupe state between Vitest cases (NODE_ENV=test only). */
export function resetAuthUserDedupeForTests() {
  /* v8 ignore next */
  if (process.env.NODE_ENV !== "test") return;
  authUserInflight.clear();
}

export async function createClient() {
  const cookieStore = await cookies();

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // This can be ignored when calling from a Server Component
            // because cookies can only be set in a Server Action or Route Handler.
          }
        },
      },
    },
  );

  const originalGetUser = supabase.auth.getUser.bind(supabase.auth);
  supabase.auth.getUser = async (jwt) => {
    const result = await originalGetUser(jwt);
    if (result.error && isStaleBrowserSessionError(result.error)) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Same read-only cookie context as setAll — middleware already clears cookies when possible.
      }
      return { data: { user: null }, error: null } as unknown as Awaited<
        ReturnType<typeof originalGetUser>
      >;
    }
    return result;
  };

  return supabase;
}
