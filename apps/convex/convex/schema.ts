import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { storedEndpointValidator } from "./lib/endpoints";

/**
 * Data model for developer accounts, API keys, usage and rate limits.
 *
 * Convex Auth provides the account/session tables (authAccounts holds the
 * scrypt password hash, authSessions the sessions). `users` extends the Convex
 * Auth users table with platform fields.
 */
export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // The platform's own account, which owns the website's site key.
    isSystem: v.optional(v.boolean()),
    // Set by an operator (admin:disableUser) to lock the account.
    disabledAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("by_system", ["isSystem"])
    .index("phone", ["phone"]),

  apiKeys: defineTable({
    userId: v.id("users"),
    name: v.string(),
    // Non-secret display prefix, e.g. "geo_a1b2".
    keyPrefix: v.string(),
    // HMAC-SHA256(API_KEY_PEPPER, key). The full key is never stored.
    keyHash: v.string(),
    // Legacy: keys used to be "live" or "test". No longer written.
    environment: v.optional(v.union(v.literal("live"), v.literal("test"))),
    // Endpoints the key may call. Undefined: all endpoints (site key, older keys).
    endpoints: v.optional(v.array(storedEndpointValidator)),
    rateLimitPerMinute: v.optional(v.number()),
    // The website's server-side key: limited per visitor IP instead of per key.
    isSiteKey: v.optional(v.boolean()),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_key_hash", ["keyHash"])
    .index("by_user", ["userId"]),

  // One row per authenticated /v1 request. No query strings, bodies or
  // credentials are stored. Raw rows are pruned after USAGE_RETENTION_DAYS;
  // daily totals live in usageDaily.
  apiRequests: defineTable({
    apiKeyId: v.id("apiKeys"),
    userId: v.id("users"),
    endpoint: v.string(),
    method: v.string(),
    statusCode: v.number(),
    responseTimeMs: v.number(),
    timestamp: v.number(),
  })
    .index("by_user_time", ["userId", "timestamp"])
    .index("by_key_time", ["apiKeyId", "timestamp"])
    .index("by_time", ["timestamp"]),

  // Pre-aggregated daily counts (UTC days) per key and endpoint, so dashboards
  // never scan raw requests.
  usageDaily: defineTable({
    userId: v.id("users"),
    apiKeyId: v.id("apiKeys"),
    endpoint: v.string(),
    day: v.string(), // YYYY-MM-DD (UTC)
    total: v.number(),
    successful: v.number(),
    failed: v.number(),
    totalResponseTimeMs: v.number(),
  })
    .index("by_user_day", ["userId", "day"])
    .index("by_key_endpoint_day", ["apiKeyId", "endpoint", "day"]),

  // Fixed one-minute windows. bucket is "key:<id>" or "ip:<address>".
  rateLimitWindows: defineTable({
    bucket: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_bucket_window", ["bucket", "windowStart"])
    .index("by_window", ["windowStart"]),

  // Short-lived tokens that let the docs playground call /v1 with one of the
  // developer's keys without the key's secret ever reaching the browser.
  playgroundTokens: defineTable({
    tokenHash: v.string(),
    apiKeyId: v.id("apiKeys"),
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_key", ["apiKeyId"])
    .index("by_expires", ["expiresAt"]),
});
