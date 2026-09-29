/**
 * Functions called by the public API gateway (FastAPI) through the HTTP
 * actions in http.ts. They are internal: browsers cannot call them.
 *
 * The gateway is trusted to present credential hashes and usage records, but
 * nothing it sends is used to pick another tenant's data: the owner of a key is
 * always read from the key itself, and every number is clamped.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { hmacSha256Hex } from "./lib/crypto";
import { writeAudit } from "./lib/audit";
import { API_ENDPOINTS, normalizeEndpoints } from "./lib/endpoints";
import {
  accountRateLimitPerMinute,
  endpointCost,
  endpointRateLimitPerMinute,
  endpointMonthlyQuotaUnits,
  globalRateLimitPerMinute,
  keyDailyQuotaUnits,
  keyMonthlyQuotaUnits,
  requireEnv,
  routeRateLimitPerMinute,
  tenantDailyQuotaUnits,
  tenantMonthlyQuotaUnits,
} from "./lib/env";
import { MINUTE_MS, utcDay, windowStart } from "./lib/time";

type RateLimitState = { limit: number; remaining: number; reset: number; allowed: boolean };

const MAX_LIMIT = 100_000;
const IP_PATTERN = /^[0-9a-fA-F:./]{2,48}$/;

function clampLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 1 ? Math.min(Math.floor(value!), MAX_LIMIT) : fallback;
}

async function hit(ctx: MutationCtx, bucket: string, limit: number, now: number): Promise<RateLimitState> {
  return await hitWindow(ctx, bucket, limit, now, MINUTE_MS, 1);
}

async function hitWindow(
  ctx: MutationCtx,
  bucket: string,
  limit: number,
  now: number,
  durationMs: number,
  cost: number,
): Promise<RateLimitState> {
  const start = Math.floor(now / durationMs) * durationMs;
  const existing = await ctx.db
    .query("rateLimitWindows")
    .withIndex("by_bucket_window", (q) => q.eq("bucket", bucket).eq("windowStart", start))
    .unique();
  const count = (existing?.count ?? 0) + cost;
  if (existing) {
    await ctx.db.patch(existing._id, { count });
  } else {
    await ctx.db.insert("rateLimitWindows", { bucket, windowStart: start, count });
  }
  return {
    limit,
    remaining: Math.max(0, limit - count),
    reset: Math.floor((start + durationMs) / 1000),
    allowed: count <= limit,
  };
}

/** Distributed limits for the anonymous demo. No browser credential, Origin,
 * Referer or User-Agent participates in the decision. Client addresses are
 * HMACed before storage; an unavailable address shares the fail-closed bucket. */
export const authorizeDemo = internalMutation({
  args: {
    clientIp: v.string(),
    endpoint: v.string(),
    cost: v.number(),
    minuteLimit: v.number(),
    hourLimit: v.number(),
    globalMinuteLimit: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const endpoint = API_ENDPOINTS.includes(args.endpoint as (typeof API_ENDPOINTS)[number])
      ? args.endpoint
      : args.endpoint === "reverse"
        ? "reverse"
        : "unknown";
    const ip = IP_PATTERN.test(args.clientIp) ? args.clientIp : "unknown";
    const ipHash = (await hmacSha256Hex(requireEnv("GATEWAY_SECRET"), `demo:${ip}`)).slice(0, 32);
    const cost = Math.min(100, Math.max(1, Math.floor(args.cost)));
    const minuteLimit = clampLimit(args.minuteLimit, 20);
    const hourLimit = clampLimit(args.hourLimit, 100);
    const globalLimit = clampLimit(args.globalMinuteLimit, 5_000);
    const states = [
      await hitWindow(ctx, `demo:ip:${ipHash}:minute`, minuteLimit, now, MINUTE_MS, cost),
      await hitWindow(ctx, `demo:ip:${ipHash}:hour`, hourLimit, now, 60 * MINUTE_MS, cost),
      await hitWindow(ctx, `demo:ip:${ipHash}:${endpoint}:minute`, minuteLimit, now, MINUTE_MS, cost),
      await hitWindow(ctx, "demo:global:minute", globalLimit, now, MINUTE_MS, cost),
    ];
    const state = combine(states);
    if (!state.allowed) {
      await writeAudit(ctx, "demo_rate_limit_violation", "WARNING", "failure", { detail: endpoint });
    }
    return {
      status: state.allowed ? ("ok" as const) : ("rate_limited" as const),
      rateLimit: { limit: state.limit, remaining: state.remaining, reset: state.reset },
    };
  },
});

/** The most restrictive of several limits: refused if any is exceeded. */
function combine(states: RateLimitState[]): RateLimitState {
  const allowed = states.every((state) => state.allowed);
  const binding = [...states].sort((a, b) => (a.allowed === b.allowed ? a.remaining - b.remaining : a.allowed ? 1 : -1))[0]!;
  return { ...binding, allowed };
}

