/** UTC calendar helpers. Usage days and months are always UTC. */

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function utcMonthStartDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 8) + "01";
}

export function windowStart(timestamp: number, windowMs: number = MINUTE_MS): number {
  return Math.floor(timestamp / windowMs) * windowMs;
}
