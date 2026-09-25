/** API key format shared by creation (here) and verification (API gateway). */

import { randomString } from "./crypto";
import { API_ENDPOINTS, type ApiEndpoint } from "./endpoints";

export const KEY_PREFIX = "geo_";
export const KEY_SECRET_LENGTH = 32;
export const KEY_VISIBLE_CHARS = 4;
export const PLAYGROUND_TOKEN_PREFIX = "geo_pt_";
export const PLAYGROUND_TOKEN_LENGTH = 40;
export const MASK = "••••••••••••";
export const MAX_ACTIVE_KEYS_PER_USER = 25;
/** Active plus revoked keys; bounds what every key listing has to read. */
export const MAX_TOTAL_KEYS_PER_USER = 200;
/** Unexpired playground tokens kept per key; older ones are deleted. */
export const MAX_PLAYGROUND_TOKENS_PER_KEY = 5;
export const MAX_KEY_NAME_LENGTH = 100;
export const PLAYGROUND_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Expiry must be at least this far ahead, and at most MAX_KEY_LIFETIME_MS. */
export const MIN_KEY_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_KEY_LIFETIME_MS = 5 * 366 * 24 * 60 * 60 * 1000;

// Keys created before keys had a single type start with geo_live_ or geo_test_;
// they keep working.
const LEGACY_TYPE_PREFIX = /^geo_(?:live_|test_)?/;

export function generateApiKey(): string {
  return KEY_PREFIX + randomString(KEY_SECRET_LENGTH);
}

export function generatePlaygroundToken(): string {
  return PLAYGROUND_TOKEN_PREFIX + randomString(PLAYGROUND_TOKEN_LENGTH);
}

export function keyPrefix(secret: string): string {
  const head = LEGACY_TYPE_PREFIX.exec(secret)?.[0] ?? "";
  return secret.slice(0, head.length + KEY_VISIBLE_CHARS);
}

export function maskedKey(prefix: string): string {
  return prefix + MASK;
}

export function isValidApiKey(secret: string): boolean {
  return /^geo_(?:(?:live|test)_)?[A-Za-z0-9]{32}$/.test(secret);
}

export function cleanKeyName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > MAX_KEY_NAME_LENGTH) {
    throw new Error(`Key name must be 1 to ${MAX_KEY_NAME_LENGTH} characters.`);
  }
  return cleaned;
}

/** Validates the endpoints chosen for a key: at least one, no duplicates, in a stable order. */
export function cleanEndpoints(endpoints: readonly string[]): ApiEndpoint[] {
  const chosen = API_ENDPOINTS.filter((endpoint) => endpoints.includes(endpoint));
  if (chosen.length === 0) throw new Error("Choose at least one endpoint for the key.");
  return chosen;
}

/** Validates an expiry time (Unix ms), or null for a key that never expires. */
export function cleanExpiresAt(expiresAt: number | null, now: number): number | null {
  if (expiresAt === null) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < now + MIN_KEY_LIFETIME_MS) {
    throw new Error("The expiry date must be in the future.");
  }
  if (expiresAt > now + MAX_KEY_LIFETIME_MS) throw new Error("The expiry date can be at most 5 years ahead.");
  return Math.floor(expiresAt);
}
