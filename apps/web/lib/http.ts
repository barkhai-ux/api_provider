import "server-only";

import type { NextRequest } from "next/server";

/** JSON error in the platform's standard envelope. */
export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

function validIp(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && IP_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * The visitor's IP, or undefined when it cannot be known reliably. Forwarding
 * headers are trusted only when configured, because a client that reaches this
 * server directly can send any value:
 *
 * - CLIENT_IP_HEADER: a single-IP header set by a trusted edge proxy that
 *   overwrites client values (cf-connecting-ip on Render behind Cloudflare,
 *   x-real-ip behind the nginx configuration in deploy/nginx). No fallback.
 * - TRUSTED_PROXY_HOPS=n: the n-th X-Forwarded-For entry from the right, for n
 *   trusted proxies that each append the address they saw.
 *
 * With neither, the API limits all anonymous map traffic as one visitor
 * (fail closed) instead of trusting a spoofable header.
 */
export function clientIp(request: NextRequest): string | undefined {
  const trustedHeader = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) return validIp(request.headers.get(trustedHeader));
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isInteger(hops) || hops < 1) return undefined;
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return entries.length >= hops ? validIp(entries[entries.length - hops]) : undefined;
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
