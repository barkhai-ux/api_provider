import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * - Handles Convex Auth: POST /api/auth sign-in/sign-out and session refresh
 *   cookies (httpOnly, SameSite=Lax, __Host- prefixed outside localhost).
 * - Optimistic redirects: /dashboard needs a session; signed-in users skip the
 *   login and register pages. Pages still verify the session themselves.
 */
const isDashboard = createRouteMatcher(["/dashboard(.*)"]);
const isGuestOnly = createRouteMatcher(["/login", "/register"]);
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const convexAuth = convexAuthNextjsMiddleware(
  async (request, { convexAuth: auth }) => {
    if (isDashboard(request) && !(await auth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, `/login?next=${encodeURIComponent(request.nextUrl.pathname)}`);
    }
    if (isGuestOnly(request) && (await auth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/dashboard");
    }
  },
  {
    convexUrl: process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL,
    cookieConfig: { maxAge: SESSION_MAX_AGE_SECONDS },
  },
);

// Convex Auth reports "InvalidAccountId" for unknown emails and "InvalidSecret"
// for wrong passwords. Collapse both so sign-in does not reveal which emails
// have accounts.
const CREDENTIAL_ERRORS = /InvalidAccountId|InvalidSecret|Invalid credentials/;

async function normalizeAuthError(response: Response): Promise<Response> {
  const body = (await response.clone().json().catch(() => null)) as { error?: string } | null;
  if (!body?.error || !CREDENTIAL_ERRORS.test(body.error)) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ error: "InvalidCredentials" }), { status: 400, headers });
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await convexAuth(request, event);
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth" && response instanceof Response && response.status === 400) {
    return normalizeAuthError(response);
  }
  return response;
}

export const config = {
  // Everything except static assets and the geo API proxy (which needs no session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1/|maplibre/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml|mjs)$).*)"],
};
