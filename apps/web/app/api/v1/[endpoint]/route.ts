import type { NextRequest } from "next/server";
import { clientIp, errorResponse } from "@/lib/http";
import { serverEnv } from "@/lib/server-env";

/**
 * Same-origin proxy used by the public map and the developer landing demo.
 *
 * The browser calls /api/v1/<endpoint>; this handler forwards the request to
 * the public API with the website's own key, which never leaves the server.
 * It exposes exactly the public /v1 contract and nothing else.
 */
const ENDPOINTS = new Set(["geocode", "reverse-geocode", "route"]);
const FORWARDED_HEADERS = [
  "content-type",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "x-request-id",
];
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_QUERY_LENGTH = 1024;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/[endpoint]">) {
  const { endpoint } = await ctx.params;
  if (!ENDPOINTS.has(endpoint)) {
    return errorResponse(404, "NOT_FOUND", "The requested resource was not found.");
  }
  const query = request.nextUrl.searchParams.toString();
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(400, "INVALID_REQUEST", "The query string is too long.");
  }
  const env = serverEnv();
  if (!env.siteApiKey) {
    return errorResponse(503, "SERVICE_UNAVAILABLE", "The map is not connected to the API (SITE_API_KEY is not set).");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${env.siteApiKey}`,
  };
  const ip = clientIp(request);
  if (ip) headers["X-Client-IP"] = ip;

  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiInternalUrl}/v1/${endpoint}${query ? `?${query}` : ""}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(408, "REQUEST_TIMEOUT", "The API did not respond in time.");
    }
    return errorResponse(503, "SERVICE_UNAVAILABLE", "The API is unreachable. Try again shortly.");
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
}