function quotaPeriod(now: number, period: "day" | "month"): { start: number; reset: number } {
  const date = new Date(now);
  const start =
    period === "day"
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const reset =
    period === "day"
      ? start + 24 * 60 * MINUTE_MS
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { start, reset };
}

async function consumeCustomerQuotas(
  ctx: MutationCtx,
  key: Doc<"apiKeys">,
  endpoint: string | undefined,
  now: number,
): Promise<RateLimitState> {
  const cost = endpointCost(endpoint);
  const endpointName = API_ENDPOINTS.includes(endpoint as (typeof API_ENDPOINTS)[number])
    ? endpoint!
    : "unknown";
  const specs: { bucket: string; period: "day" | "month"; limit: number }[] = [
    { bucket: `key:${key._id}`, period: "day", limit: keyDailyQuotaUnits() },
    { bucket: `key:${key._id}`, period: "month", limit: keyMonthlyQuotaUnits() },
    { bucket: `tenant:${key.userId}`, period: "day", limit: tenantDailyQuotaUnits() },
    { bucket: `tenant:${key.userId}`, period: "month", limit: tenantMonthlyQuotaUnits() },
    {
      bucket: `tenant:${key.userId}:endpoint:${endpointName}`,
      period: "month",
      limit: endpointMonthlyQuotaUnits(),
    },
  ];
  const checked = [];
  for (const spec of specs) {
    const { start, reset } = quotaPeriod(now, spec.period);
    const existing = await ctx.db
      .query("quotaWindows")
      .withIndex("by_bucket_period_start", (q) =>
        q.eq("bucket", spec.bucket).eq("period", spec.period).eq("periodStart", start),
      )
      .unique();
    const next = (existing?.units ?? 0) + cost;
    checked.push({ ...spec, start, reset, existing, next, allowed: next <= spec.limit });
  }
  const states = checked.map((item) => ({
    limit: item.limit,
    remaining: item.allowed ? Math.max(0, item.limit - item.next) : 0,
    reset: Math.floor(item.reset / 1000),
    allowed: item.allowed,
  }));
  const combined = combine(states);
  // Two-pass check: when any quota refuses the request, no other quota is
  // consumed. Successful work is charged atomically within this mutation.
  if (!combined.allowed) return combined;
  for (const item of checked) {
    if (item.existing) await ctx.db.patch(item.existing._id, { units: item.next });
    else {
      await ctx.db.insert("quotaWindows", {
        bucket: item.bucket,
        period: item.period,
        periodStart: item.start,
        units: item.next,
      });
    }
  }
  return combined;
}

/**
 * Validates a credential (by its peppered hash), checks that its key may call
 * `endpoint`, and counts the request against layered rate limits:
 *
 *   - per key (the key's own limit or the default), or for the website's site
 *     key per visitor IP (so one visitor cannot use up the shared key) plus an
 *     overall cap on the key;
 *   - per account, across all its keys, so creating more keys does not raise
 *     the ceiling (not for the site key);
 *   - per key or visitor for routing, the most expensive endpoint.
 *
 * Visitor IPs are stored only as keyed hashes.
 */
/**
 * Read-only key lookup for the gateway's in-process cache. It returns the key's
 * static limits and scopes WITHOUT touching rate-limit counters, so the gateway
 * can validate and rate-limit locally (see AUTH_CACHE_TTL_SECONDS) and skip the
 * per-request mutation round-trip. Rate limiting then becomes per gateway
 * instance; revocation and limit changes take effect within the cache TTL.
 */
