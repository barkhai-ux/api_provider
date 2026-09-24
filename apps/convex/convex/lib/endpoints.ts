import { v } from "convex/values";

/** Public endpoints a key can be allowed to call (the /v1 path without the prefix). */
export const API_ENDPOINTS = ["geocode", "reverse-geocode", "route"] as const;
export type ApiEndpoint = (typeof API_ENDPOINTS)[number];

export const apiEndpointValidator = v.union(
  v.literal("geocode"),
  v.literal("reverse-geocode"),
  v.literal("route"),
);
