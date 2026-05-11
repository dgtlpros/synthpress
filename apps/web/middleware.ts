import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const protectedRoutes = ["/dashboard", "/teams", "/account", "/checkout"];
const authRoutes = ["/login", "/signup"];
// Routes that authenticate via their own header check (Stripe webhook
// signature, CRON_SECRET, etc.) instead of the user-session cookie
// flow this middleware enforces.
const middlewareSkipPrefixes = ["/api/webhooks", "/api/cron"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (middlewareSkipPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next({ request });
  }

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  const { user, supabaseResponse } = await updateSession(request, {
    resolveUser: isProtected || isAuthRoute,
  });

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Exclude:
    //   * Next.js static asset paths
    //   * favicon / logo
    //   * Common image extensions
    //   * `.well-known/workflow/*` — the Vercel Workflow SDK generates
    //     route handlers there (see `withWorkflow()` in `next.config.ts`).
    //     If auth middleware ran on them we'd block workflow callbacks.
    "/((?!_next/static|_next/image|favicon.ico|logo.png|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
