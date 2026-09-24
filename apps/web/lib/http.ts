import "server-only";

import type { NextRequest } from "next/server";

/** JSON error in the platform's standard envelope. */
export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The visitor's IP. Uses the right-most X-Forwarded-For entry, which is the
 * address seen by the closest proxy. In production run behind a reverse proxy
 * that sets X-Forwarded-For; otherwise clients can spoof it.
 */
export function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    ?? request.headers.get("x-real-ip")?.trim();
  return candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : undefined;
}

/**
 * Rejects cross-site state-changing requests (CSRF). Compares the Origin
 * header with the host the browser addressed (Host, or X-Forwarded-Host behind
 * a reverse proxy). request.nextUrl reflects the server's bind address in
 * standalone mode, so it cannot be used here.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return fetchSite === "same-origin";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
