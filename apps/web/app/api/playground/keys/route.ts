import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@geo-platform/convex/api";
import { fetchQuery } from "convex/nextjs";
import { errorResponse } from "@/lib/http";
import { serverEnv } from "@/lib/server-env";

/** The signed-in developer's usable keys: names, masked values and allowed endpoints only. */
export async function GET() {
  const token = await convexAuthNextjsToken();
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to use your API keys.");
  try {
    const keys = await fetchQuery(api.apiKeys.list, {}, { token, url: serverEnv().convexUrl });
    return Response.json(
      {
        keys: keys
          .filter((key) => key.revokedAt === null && (key.expiresAt === null || key.expiresAt > Date.now()))
          .map((key) => ({ id: key.id, name: key.name, maskedKey: key.maskedKey, endpoints: key.endpoints })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to use your API keys.");
  }
}
