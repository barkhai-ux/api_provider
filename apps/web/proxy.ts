import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { clientIp } from "@/lib/http";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * - Handles Convex Auth: POST /api/auth sign-in/sign-out and session refresh
 *   cookies (httpOnly, SameSite=Lax, __Host- prefixed outside localhost).
 * - Optimistic redirects: /dashboard needs a session; signed-in users skip the
 *   login and register pages. Pages still verify the session themselves.
 * - Content-Security-Policy with a per-request nonce. Next.js reads the policy
 *   from the request headers and puts the nonce on its own scripts, which is
 *   why every page renders dynamically (app/layout.tsx).
 * - Throttles POST /api/auth per visitor (sign-in, sign-up, password reset).
 */
const isDashboard = createRouteMatcher(["/dashboard(.*)"]);
const isGuestOnly = createRouteMatcher(["/login", "/register"]);
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const isProduction = process.env.NODE_ENV === "production";

function withContentSecurityPolicy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const https =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const policy = contentSecurityPolicy(nonce, { development: !isProduction, https });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

const convexAuth = convexAuthNextjsMiddleware(
  async (request, { convexAuth: auth }) => {
    if (isDashboard(request) && !(await auth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, `/login?next=${encodeURIComponent(request.nextUrl.pathname)}`);
    }
    if (isGuestOnly(request) && (await auth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/dashboard");
    }
    // Convex Auth copies these headers onto its response when it refreshes cookies.
    return withContentSecurityPolicy(request);
  },
  {
    convexUrl: process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL,
    cookieConfig: { maxAge: SESSION_MAX_AGE_SECONDS },
  },
);

/**
 * Convex Auth error text is mapped to a small set of stable codes the forms
 * understand. "InvalidAccountId" (unknown email) and "InvalidSecret" (wrong
 * password) collapse into one, so sign-in does not reveal which emails have
 * accounts; anything unexpected becomes a generic error without server detail.
 * ConvexError messages (validation text written for users) pass through.
 */
const AUTH_ERRORS: [RegExp, string][] = [
  [/InvalidAccountId|InvalidSecret|Invalid credentials/, "InvalidCredentials"],
  [/TooManyFailedAttempts/, "TooManyFailedAttempts"],
  [/already exists/i, "AccountAlreadyExists"],
  [/Could not verify code|Invalid code|reset code does not match/i, "InvalidCode"],
];

async function normalizeAuthError(response: Response): Promise<Response> {
  const body = (await response.clone().json().catch(() => null)) as { error?: string } | null;
  if (typeof body?.error !== "string") return response;
  const convexMessage = /ConvexError: ([^\n]{1,300})/.exec(body.error)?.[1];
  const code = AUTH_ERRORS.find(([pattern]) => pattern.test(body.error!))?.[1];
  const error = code ?? (convexMessage ? `ConvexError: ${convexMessage}` : "ServerError");
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ error }), { status: 400, headers });
}

// A coarse per-visitor limit for sign-in, sign-up and password reset attempts
// (and session refreshes, which use the same route), on top of Convex Auth's
// per-account limit. In memory, per server instance; the nginx configuration
// in deploy/ adds a similar limit in front.
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_REQUESTS = Number(process.env.AUTH_RATE_LIMIT_PER_10_MINUTES ?? "60");
const authAttempts = new Map<string, { start: number; count: number }>();

function authRateLimited(request: NextRequest): boolean {
  // Without a trusted client address (CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS)
  // there is nothing safe to key on: one shared bucket would let anyone lock
  // everybody out, so only the per-account limits in Convex apply then.
  const visitor = clientIp(request);
  if (visitor === undefined) return false;
  const now = Date.now();
  if (authAttempts.size > 10_000) {
    for (const [key, entry] of authAttempts) if (now - entry.start > AUTH_WINDOW_MS) authAttempts.delete(key);
  }
  const entry = authAttempts.get(visitor);
  if (!entry || now - entry.start > AUTH_WINDOW_MS) {
    authAttempts.set(visitor, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > AUTH_MAX_REQUESTS;
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const isAuthAction = request.method === "POST" && request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth";
  if (isAuthAction && authRateLimited(request)) {
    return Response.json(
      { error: "TooManyFailedAttempts" },
      { status: 429, headers: { "Retry-After": String(AUTH_WINDOW_MS / 1000), "Cache-Control": "no-store" } },
    );
  }
  const response = await convexAuth(request, event);
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth" && response instanceof Response && response.status === 400) {
    return normalizeAuthError(response);
  }
  return response;
}

export const config = {
  // Everything except static assets and the geo API proxy (which needs no session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1/|maplibre/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|mjs)$).*)"],
};
