/** Deployment environment variables (set with `npx convex env set`). */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing Convex environment variable ${name}`);
  }
  return value;
}

export function isProduction(): boolean {
  // A missing ENVIRONMENT counts as production, so dev-only paths fail closed.
  return (process.env.ENVIRONMENT ?? "production") === "production";
}

export function defaultRateLimitPerMinute(): number {
  const value = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "100");
  return Number.isFinite(value) && value > 0 ? value : 100;
}

export function usageRetentionDays(): number {
  const value = Number(process.env.USAGE_RETENTION_DAYS ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}
