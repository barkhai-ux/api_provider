import type { NextRequest } from "next/server";
import { clientIp, errorResponse } from "@/lib/http";
import { serverEnv } from "@/lib/server-env";

/**
 * Same-origin proxy used by the public map and the developer landing demo.
 *
 * The browser calls /api/v1/<endpoint>; this handler forwards the request to
 * the public API with the website's own key, which never leaves the server.
 * It is not a general proxy: each allowlisted endpoint maps to exactly one API
 * operation, only that operation's parameters are forwarded (validated and
 * re-encoded here), the upstream URL comes from server configuration, and no
 * browser header except the visitor's IP (when known) is passed on.
 */
type Check = (value: string) => boolean;

const finite = (value: string) => /^-?\d{1,3}(\.\d{1,15})?$/.test(value) && Number.isFinite(Number(value));
const latitude: Check = (value) => finite(value) && Math.abs(Number(value)) <= 90;
const longitude: Check = (value) => finite(value) && Math.abs(Number(value)) <= 180;
const lonLat: Check = (value) => {
  const [lon, lat, ...rest] = value.split(",");
  return rest.length === 0 && lon !== undefined && lat !== undefined && longitude(lon.trim()) && latitude(lat.trim());
};

const ENDPOINTS: Record<string, { required: string[]; params: Record<string, Check> }> = {
  geocode: {
    required: ["q"],
    params: {
      q: (value) => [...value.trim()].length >= 2 && [...value].length <= 200,
      limit: (value) => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 20,
    },
  },
  "reverse-geocode": {
    required: ["lat", "lon"],
    params: { lat: latitude, lon: longitude },
  },
  route: {
    required: ["origin", "destination"],
    params: { origin: lonLat, destination: lonLat, mode: (value) => value === "driving" || value === "walking" },
  },
};

const FORWARDED_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after", "x-request-id"];
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_QUERY_LENGTH = 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function invalid(message: string): Response {
  return errorResponse(400, "INVALID_REQUEST", message);
}

/** Reads at most `limit` bytes; null if the body is larger. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/[endpoint]">) {
  const { endpoint } = await ctx.params;
  const spec = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!spec) return errorResponse(404, "NOT_FOUND", "The requested resource was not found.");

  const incoming = request.nextUrl.searchParams;
  if (incoming.toString().length > MAX_QUERY_LENGTH) return invalid("The query string is too long.");
  const query = new URLSearchParams();
  for (const name of new Set(incoming.keys())) {
    const check = Object.hasOwn(spec.params, name) ? spec.params[name] : undefined;
    if (!check) return invalid(`Unknown parameter '${name.slice(0, 40)}'.`);
    const values = incoming.getAll(name);
    if (values.length > 1) return invalid(`Parameter '${name}' must appear only once.`);
    if (!check(values[0]!)) return invalid(`Invalid value for '${name}'.`);
    query.set(name, values[0]!);
  }
  for (const name of spec.required) {
    if (!query.has(name)) return invalid(`Parameter '${name}' is required.`);
  }

  const env = serverEnv();
  if (!env.siteApiKey) {
    console.error("[api/v1] SITE_API_KEY is not set; the map cannot call the API.");
    return errorResponse(503, "SERVICE_UNAVAILABLE", "The map is temporarily unavailable.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${env.siteApiKey}`,
  };
  const ip = clientIp(request);
  if (ip) headers["X-Client-IP"] = ip;

  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiInternalUrl}/v1/${endpoint}?${query}`, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(504, "REQUEST_TIMEOUT", "The API did not respond in time.");
    }
    return errorResponse(503, "SERVICE_UNAVAILABLE", "The API is unreachable. Try again shortly.");
  }

  // Only JSON from the API is passed on: an HTML error page from something in
  // between must never be served from this origin.
  if (!(upstream.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    await upstream.body?.cancel();
    return errorResponse(502, "UPSTREAM_ERROR", "The API returned an unexpected response.");
  }
  const body = await readLimited(upstream, MAX_RESPONSE_BYTES);
  if (body === null) return errorResponse(502, "UPSTREAM_ERROR", "The API response was too large.");

  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null && value.length <= 128) responseHeaders.set(name, value);
  }
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
