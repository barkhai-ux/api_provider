/** Choices offered when creating an API key: endpoints and expiry. */

export const KEY_ENDPOINTS = [
  { id: "geocode", label: "Geocoding", shortLabel: "Geocoding", path: "/v1/geocode" },
  { id: "route", label: "Routing", shortLabel: "Routing", path: "/v1/route" },
] as const;
export type KeyEndpoint = (typeof KEY_ENDPOINTS)[number]["id"];
export const KEY_ENDPOINT_IDS = KEY_ENDPOINTS.map((endpoint) => endpoint.id) as [KeyEndpoint, ...KeyEndpoint[]];

export const EXPIRY_CHOICES = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "custom", label: "Custom date" },
  { value: "never", label: "Never" },
] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]["value"];
export const EXPIRY_CHOICE_VALUES = EXPIRY_CHOICES.map((choice) => choice.value) as [ExpiryChoice, ...ExpiryChoice[]];
export const DEFAULT_EXPIRY: ExpiryChoice = "90";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches MAX_KEY_LIFETIME_MS in convex/lib/keys.ts. */
export const MAX_EXPIRY_YEARS = 5;

/** "YYYY-MM-DD" for a date in the user's time zone (the format of <input type="date">). */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The end of a "YYYY-MM-DD" day in the user's time zone, or null if malformed. */
export function endOfDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return date.getMonth() === month - 1 ? date.getTime() : null;
}

/** Earliest and latest dates the custom-date picker accepts. */
export function customDateBounds(now: number): { min: string; max: string } {
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + MAX_EXPIRY_YEARS);
  max.setDate(max.getDate() - 1);
  return { min: toDateInputValue(new Date(now + DAY_MS)), max: toDateInputValue(max) };
}

/** When a key created now with this choice expires (Unix ms), or null for never. */
export function expiresAtFor(choice: ExpiryChoice, customDate: string, now: number): number | null {
  if (choice === "never") return null;
  if (choice === "custom") return endOfDay(customDate);
  return now + Number(choice) * DAY_MS;
}
