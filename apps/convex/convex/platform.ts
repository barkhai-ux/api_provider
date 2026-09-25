/**
 * Deployment-time setup, run by apps/convex/scripts/deploy.sh:
 *   npx convex run platform:ensureSiteKey      (every environment)
 *   npx convex run platform:seedDevelopment    (development only)
 */
import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { hmacSha256Hex } from "./lib/crypto";
import { isProduction, requireEnv } from "./lib/env";
import { isValidApiKey, keyPrefix } from "./lib/keys";

const SYSTEM_EMAIL = "platform@system.internal";
const SITE_KEY_NAME = "Website (public map)";
const DEMO_KEY_NAME = "Development key";

export const userByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first(),
});

export const upsertSystemUser = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    // Found by the isSystem flag, never by email: sign-up cannot set that flag,
    // so a user who registered the system address cannot become the owner.
    const system = await ctx.db
      .query("users")
      .withIndex("by_system", (q) => q.eq("isSystem", true))
      .first();
    if (system) return system._id;
    const impostor = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", SYSTEM_EMAIL))
      .first();
    if (impostor) {
      throw new Error(
        `A regular account uses the reserved address ${SYSTEM_EMAIL} (user ${impostor._id}). ` +
          "Investigate and disable it (admin:disableUser) before registering the site key.",
      );
    }
    // No authAccounts row: this account cannot sign in.
    return await ctx.db.insert("users", { email: SYSTEM_EMAIL, name: "Ubhub Location Service", isSystem: true });
  },
});

export const upsertKey = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    isSiteKey: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (existing === null) {
      await ctx.db.insert("apiKeys", args);
    } else if (existing.revokedAt !== undefined || existing.userId !== args.userId) {
      throw new Error(`Key "${args.name}" exists but is revoked or owned by another account; choose a new secret.`);
    }
    if (args.isSiteKey) {
      // A rotated SITE_API_KEY replaces the previous site key.
      const others = await ctx.db
        .query("apiKeys")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      for (const key of others) {
        if (key.isSiteKey && key.keyHash !== args.keyHash && key.revokedAt === undefined) {
          await ctx.db.patch(key._id, { revokedAt: Date.now() });
        }
      }
    }
  },
});

/** Registers the website's server-side key (SITE_API_KEY) under the system account. */
export const ensureSiteKey = internalAction({
  args: {},
  handler: async (ctx) => {
    // Always create the system account first, so its address is taken even
    // when no site key is configured yet.
    const userId = await ctx.runMutation(internal.platform.upsertSystemUser, {});
    const secret = process.env.SITE_API_KEY;
    if (!secret) return { siteKey: "not configured" };
    if (!isValidApiKey(secret)) throw new Error("SITE_API_KEY must look like geo_ followed by 32 letters/digits.");
    await ctx.runMutation(internal.platform.upsertKey, {
      userId,
      name: SITE_KEY_NAME,
      keyHash: await hmacSha256Hex(requireEnv("API_KEY_PEPPER"), secret),
      keyPrefix: keyPrefix(secret),
      isSiteKey: true,
    });
    return { siteKey: "ok" };
  },
});

/**
 * DEVELOPMENT ONLY. Creates demo@example.com (DEMO_EMAIL / DEMO_PASSWORD) and a
 * development API key (DEMO_API_KEY). Refuses to run in production.
 */
export const seedDevelopment = internalAction({
  args: {},
  handler: async (ctx) => {
    if (isProduction()) throw new Error("Refusing to seed development data in production.");
    const email = (process.env.DEMO_EMAIL ?? "demo@example.com").toLowerCase();
    const password = requireEnv("DEMO_PASSWORD");
    const apiKey = requireEnv("DEMO_API_KEY");
    if (!isValidApiKey(apiKey)) throw new Error("DEMO_API_KEY must look like geo_ followed by 32 letters/digits.");

    let user = await ctx.runQuery(internal.platform.userByEmail, { email });
    if (user === null) {
      const created = await createAccount(ctx, {
        provider: "password",
        account: { id: email, secret: password },
        profile: { email, name: "Demo Developer", updatedAt: Date.now() },
      });
      user = created.user;
    }
    await ctx.runMutation(internal.platform.upsertKey, {
      userId: user._id,
      name: DEMO_KEY_NAME,
      keyHash: await hmacSha256Hex(requireEnv("API_KEY_PEPPER"), apiKey),
      keyPrefix: keyPrefix(apiKey),
      isSiteKey: false,
    });
    return { demoUser: email };
  },
});
