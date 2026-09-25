/** Deployment environment variables (set with `npx convex env set`). */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing Convex environment variable ${name}`);
  }
  return value;
}

export function isProduction(): boolean {
  // Only an explicit "development" or "test" enables dev-only paths (console
  // email, demo seeding). Anything else, including a typo or no value, counts
  // as production, so they fail closed.
  const environment = (process.env.ENVIRONMENT ?? "").trim().toLowerCase();
  return environment !== "development" && environment !== "test";
}

export function defaultRateLimitPerMinute(): number {
  const value = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "100");
  return Number.isFinite(value) && value > 0 ? value : 100;
}

/** Requests per minute across all keys of one account (not the site key). */
export function accountRateLimitPerMinute(): number {
  const value = Number(process.env.ACCOUNT_RATE_LIMIT_PER_MINUTE ?? "300");
  return Number.isFinite(value) && value > 0 ? value : 300;
}

/** Routing is the most expensive endpoint: its own, lower per-minute limit. */
export function routeRateLimitPerMinute(): number {
  const value = Number(process.env.ROUTE_RATE_LIMIT_PER_MINUTE ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function usageRetentionDays(): number {
  const value = Number(process.env.USAGE_RETENTION_DAYS ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}
