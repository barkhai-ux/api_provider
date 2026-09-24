import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { hmacSha256Hex } from "./lib/crypto";
import { defaultRateLimitPerMinute, requireEnv } from "./lib/env";
import {
  MAX_ACTIVE_KEYS_PER_USER,
  PLAYGROUND_TOKEN_TTL_MS,
  cleanKeyName,
  generateApiKey,
  generatePlaygroundToken,
  keyPrefix,
  maskedKey,
} from "./lib/keys";
import { requireUserId } from "./lib/session";
import { DAY_MS, utcDay, windowStart } from "./lib/time";

const environment = v.union(v.literal("live"), v.literal("test"));
const USAGE_LOOKBACK_DAYS = 30;

export type ApiKeySummary = {
  id: Id<"apiKeys">;
  name: string;
  maskedKey: string;
  environment: "live" | "test";
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  rateLimitPerMinute: number;
  requestsLast30Days: number;
  requestsThisMinute: number;
};

function summarize(key: Doc<"apiKeys">, requests: number, thisMinute: number): ApiKeySummary {
  return {
    id: key._id,
    name: key.name,
    maskedKey: maskedKey(key.keyPrefix),
    environment: key.environment,
    createdAt: key._creationTime,
    lastUsedAt: key.lastUsedAt ?? null,
    expiresAt: key.expiresAt ?? null,
    revokedAt: key.revokedAt ?? null,
    rateLimitPerMinute: key.rateLimitPerMinute ?? defaultRateLimitPerMinute(),
    requestsLast30Days: requests,
    requestsThisMinute: thisMinute,
  };
}

/** The signed-in developer's keys (active first), with live usage. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ApiKeySummary[]> => {
    const userId = await requireUserId(ctx);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    const since = utcDay(now - (USAGE_LOOKBACK_DAYS - 1) * DAY_MS);
    const daily = await ctx.db
      .query("usageDaily")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).gte("day", since))
      .collect();
    const totals = new Map<Id<"apiKeys">, number>();
    for (const row of daily) totals.set(row.apiKeyId, (totals.get(row.apiKeyId) ?? 0) + row.total);
    const currentWindow = windowStart(now);
    const summaries = await Promise.all(
      keys.map(async (key) => {
        const window = await ctx.db
          .query("rateLimitWindows")
          .withIndex("by_bucket_window", (q) => q.eq("bucket", `key:${key._id}`).eq("windowStart", currentWindow))
          .unique();
        return summarize(key, totals.get(key._id) ?? 0, window?.count ?? 0);
      }),
    );
    return summaries.sort((a, b) => {
      if ((a.revokedAt === null) !== (b.revokedAt === null)) return a.revokedAt === null ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },
});

export const ownedKey = internalQuery({
  args: { keyId: v.id("apiKeys"), userId: v.id("users") },
  handler: async (ctx, { keyId, userId }) => {
    const key = await ctx.db.get(keyId);
    return key !== null && key.userId === userId ? key : null;
  },
});

export const insertKey = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    keyPrefix: v.string(),
    keyHash: v.string(),
    environment,
  },
  handler: async (ctx, args) => {
    const active = (
      await ctx.db
        .query("apiKeys")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect()
    ).filter((key) => key.revokedAt === undefined);
    if (active.length >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new ConvexError(`You can have at most ${MAX_ACTIVE_KEYS_PER_USER} active API keys. Revoke one first.`);
    }
    return await ctx.db.insert("apiKeys", args);
  },
});

/** Creates a key. The secret is returned once and never stored. */
export const create = action({
  args: { name: v.string(), environment: v.optional(environment) },
  handler: async (ctx, args): Promise<{ id: Id<"apiKeys">; secret: string; maskedKey: string }> => {
    const userId = await requireUserId(ctx);
    const name = cleanName(args.name);
    const secret = generateApiKey(args.environment ?? "live");
    const prefix = keyPrefix(secret);
    const id: Id<"apiKeys"> = await ctx.runMutation(internal.apiKeys.insertKey, {
      userId,
      name,
      keyPrefix: prefix,
      keyHash: await hmacSha256Hex(requireEnv("API_KEY_PEPPER"), secret),
      environment: args.environment ?? "live",
    });
    return { id, secret, maskedKey: maskedKey(prefix) };
  },
});

