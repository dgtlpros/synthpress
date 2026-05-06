import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isStaleBrowserSessionError } from "@/lib/supabase/auth-session";

export type UpdateSessionOptions = {
  /**
   * When false, skips Supabase auth network calls in middleware. Public routes do
   * not need `user` for redirects; Server Components still call `getUser()` once.
   * (`getSession()` also refreshes and would duplicate stale-token errors with RSC.)
   */
  resolveUser?: boolean;
};

export async function updateSession(
  request: NextRequest,
  options?: UpdateSessionOptions,
) {
  const resolveUser = options?.resolveUser ?? true;

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;

  if (resolveUser) {
    const { data: userData, error } = await supabase.auth.getUser();
    user = userData.user;

    if (error && isStaleBrowserSessionError(error)) {
      await supabase.auth.signOut();
      user = null;
    }
  }

  return { user, supabaseResponse };
}
