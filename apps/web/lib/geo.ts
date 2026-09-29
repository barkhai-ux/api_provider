import { GeoClient } from "@geo-platform/api-client";
import { publicConfig } from "@/lib/config";

/**
 * Browser client for FastAPI's intentionally public, independently constrained
 * `/demo` surface. The URL is expected to be discoverable. No customer key,
 * ArcGIS credential or privileged header is present in browser traffic.
 */
export const siteGeoClient = new GeoClient({
  baseUrl: publicConfig.apiUrl,
  surface: "demo",
  timeoutMs: 10_000,
});