function cleanName(name: string): string {
  try {
    return cleanKeyName(name);
  } catch (error) {
    throw new ConvexError((error as Error).message);
  }
}

async function requireOwnedKey(
  ctx: { db: { get: (id: Id<"apiKeys">) => Promise<Doc<"apiKeys"> | null> } },
  keyId: Id<"apiKeys">,
  userId: Id<"users">,
): Promise<Doc<"apiKeys">> {
  const key = await ctx.db.get(keyId);
  if (key === null || key.userId !== userId) throw new ConvexError("API key not found.");
  return key;
}

export const rename = mutation({
  args: { keyId: v.id("apiKeys"), name: v.string() },
  handler: async (ctx, { keyId, name }) => {
    const userId = await requireUserId(ctx);
    await requireOwnedKey(ctx, keyId, userId);
    await ctx.db.patch(keyId, { name: cleanName(name) });
  },
});

/** Revoking takes effect on the next request; it cannot be undone. */
export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const userId = await requireUserId(ctx);
    const key = await requireOwnedKey(ctx, keyId, userId);
    if (key.revokedAt === undefined) await ctx.db.patch(keyId, { revokedAt: Date.now() });
  },
});

export const replaceSecret = internalMutation({
  args: { keyId: v.id("apiKeys"), userId: v.id("users"), keyPrefix: v.string(), keyHash: v.string() },
  handler: async (ctx, { keyId, userId, keyPrefix: prefix, keyHash }) => {
    const key = await requireOwnedKey(ctx, keyId, userId);
    if (key.revokedAt !== undefined) throw new ConvexError("A revoked key cannot be regenerated.");
    await ctx.db.patch(keyId, { keyPrefix: prefix, keyHash });
  },
});

/** Issues a new secret for the same key. The old secret stops working at once;
 * name and usage history are kept. */
export const regenerate = action({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }): Promise<{ id: Id<"apiKeys">; secret: string; maskedKey: string }> => {
    const userId = await requireUserId(ctx);
    const key = await ctx.runQuery(internal.apiKeys.ownedKey, { keyId, userId });
    if (key === null) throw new ConvexError("API key not found.");
    const secret = generateApiKey(key.environment);
    const prefix = keyPrefix(secret);
    await ctx.runMutation(internal.apiKeys.replaceSecret, {
      keyId,
      userId,
      keyPrefix: prefix,
      keyHash: await hmacSha256Hex(requireEnv("API_KEY_PEPPER"), secret),
    });
    return { id: keyId, secret, maskedKey: maskedKey(prefix) };
  },
});

export const insertPlaygroundToken = internalMutation({
  args: { tokenHash: v.string(), apiKeyId: v.id("apiKeys"), userId: v.id("users"), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("playgroundTokens", args);
  },
});

/** A 15-minute token the docs playground uses to call /v1 with this key. */
export const createPlaygroundToken = action({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }): Promise<{ token: string; expiresAt: number }> => {
    const userId = await requireUserId(ctx);
    const key = await ctx.runQuery(internal.apiKeys.ownedKey, { keyId, userId });
    if (key === null) throw new ConvexError("API key not found.");
    if (key.revokedAt !== undefined) throw new ConvexError("A revoked key cannot be used in the playground.");
    const token = generatePlaygroundToken();
    const expiresAt = Date.now() + PLAYGROUND_TOKEN_TTL_MS;
    await ctx.runMutation(internal.apiKeys.insertPlaygroundToken, {
      tokenHash: await hmacSha256Hex(requireEnv("API_KEY_PEPPER"), token),
      apiKeyId: keyId,
      userId,
      expiresAt,
    });
    return { token, expiresAt };
  },
});
