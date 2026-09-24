/**
 * Functions called by the public API gateway (FastAPI) through the HTTP
 * actions in http.ts. They are internal: browsers cannot call them.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { MINUTE_MS, utcDay, windowStart } from "./lib/time";

type RateLimitState = { limit: number; remaining: number; reset: number; allowed: boolean };

async function hit(ctx: MutationCtx, bucket: string, limit: number, now: number): Promise<RateLimitState> {
  const start = windowStart(now);
  const existing = await ctx.db
    .query("rateLimitWindows")
    .withIndex("by_bucket_window", (q) => q.eq("bucket", bucket).eq("windowStart", start))
    .unique();
  const count = (existing?.count ?? 0) + 1;
  if (existing) {
    await ctx.db.patch(existing._id, { count });
  } else {
    await ctx.db.insert("rateLimitWindows", { bucket, windowStart: start, count });
  }
  return {
    limit,
    remaining: Math.max(0, limit - count),
    reset: Math.floor((start + MINUTE_MS) / 1000),
    allowed: count <= limit,
  };
}

/**
 * Validates a credential (by its peppered hash), checks that its key may call
 * `endpoint`, and counts the request against the rate limit. Keys are limited
 * per key; the website's site key is limited per visitor IP instead, so one
 * visitor cannot use up the shared key.
 */
export const authorize = internalMutation({
  args: {
    kind: v.union(v.literal("key"), v.literal("playground")),
    hash: v.string(),
    // The endpoint called, e.g. "geocode". Keys limited to some endpoints are
    // refused when it is missing.
    endpoint: v.optional(v.string()),
    defaultLimit: v.number(),
    clientIp: v.optional(v.string()),
    perIpLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let key: Doc<"apiKeys"> | null = null;
    let viaPlayground = false;
    if (args.kind === "playground") {
      const token = await ctx.db
        .query("playgroundTokens")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.hash))
        .unique();
      if (token === null) return { status: "invalid" as const };
      if (token.expiresAt <= now) return { status: "expired" as const };
      key = await ctx.db.get(token.apiKeyId);
      if (key === null || key.userId !== token.userId) return { status: "invalid" as const };
      viaPlayground = true;
    } else {
      key = await ctx.db
        .query("apiKeys")
        .withIndex("by_key_hash", (q) => q.eq("keyHash", args.hash))
        .unique();
      if (key === null) return { status: "invalid" as const };
    }
    if (key.revokedAt !== undefined) return { status: "revoked" as const };
    if (key.expiresAt !== undefined && key.expiresAt <= now) return { status: "expired" as const };

    const isSiteKey = key.isSiteKey === true && !viaPlayground;
    const principal = { keyId: key._id, userId: key.userId, isSiteKey, viaPlayground };
    if (key.endpoints !== undefined && !key.endpoints.some((allowed) => allowed === args.endpoint)) {
      // Not counted against the rate limit; recorded in usage as a 403.
      return { status: "endpoint_not_allowed" as const, principal, allowedEndpoints: key.endpoints };
    }
    const state =
      isSiteKey && args.clientIp && args.perIpLimit
        ? await hit(ctx, `ip:${args.clientIp}`, args.perIpLimit, now)
        : await hit(ctx, `key:${key._id}`, key.rateLimitPerMinute ?? args.defaultLimit, now);
    return {
      status: state.allowed ? ("ok" as const) : ("rate_limited" as const),
      principal,
      rateLimit: { limit: state.limit, remaining: state.remaining, reset: state.reset },
    };
  },
});

export const usageEntry = v.object({
  keyId: v.id("apiKeys"),
  userId: v.id("users"),
  endpoint: v.string(),
  method: v.string(),
  statusCode: v.number(),
  responseTimeMs: v.number(),
  timestamp: v.number(),
});

const FAILED_STATUS_FROM = 400;

/** Stores a batch of request records and updates the daily rollups. */
export const recordUsage = internalMutation({
  args: { entries: v.array(usageEntry) },
  handler: async (ctx, { entries }) => {
    const lastUsed = new Map<Id<"apiKeys">, number>();
    const rollups = new Map<
      string,
      { userId: Id<"users">; apiKeyId: Id<"apiKeys">; endpoint: string; day: string; total: number; successful: number; failed: number; totalResponseTimeMs: number }
    >();
    for (const entry of entries) {
      await ctx.db.insert("apiRequests", {
        apiKeyId: entry.keyId,
        userId: entry.userId,
        endpoint: entry.endpoint.slice(0, 100),
        method: entry.method.slice(0, 10),
        statusCode: entry.statusCode,
        responseTimeMs: Math.max(0, Math.round(entry.responseTimeMs)),
        timestamp: entry.timestamp,
      });
      lastUsed.set(entry.keyId, Math.max(lastUsed.get(entry.keyId) ?? 0, entry.timestamp));
      const day = utcDay(entry.timestamp);
      const id = `${entry.keyId}|${entry.endpoint}|${day}`;
      const rollup = rollups.get(id) ?? {
        userId: entry.userId,
        apiKeyId: entry.keyId,
        endpoint: entry.endpoint,
        day,
        total: 0,
        successful: 0,
        failed: 0,
        totalResponseTimeMs: 0,
      };
      rollup.total += 1;
      if (entry.statusCode >= FAILED_STATUS_FROM) rollup.failed += 1;
      else rollup.successful += 1;
      rollup.totalResponseTimeMs += Math.max(0, Math.round(entry.responseTimeMs));
      rollups.set(id, rollup);
    }
    for (const rollup of rollups.values()) {
      const existing = await ctx.db
        .query("usageDaily")
        .withIndex("by_key_endpoint_day", (q) =>
          q.eq("apiKeyId", rollup.apiKeyId).eq("endpoint", rollup.endpoint).eq("day", rollup.day),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          total: existing.total + rollup.total,
          successful: existing.successful + rollup.successful,
          failed: existing.failed + rollup.failed,
          totalResponseTimeMs: existing.totalResponseTimeMs + rollup.totalResponseTimeMs,
        });
      } else {
        await ctx.db.insert("usageDaily", rollup);
      }
    }
    for (const [keyId, timestamp] of lastUsed) {
      const key = await ctx.db.get(keyId);
      if (key && (key.lastUsedAt ?? 0) < timestamp) await ctx.db.patch(keyId, { lastUsedAt: timestamp });
    }
    return { written: entries.length };
  },
});