export const describe = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const now = Date.now();
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", hash))
      .unique();
    if (key === null) return { status: "invalid" as const };
    if (key.revokedAt !== undefined) return { status: "revoked" as const };
    if (key.expiresAt !== undefined && key.expiresAt <= now) return { status: "expired" as const };
    const owner = await ctx.db.get(key.userId);
    if (owner === null || owner.disabledAt !== undefined) return { status: "revoked" as const };
    return {
      status: "ok" as const,
      keyId: key._id,
      userId: key.userId,
      isSiteKey: key.isSiteKey === true,
      rateLimitPerMinute: key.rateLimitPerMinute ?? null,
      accountLimit: accountRateLimitPerMinute(),
      routeLimit: routeRateLimitPerMinute(),
      endpoints: key.endpoints ? normalizeEndpoints(key.endpoints) : null,
    };
  },
});

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
      if (token === null) {
        await writeAudit(ctx, "api_authentication_failed", "WARNING", "failure", { detail: "invalid" });
        return { status: "invalid" as const };
      }
      if (token.expiresAt <= now) {
        await writeAudit(ctx, "api_authentication_failed", "INFO", "failure", { detail: "expired" });
        return { status: "expired" as const };
      }
      key = await ctx.db.get(token.apiKeyId);
      if (key === null || key.userId !== token.userId) {
        await writeAudit(ctx, "api_authentication_failed", "HIGH", "failure", { detail: "token_binding" });
        return { status: "invalid" as const };
      }
      viaPlayground = true;
    } else {
      key = await ctx.db
        .query("apiKeys")
        .withIndex("by_key_hash", (q) => q.eq("keyHash", args.hash))
        .unique();
      if (key === null) {
        await writeAudit(ctx, "api_authentication_failed", "WARNING", "failure", { detail: "invalid" });
        return { status: "invalid" as const };
      }
    }
    if (key.revokedAt !== undefined) {
      await writeAudit(ctx, "api_authentication_failed", "WARNING", "failure", {
        tenantId: key.userId,
        apiKeyId: key._id,
        detail: "revoked",
      });
      return { status: "revoked" as const };
    }
    if (key.expiresAt !== undefined && key.expiresAt <= now) {
      await writeAudit(ctx, "api_authentication_failed", "INFO", "failure", {
        tenantId: key.userId,
        apiKeyId: key._id,
        detail: "expired",
      });
      return { status: "expired" as const };
    }
    const owner = await ctx.db.get(key.userId);
    // Keys of a disabled or deleted account stop working like revoked keys.
    if (owner === null || owner.disabledAt !== undefined) {
      await writeAudit(ctx, "api_authentication_failed", "HIGH", "failure", {
        tenantId: key.userId,
        apiKeyId: key._id,
        detail: "tenant_disabled",
      });
      return { status: "revoked" as const };
    }

    const isSiteKey = key.isSiteKey === true && !viaPlayground;
    const principal = {
      keyId: key._id,
      userId: key.userId,
      tenantId: key.userId,
      projectId: key._id,
      isSiteKey,
      viaPlayground,
    };
    if (key.endpoints !== undefined) {
      const allowed = normalizeEndpoints(key.endpoints);
      if (!allowed.some((endpoint) => endpoint === args.endpoint)) {
        await writeAudit(ctx, "api_authorization_failed", "HIGH", "failure", {
          tenantId: key.userId,
          apiKeyId: key._id,
          detail: args.endpoint ?? "missing_scope",
        });
        // Not counted against the rate limit; recorded in usage as a 403.
        return { status: "endpoint_not_allowed" as const, principal, allowedEndpoints: allowed };
      }
    }

    const defaultLimit = clampLimit(args.defaultLimit, 100);
    const buckets: { bucket: string; limit: number }[] = [];
    if (isSiteKey) {
      // Without a valid visitor IP all such requests share one bucket (fail closed).
      const ip = args.clientIp && IP_PATTERN.test(args.clientIp) ? args.clientIp : "unknown";
      const ipHash = (await hmacSha256Hex(requireEnv("GATEWAY_SECRET"), `ip:${ip}`)).slice(0, 32);
      const perIp = clampLimit(args.perIpLimit, 60);
      buckets.push({ bucket: `ip:${ipHash}`, limit: perIp });
      // Overall cap on the shared key, whatever the visitor addresses.
      buckets.push({ bucket: `key:${key._id}`, limit: clampLimit(key.rateLimitPerMinute, 10_000) });
      if (args.endpoint === "route") {
        buckets.push({ bucket: `ip:${ipHash}:route`, limit: Math.min(perIp, routeRateLimitPerMinute()) });
      }
    } else {
      const perKey = clampLimit(key.rateLimitPerMinute, defaultLimit);
      buckets.push({ bucket: `key:${key._id}`, limit: perKey });
      buckets.push({ bucket: `user:${key.userId}`, limit: Math.max(perKey, accountRateLimitPerMinute()) });
      const endpointLimit =
        args.endpoint === "route"
          ? Math.min(perKey, endpointRateLimitPerMinute(), routeRateLimitPerMinute())
          : Math.min(perKey, endpointRateLimitPerMinute());
      buckets.push({
        bucket: `key:${key._id}:endpoint:${args.endpoint ?? "unknown"}`,
        limit: endpointLimit,
      });
      buckets.push({ bucket: "customer:global", limit: globalRateLimitPerMinute() });
    }
    const states: RateLimitState[] = [];
    for (const { bucket, limit } of buckets) states.push(await hit(ctx, bucket, limit, now));
    const state = combine(states);
    if (!state.allowed) {
      await writeAudit(ctx, "api_rate_limit_violation", "WARNING", "failure", {
        tenantId: key.userId,
        apiKeyId: key._id,
        detail: args.endpoint,
      });
      return {
        status: "rate_limited" as const,
        principal,
        rateLimit: { limit: state.limit, remaining: state.remaining, reset: state.reset },
      };
    }
    if (!isSiteKey) {
      const quota = await consumeCustomerQuotas(ctx, key, args.endpoint, now);
      if (!quota.allowed) {
        await writeAudit(ctx, "api_quota_exhausted", "WARNING", "failure", {
          tenantId: key.userId,
          apiKeyId: key._id,
          detail: args.endpoint,
        });
        return {
          status: "quota_exceeded" as const,
          principal,
          rateLimit: { limit: quota.limit, remaining: quota.remaining, reset: quota.reset },
        };
      }
    }
    await writeAudit(ctx, "api_authentication_succeeded", "INFO", "success", {
      tenantId: key.userId,
      apiKeyId: key._id,
      detail: args.endpoint,
    });
    return {
      status: "ok" as const,
      principal,
      rateLimit: { limit: state.limit, remaining: state.remaining, reset: state.reset },
    };
  },
});

