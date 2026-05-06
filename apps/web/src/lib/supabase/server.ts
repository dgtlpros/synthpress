import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isStaleBrowserSessionError } from "@/lib/supabase/auth-session";
import type { Database } from "./database.types";

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
      return { data: { user: null }, error: null } as unknown as Awaited<ReturnType<typeof originalGetUser>>;
    }
    return result;
  };

  return supabase;
}
