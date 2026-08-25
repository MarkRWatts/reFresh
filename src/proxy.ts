import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/signin"];
// Prefix match: the invite landing page must be reachable while signed out
// (it shows the household/inviter preview and a "sign in to accept" link),
// not bounced before it can render.
const PUBLIC_PATH_PREFIXES = ["/invite/"];
// Better Auth names the database-session cookie differently depending on
// whether secure cookies are in play (https / production).
const SESSION_COOKIE_NAMES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

// Optimistic only — checks cookie presence, never hits the DB (this runs on
// every request, including prefetches, and must stay edge-safe — no Prisma
// adapter import here). Real authorization happens via auth.api.getSession()
// in server components/route handlers, which checks the session against the
// database, and requireMemberOrRedirect() beyond that for household
// membership.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isPublic && !authenticated) {
    const signInUrl = new URL("/signin", request.url);
    // Preserve where they were headed (e.g. an invite link reached while
    // signed out elsewhere) — app/signin/page.tsx validates this is a
    // same-origin path before ever redirecting to it.
    signInUrl.searchParams.set("callbackURL", pathname + request.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

// /api/auth/* must stay reachable (Better Auth's own routes — needed to
// sign in at all); static assets and the brand wordmark/icon used on the
// sign-in page must stay public too.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|brand|favicon.ico|icon.svg).*)"],
};