// Ids arrive as strings and are checked with normalizeId, so one bad record
// cannot make the whole batch fail validation.
export const usageEntry = v.object({
  keyId: v.string(),
  userId: v.string(),
  endpoint: v.string(),
  method: v.string(),
  statusCode: v.number(),
  responseTimeMs: v.number(),
  timestamp: v.number(),
});

const FAILED_STATUS_FROM = 400;
export const MAX_USAGE_ENTRIES = 200;
const ENDPOINT_PATHS = new Set<string>(API_ENDPOINTS.map((endpoint) => `/v1/${endpoint}`));
const METHODS = new Set(["GET", "HEAD"]);
// Records may be delayed while Convex is unreachable, but not by more than a day.
const MAX_RECORD_AGE_MS = 24 * 60 * MINUTE_MS;
const MAX_CLOCK_SKEW_MS = 5 * MINUTE_MS;
const MAX_RESPONSE_TIME_MS = 10 * MINUTE_MS;

type Rollup = {
  userId: Id<"users">;
  apiKeyId: Id<"apiKeys">;
  endpoint: string;
  day: string;
  total: number;
  successful: number;
  failed: number;
  totalResponseTimeMs: number;
};

/**
 * Stores a batch of request records and updates the daily rollups. A record
 * is dropped unless its key exists and belongs to the user it names, and its
 * endpoint, method, status, duration and time are plausible.
 */
export const recordUsage = internalMutation({
  args: { entries: v.array(usageEntry) },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    const keys = new Map<string, Doc<"apiKeys"> | null>();
    const lastUsed = new Map<Id<"apiKeys">, number>();
    const rollups = new Map<string, Rollup>();
    let written = 0;
    for (const entry of entries.slice(0, MAX_USAGE_ENTRIES)) {
      if (!keys.has(entry.keyId)) {
        const keyId = ctx.db.normalizeId("apiKeys", entry.keyId);
        keys.set(entry.keyId, keyId === null ? null : await ctx.db.get(keyId));
      }
      const key = keys.get(entry.keyId);
      if (!key || key.userId !== entry.userId) continue;
      if (!ENDPOINT_PATHS.has(entry.endpoint) || !METHODS.has(entry.method)) continue;
      if (!Number.isInteger(entry.statusCode) || entry.statusCode < 100 || entry.statusCode > 599) continue;
      if (!Number.isFinite(entry.timestamp)) continue;
      if (entry.timestamp < now - MAX_RECORD_AGE_MS || entry.timestamp > now + MAX_CLOCK_SKEW_MS) continue;
      const timestamp = Math.min(entry.timestamp, now);
      const responseTimeMs = Number.isFinite(entry.responseTimeMs)
        ? Math.min(MAX_RESPONSE_TIME_MS, Math.max(0, Math.round(entry.responseTimeMs)))
        : 0;

      await ctx.db.insert("apiRequests", {
        apiKeyId: key._id,
        userId: key.userId,
        endpoint: entry.endpoint,
        method: entry.method,
        statusCode: entry.statusCode,
        responseTimeMs,
        timestamp,
      });
      written += 1;
      lastUsed.set(key._id, Math.max(lastUsed.get(key._id) ?? 0, timestamp));
      const day = utcDay(timestamp);
      const id = `${key._id}|${entry.endpoint}|${day}`;
      const rollup = rollups.get(id) ?? {
        userId: key.userId,
        apiKeyId: key._id,
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
      rollup.totalResponseTimeMs += responseTimeMs;
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
      const key = keys.get(keyId);
      if (key && (key.lastUsedAt ?? 0) < timestamp) await ctx.db.patch(keyId, { lastUsedAt: timestamp });
    }
    return { written, dropped: entries.length - written };
  },
});
