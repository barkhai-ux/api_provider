export const PLAN_PRICE_MNT = 1_000;
// Wire's QPay QR places this integer directly in its MNT amount field.
export const PLAN_WIRE_AMOUNT = PLAN_PRICE_MNT;
export const PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FREE_TOTAL_REQUESTS = 500;
export const FREE_RATE_LIMIT_PER_MINUTE = 30;

export const PAID_PLANS = {
  starter: { monthlyRequests: 10_000, requestsPerMinute: 100 },
  essentials: { monthlyRequests: 100_000, requestsPerMinute: 500 },
  pro: { monthlyRequests: 500_000, requestsPerMinute: 2_000 },
} as const;

export type PaidPlan = keyof typeof PAID_PLANS;

export function activePlan(user: { plan?: PaidPlan; planExpiresAt?: number }, now = Date.now()): PaidPlan | null {
  return user.plan && user.planExpiresAt && user.planExpiresAt > now ? user.plan : null;
}

export function freeRequestsRemaining(user: { freeTierActivatedAt?: number; freeRequestsUsed?: number }): number {
  return user.freeTierActivatedAt === undefined ? 0 : Math.max(0, FREE_TOTAL_REQUESTS - (user.freeRequestsUsed ?? 0));
}

export function hasKeyAccess(
  user: { plan?: PaidPlan; planExpiresAt?: number; freeTierActivatedAt?: number; freeRequestsUsed?: number },
  now = Date.now(),
): boolean {
  return activePlan(user, now) !== null || freeRequestsRemaining(user) > 0;
}
