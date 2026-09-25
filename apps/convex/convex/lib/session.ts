import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";

type AnyCtx = QueryCtx | ActionCtx;

/**
 * Whether a session may still be used: it exists (sign-out and password
 * changes delete sessions), belongs to the user, has not expired, and the
 * account is not disabled. Access tokens are JWTs valid for up to an hour, so
 * without this check they would outlive sign-out.
 */
export async function isSessionActive(
  db: QueryCtx["db"],
  userId: Id<"users">,
  sessionId: Id<"authSessions">,
): Promise<boolean> {
  const session = await db.get(sessionId);
  if (session === null || session.userId !== userId || session.expirationTime <= Date.now()) return false;
  const user = await db.get(userId);
  return user !== null && user.disabledAt === undefined && user.isSystem !== true;
}

/** The signed-in user, or null when signed out or the session is no longer active. */
export async function currentUserId(ctx: AnyCtx): Promise<Id<"users"> | null> {
  const [userId, sessionId] = await Promise.all([getAuthUserId(ctx), getAuthSessionId(ctx)]);
  if (userId === null || sessionId === null) return null;
  const active =
    "db" in ctx
      ? await isSessionActive(ctx.db, userId, sessionId)
      : await ctx.runQuery(internal.users.sessionIsActive, { userId, sessionId });
  return active ? userId : null;
}

export async function requireUserId(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await currentUserId(ctx);
  if (userId === null) {
    throw new ConvexError("You need to sign in.");
  }
  return userId;
}
