import {
  getAuthSessionId,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { validatePassword } from "./auth";
import { currentUserId, isSessionActive, requireUserId } from "./lib/session";

const MAX_NAME_LENGTH = 120;

/** The signed-in developer, or null. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    return {
      id: user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      createdAt: user._creationTime,
    };
  },
});

export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx);
    const cleaned = name.trim();
    if (cleaned.length === 0 || cleaned.length > MAX_NAME_LENGTH) {
      throw new ConvexError(`Name must be 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    await ctx.db.patch(userId, { name: cleaned, updatedAt: Date.now() });
  },
});

/** Used by requireUserId in actions, which cannot read the database directly. */
export const sessionIsActive = internalQuery({
  args: { userId: v.id("users"), sessionId: v.id("authSessions") },
  handler: async (ctx, { userId, sessionId }) => await isSessionActive(ctx.db, userId, sessionId),
});

/** The password account's identifier (the normalized email it was created with). */
export const passwordAccountId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .unique();
    return account?.providerAccountId ?? null;
  },
});

/** Changes the password and signs out every other session. */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await requireUserId(ctx);
    const email = await ctx.runQuery(internal.users.passwordAccountId, { userId });
    if (email === null) throw new ConvexError("Account not found.");
    validatePassword(newPassword, email);
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: email, secret: currentPassword } });
    } catch {
      throw new ConvexError("The current password is incorrect.");
    }
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: newPassword } });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
  },
});
