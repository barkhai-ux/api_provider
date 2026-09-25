import { v } from "convex/values";

/** Public endpoints a key can be allowed to call (the /v1 path without the prefix).
 * Forward and reverse geocoding are one service ("geocode"). */
export const API_ENDPOINTS = ["geocode", "route"] as const;
export type ApiEndpoint = (typeof API_ENDPOINTS)[number];

/** Values accepted for a key's endpoints on create and in the gateway. */
export const apiEndpointValidator = v.union(v.literal("geocode"), v.literal("route"));

/** Stored values, which may include the legacy "reverse-geocode" from keys made
 * before geocoding and reverse geocoding were merged. Read with normalizeEndpoint. */
export const storedEndpointValidator = v.union(
  v.literal("geocode"),
  v.literal("reverse-geocode"),
  v.literal("route"),
);

/** Legacy "reverse-geocode" now means "geocode"; everything else is unchanged. */
export function normalizeEndpoint(endpoint: string): ApiEndpoint | null {
  if (endpoint === "reverse-geocode") return "geocode";
  return (API_ENDPOINTS as readonly string[]).includes(endpoint) ? (endpoint as ApiEndpoint) : null;
}

/** A key's stored endpoints as the current set: legacy values folded in, deduped. */
export function normalizeEndpoints(endpoints: readonly string[]): ApiEndpoint[] {
  const out = new Set<ApiEndpoint>();
  for (const endpoint of endpoints) {
    const normalized = normalizeEndpoint(endpoint);
    if (normalized !== null) out.add(normalized);
  }
  return API_ENDPOINTS.filter((endpoint) => out.has(endpoint));
}
