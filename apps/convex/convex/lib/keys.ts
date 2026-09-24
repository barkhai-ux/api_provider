/** API key format shared by creation (here) and verification (API gateway). */

import { randomString } from "./crypto";

export type KeyEnvironment = "live" | "test";

export const KEY_SECRET_LENGTH = 32;
export const KEY_VISIBLE_CHARS = 4;
export const PLAYGROUND_TOKEN_PREFIX = "geo_pt_";
export const PLAYGROUND_TOKEN_LENGTH = 40;
export const MASK = "••••••••••••";
export const MAX_ACTIVE_KEYS_PER_USER = 25;
export const MAX_KEY_NAME_LENGTH = 100;
export const PLAYGROUND_TOKEN_TTL_MS = 15 * 60 * 1000;

export function generateApiKey(environment: KeyEnvironment): string {
  return `geo_${environment}_${randomString(KEY_SECRET_LENGTH)}`;
}

export function generatePlaygroundToken(): string {
  return PLAYGROUND_TOKEN_PREFIX + randomString(PLAYGROUND_TOKEN_LENGTH);
}

export function keyPrefix(secret: string): string {
  const environmentPrefix = secret.slice(0, secret.indexOf("_", 4) + 1);
  return secret.slice(0, environmentPrefix.length + KEY_VISIBLE_CHARS);
}

export function maskedKey(prefix: string): string {
  return prefix + MASK;
}

export function isValidApiKey(secret: string): boolean {
  return /^geo_(live|test)_[A-Za-z0-9]{32}$/.test(secret);
}

export function cleanKeyName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > MAX_KEY_NAME_LENGTH) {
    throw new Error(`Key name must be 1 to ${MAX_KEY_NAME_LENGTH} characters.`);
  }
  return cleaned;
}
