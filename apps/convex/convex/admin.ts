/**
 * Operator functions for incident response. All are internal: run them with
 * the Convex CLI against the affected deployment, for example
 *
 *   npx convex run --prod admin:disableUser '{"email":"someone@example.com"}'
 *   npx convex run --prod admin:revokeKey '{"keyId":"<id>"}'
 *
 * See docs/security/incident-response.md.
 */
import { invalidateSessions } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { deletePlaygroundTokens } from "./apiKeys";

export const findUser = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (user === null) return null;
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return {
      id: user._id,
      email: user.email,
      disabledAt: user.disabledAt ?? null,
      isSystem: user.isSystem === true,
      keys: keys.map((key) => ({
        id: key._id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        revokedAt: key.revokedAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      })),
    };
  },
});

/** Revokes one key (any owner) and its playground tokens. */
export const revokeKey = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get(keyId);
    if (key === null) throw new Error("No such key.");
    if (key.revokedAt === undefined) await ctx.db.patch(keyId, { revokedAt: Date.now() });
    await deletePlaygroundTokens(ctx, keyId);
    return { revoked: keyId };
  },
});

export const lockUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("No such user.");
    if (user.isSystem === true) throw new Error("Refusing to disable the system account; rotate SITE_API_KEY instead.");
    const now = Date.now();
    await ctx.db.patch(userId, { disabledAt: now });
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const key of keys) {
      if (key.revokedAt === undefined) await ctx.db.patch(key._id, { revokedAt: now });
      await deletePlaygroundTokens(ctx, key._id);
    }
    return { revokedKeys: keys.filter((key) => key.revokedAt === undefined).length };
  },
});

/**
 * Locks an account: revokes all its keys and playground tokens, ends every
 * session, and refuses its sign-ins and dashboard access from then on.
 */
export const disableUser = internalAction({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ userId: Id<"users">; revokedKeys: number }> => {
    const user = await ctx.runQuery(internal.admin.findUser, { email });
    if (user === null) throw new Error("No user with that email.");
    const { revokedKeys } = await ctx.runMutation(internal.admin.lockUser, { userId: user.id });
    await invalidateSessions(ctx, { userId: user.id });
    return { userId: user.id, revokedKeys };
  },
});

/** Unlocks an account. Its revoked keys stay revoked; the owner creates new ones. */
export const enableUser = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (user === null) throw new Error("No user with that email.");
    await ctx.db.patch(user._id, { disabledAt: undefined });
    return { userId: user._id };
  },
});
