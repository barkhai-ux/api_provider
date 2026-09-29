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

/** Default ceiling for one key calling one endpoint. */
export function endpointRateLimitPerMinute(): number {
  const value = Number(process.env.ENDPOINT_RATE_LIMIT_PER_MINUTE ?? "100");
  return Number.isFinite(value) && value > 0 ? value : 100;
}

/** Emergency capacity ceiling across all authenticated customer traffic. */
export function globalRateLimitPerMinute(): number {
  const value = Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE ?? "100000");
  return Number.isFinite(value) && value > 0 ? value : 100_000;
}

/** Routing is the most expensive endpoint: its own, lower per-minute limit. */
export function routeRateLimitPerMinute(): number {
  const value = Number(process.env.ROUTE_RATE_LIMIT_PER_MINUTE ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

export function keyDailyQuotaUnits(): number {
  return positiveInt("KEY_DAILY_QUOTA_UNITS", 10_000);
}

export function keyMonthlyQuotaUnits(): number {
  return positiveInt("KEY_MONTHLY_QUOTA_UNITS", 100_000);
}

export function tenantDailyQuotaUnits(): number {
  return positiveInt("TENANT_DAILY_QUOTA_UNITS", 25_000);
}

export function tenantMonthlyQuotaUnits(): number {
  return positiveInt("TENANT_MONTHLY_QUOTA_UNITS", 250_000);
}

export function endpointMonthlyQuotaUnits(): number {
  return positiveInt("ENDPOINT_MONTHLY_QUOTA_UNITS", 100_000);
}

export function endpointCost(endpoint: string | undefined): number {
  return endpoint === "route" ? positiveInt("ROUTE_COST_UNITS", 5) : 1;
}

export function usageRetentionDays(): number {
  const value = Number(process.env.USAGE_RETENTION_DAYS ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function auditRetentionDays(): number {
  return positiveInt("AUDIT_RETENTION_DAYS", 365);
}
