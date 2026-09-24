import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { timingSafeEqual } from "./lib/crypto";

const http = httpRouter();

// Convex Auth routes (JWKS and OpenID configuration used to verify sessions).
auth.addHttpRoutes(http);

const MAX_USAGE_BATCH = 200;
const MAX_BODY_BYTES = 256 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Only the API gateway holds GATEWAY_SECRET. */
function authorized(request: Request): boolean {
  const secret = process.env.GATEWAY_SECRET;
  const header = request.headers.get("Authorization") ?? "";
  return Boolean(secret) && timingSafeEqual(header, `Bearer ${secret}`);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ConvexError("Body too large");
  return JSON.parse(text);
}

http.route({
  path: "/gateway/health",
  method: "GET",
  handler: httpAction(async (_, request) => {
    if (!authorized(request)) return json({ error: "unauthorized" }, 401);
    return json({ status: "ok" });
  }),
});

http.route({
  path: "/gateway/authorize",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return json({ error: "unauthorized" }, 401);
    let body: Record<string, unknown>;
    try {
      body = (await readJson(request)) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid body" }, 400);
    }
    const kind = body.kind === "playground" ? "playground" : body.kind === "key" ? "key" : null;
    if (kind === null || typeof body.hash !== "string" || !/^[0-9a-f]{64}$/.test(body.hash)) {
      return json({ error: "invalid body" }, 400);
    }
    const defaultLimit = Number(body.defaultLimit);
    if (!Number.isFinite(defaultLimit) || defaultLimit < 1) return json({ error: "invalid body" }, 400);
    const clientIp = typeof body.clientIp === "string" ? body.clientIp.slice(0, 64) : undefined;
    const perIpLimit = Number.isFinite(Number(body.perIpLimit)) ? Number(body.perIpLimit) : undefined;
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, 64) : undefined;
    const result = await ctx.runMutation(internal.gateway.authorize, {
      kind,
      hash: body.hash,
      endpoint,
      defaultLimit,
      clientIp,
      perIpLimit,
    });
    return json(result);
  }),
});

http.route({
  path: "/gateway/usage",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return json({ error: "unauthorized" }, 401);
    let entries: unknown;
    try {
      entries = ((await readJson(request)) as { entries?: unknown }).entries;
    } catch {
      return json({ error: "invalid body" }, 400);
    }
    if (!Array.isArray(entries)) return json({ error: "invalid body" }, 400);
    let written = 0;
    for (let i = 0; i < entries.length; i += MAX_USAGE_BATCH) {
      const result = await ctx.runMutation(internal.gateway.recordUsage, {
        entries: entries.slice(i, i + MAX_USAGE_BATCH),
      });
      written += result.written;
    }
    return json({ written });
  }),
});

export default http;
