/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

export const PEPPER = "test-pepper-0123456789abcdefghijklmnopqrstuvwxyz";
export const GATEWAY_SECRET = "test-gateway-secret-0123456789abcdefghijklmnop";

const modules = import.meta.glob("../convex/**/*.ts");

export function setup() {
  process.env.API_KEY_PEPPER = PEPPER;
  process.env.GATEWAY_SECRET = GATEWAY_SECRET;
  process.env.ENVIRONMENT = "test";
  delete process.env.GATEWAY_SECRET_PREVIOUS;
  delete process.env.ACCOUNT_RATE_LIMIT_PER_MINUTE;
  delete process.env.ENDPOINT_RATE_LIMIT_PER_MINUTE;
  delete process.env.GLOBAL_RATE_LIMIT_PER_MINUTE;
  delete process.env.ROUTE_RATE_LIMIT_PER_MINUTE;
  delete process.env.KEY_DAILY_QUOTA_UNITS;
  delete process.env.KEY_MONTHLY_QUOTA_UNITS;
  delete process.env.TENANT_DAILY_QUOTA_UNITS;
  delete process.env.TENANT_MONTHLY_QUOTA_UNITS;
  delete process.env.ENDPOINT_MONTHLY_QUOTA_UNITS;
  delete process.env.ROUTE_COST_UNITS;
  return convexTest(schema, modules);
}

export type Harness = ReturnType<typeof setup>;

/** A user with a live session, and a client that acts as that user. */
export async function signedInUser(t: Harness, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email.split("@")[0] });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return { userId, sessionId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

export async function signedInPaidUser(t: Harness, email: string) {
  const user = await signedInUser(t, email);
  await t.run((ctx) => ctx.db.patch(user.userId, {
    plan: "starter", planExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }));
  return user;
}

export async function insertKey(
  t: Harness,
  userId: Id<"users">,
  fields: { keyHash?: string; endpoints?: ("geocode" | "reverse-geocode" | "route")[]; expiresAt?: number; rateLimitPerMinute?: number; isSiteKey?: boolean } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("apiKeys", {
      userId,
      name: "Key",
      keyPrefix: "geo_abcd",
      keyHash: fields.keyHash ?? crypto.randomUUID().replace(/-/g, "").padEnd(64, "0"),
      ...fields,
    }),
  );
}
