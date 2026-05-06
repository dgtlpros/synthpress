import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const protectedRoutes = ["/dashboard", "/teams", "/account", "/checkout"];
const authRoutes = ["/login", "/signup"];
const middlewareSkipPrefixes = ["/api/webhooks"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (middlewareSkipPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next({ request });
  }

  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
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
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
