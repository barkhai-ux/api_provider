import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@geo-platform/convex/api";
import type { Id } from "@geo-platform/convex/dataModel";
import { fetchAction } from "convex/nextjs";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, isSameOrigin } from "@/lib/http";
import { serverEnv } from "@/lib/server-env";

const Body = z.object({ keyId: z.string().min(1).max(64) });

/**
 * Issues a short-lived playground token for one of the developer's keys. The
 * playground sends it as the bearer credential; the key's secret is never
 * needed (and is not stored anywhere to be returned).
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-site request rejected.");
  const token = await convexAuthNextjsToken();
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to use your API keys.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "INVALID_REQUEST", "keyId is required.");
  try {
    const result = await fetchAction(
      api.apiKeys.createPlaygroundToken,
      { keyId: parsed.data.keyId as Id<"apiKeys"> },
      { token, url: serverEnv().convexUrl },
    );
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Could not create a playground token for this key.");
  }
}
