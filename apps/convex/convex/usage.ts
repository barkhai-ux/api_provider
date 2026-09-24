import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { defaultRateLimitPerMinute } from "./lib/env";
import { requireUserId } from "./lib/session";
import { DAY_MS, utcDay, utcMonthStartDay } from "./lib/time";

const MAX_SERIES_DAYS = 90;

type Counts = { total: number; successful: number; failed: number };
const empty = (): Counts => ({ total: 0, successful: 0, failed: 0 });

/** Dashboard headline numbers. Days and months are UTC. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const today = utcDay(now);
    const rows = await ctx.db
      .query("usageDaily")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).gte("day", utcMonthStartDay(now)))
      .collect();
    const todayCounts = empty();
    const monthCounts = empty();
    for (const row of rows) {
      for (const target of row.day === today ? [todayCounts, monthCounts] : [monthCounts]) {
        target.total += row.total;
        target.successful += row.successful;
        target.failed += row.failed;
      }
    }
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const active = keys.filter((key) => key.revokedAt === undefined);
    return {
      today: todayCounts,
      month: monthCounts,
      rateLimitPerMinute: defaultRateLimitPerMinute(),
      activeKeys: active.length,
      totalKeys: keys.length,
    };
  },
});

/** Requests per UTC day (successful vs failed) for the last `days` days. */
export const daily = query({
  args: { days: v.number(), keyId: v.optional(v.id("apiKeys")) },
  handler: async (ctx, { days, keyId }) => {
    const userId = await requireUserId(ctx);
    const span = Math.min(Math.max(1, Math.floor(days)), MAX_SERIES_DAYS);
    const now = Date.now();
    const start = now - (span - 1) * DAY_MS;
    const rows = await ctx.db
      .query("usageDaily")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).gte("day", utcDay(start)))
      .collect();
    const byDay = new Map<string, Counts>();
    for (const row of rows) {
      if (keyId !== undefined && row.apiKeyId !== keyId) continue;
      const counts = byDay.get(row.day) ?? empty();
      counts.total += row.total;
      counts.successful += row.successful;
      counts.failed += row.failed;
      byDay.set(row.day, counts);
    }
    return Array.from({ length: span }, (_, i) => {
      const day = utcDay(start + i * DAY_MS);
      return { day, ...(byDay.get(day) ?? empty()) };
    });
  },
});

/** Totals and average latency per endpoint for the last `days` days. */
export const endpoints = query({
  args: { days: v.number(), keyId: v.optional(v.id("apiKeys")) },
  handler: async (ctx, { days, keyId }) => {
    const userId = await requireUserId(ctx);
    const span = Math.min(Math.max(1, Math.floor(days)), MAX_SERIES_DAYS);
    const rows = await ctx.db
      .query("usageDaily")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).gte("day", utcDay(Date.now() - (span - 1) * DAY_MS)))
      .collect();
    const byEndpoint = new Map<string, Counts & { totalResponseTimeMs: number }>();
    for (const row of rows) {
      if (keyId !== undefined && row.apiKeyId !== keyId) continue;
      const current = byEndpoint.get(row.endpoint) ?? { ...empty(), totalResponseTimeMs: 0 };
      current.total += row.total;
      current.successful += row.successful;
      current.failed += row.failed;
      current.totalResponseTimeMs += row.totalResponseTimeMs;
      byEndpoint.set(row.endpoint, current);
    }
    return [...byEndpoint.entries()]
      .map(([endpoint, c]) => ({
        endpoint,
        total: c.total,
        successful: c.successful,
        failed: c.failed,
        avgResponseTimeMs: c.total ? Math.round(c.totalResponseTimeMs / c.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  },
});

/** Most recent requests, newest first (paginated). */
export const recent = query({
  args: { paginationOpts: paginationOptsValidator, keyId: v.optional(v.id("apiKeys")) },
  handler: async (ctx, { paginationOpts, keyId }) => {
    const userId = await requireUserId(ctx);
    const page =
      keyId !== undefined
        ? await ctx.db
            .query("apiRequests")
            .withIndex("by_key_time", (q) => q.eq("apiKeyId", keyId))
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("apiRequests")
            .withIndex("by_user_time", (q) => q.eq("userId", userId))
            .order("desc")
            .paginate(paginationOpts);
    const names = new Map<Id<"apiKeys">, string>();
    const rows = [];
    for (const request of page.page) {
      if (request.userId !== userId) continue;
      if (!names.has(request.apiKeyId)) {
        names.set(request.apiKeyId, (await ctx.db.get(request.apiKeyId))?.name ?? "Deleted key");
      }
      rows.push({
        id: request._id,
        keyName: names.get(request.apiKeyId)!,
        endpoint: request.endpoint,
        method: request.method,
        statusCode: request.statusCode,
        responseTimeMs: request.responseTimeMs,
        timestamp: request.timestamp,
      });
    }
    return { ...page, page: rows };
  },
});
