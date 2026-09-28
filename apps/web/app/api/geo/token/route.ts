import type { NextRequest } from "next/server";
import { refreshGeoToken } from "@/lib/geo-token";
import { errorResponse, isSameOrigin } from "@/lib/http";

/**
 * Refreshes the map's per-session token so a page left open longer than the
 * token's lifetime keeps working, without minting a token from nothing: the
 * caller must present its current token, and refreshing is allowed only until
 * the session's hard expiry (see lib/geo-token.ts). Same-origin only, so it is
 * not a general token dispenser.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-site request rejected.");
  const next = refreshGeoToken(request.headers.get("x-geo-token"));
  if (next === null) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Reload the page to continue.");
  return Response.json(next, { headers: { "Cache-Control": "no-store" } });
}
