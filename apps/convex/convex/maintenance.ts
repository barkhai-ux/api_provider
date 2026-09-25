import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { usageRetentionDays } from "./lib/env";
import { DAY_MS, MINUTE_MS } from "./lib/time";

const BATCH = 1000;

/** Deletes expired rate-limit windows, playground tokens and old raw request
 * rows. Daily rollups (usageDaily) are kept. Runs from crons.ts. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const windows = await ctx.db
      .query("rateLimitWindows")
      .withIndex("by_window", (q) => q.lt("windowStart", now - 5 * MINUTE_MS))
      .take(BATCH);
    for (const doc of windows) await ctx.db.delete(doc._id);

    const tokens = await ctx.db
      .query("playgroundTokens")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(BATCH);
    for (const doc of tokens) await ctx.db.delete(doc._id);

    const requests = await ctx.db
      .query("apiRequests")
      .withIndex("by_time", (q) => q.lt("timestamp", now - usageRetentionDays() * DAY_MS))
      .take(BATCH);
    for (const doc of requests) await ctx.db.delete(doc._id);

    // A full batch means more is waiting: continue right away instead of
    // waiting for the next cron run, so retention holds at any volume.
    if (windows.length === BATCH || tokens.length === BATCH || requests.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.maintenance.prune, {});
    }
    return { windows: windows.length, tokens: tokens.length, requests: requests.length };
  },
});
