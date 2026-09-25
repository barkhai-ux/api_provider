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
// The API sends at most 500 records per request; allow some headroom.
const MAX_USAGE_ENTRIES = 1000;
const MAX_BODY_BYTES = 256 * 1024;
const MIN_SECRET_LENGTH = 32;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Only the API gateway holds GATEWAY_SECRET. During a rotation the previous
 * value stays valid through GATEWAY_SECRET_PREVIOUS (see
 * docs/security/incident-response.md). Secrets shorter than 32 characters are
 * never accepted, so a misconfigured deployment fails closed.
 */
function authorized(request: Request): boolean {
  const header = request.headers.get("Authorization") ?? "";
  let ok = false;
  for (const secret of [process.env.GATEWAY_SECRET, process.env.GATEWAY_SECRET_PREVIOUS]) {
    // Compare against every configured secret (no early exit) to keep timing flat.
    if (secret && secret.length >= MIN_SECRET_LENGTH && timingSafeEqual(header, `Bearer ${secret}`)) ok = true;
  }
  return ok;
}

/** Parses a JSON object body of bounded size; anything else is an error. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ConvexError("Body too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ConvexError("Body too large");
  const body: unknown = JSON.parse(text);
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ConvexError("Invalid body");
  return body as Record<string, unknown>;
}

function toUsageEntry(raw: unknown) {
  if (raw === null || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const { keyId, userId, endpoint, method } = entry;
  if (typeof keyId !== "string" || typeof userId !== "string") return null;
  if (typeof endpoint !== "string" || typeof method !== "string") return null;
  const statusCode = Number(entry.statusCode);
  const responseTimeMs = Number(entry.responseTimeMs);
  const timestamp = Number(entry.timestamp);
  if (![statusCode, responseTimeMs, timestamp].every(Number.isFinite)) return null;
  return {
    keyId: keyId.slice(0, 64),
    userId: userId.slice(0, 64),
    endpoint: endpoint.slice(0, 100),
    method: method.slice(0, 10),
    statusCode,
    responseTimeMs,
    timestamp,
  };
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
      body = await readJson(request);
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
      entries = (await readJson(request)).entries;
    } catch {
      return json({ error: "invalid body" }, 400);
    }
    if (!Array.isArray(entries) || entries.length > MAX_USAGE_ENTRIES) return json({ error: "invalid body" }, 400);
    // Malformed records are dropped here instead of failing the whole batch.
    const valid = entries.map(toUsageEntry).filter((entry) => entry !== null);
    let written = 0;
    for (let i = 0; i < valid.length; i += MAX_USAGE_BATCH) {
      const result = await ctx.runMutation(internal.gateway.recordUsage, {
        entries: valid.slice(i, i + MAX_USAGE_BATCH),
      });
      written += result.written;
    }
    return json({ written, dropped: entries.length - written });
  }),
});

export default http;
