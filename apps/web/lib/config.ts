/**
 * Public (browser-safe) configuration. NEXT_PUBLIC_* values are inlined at
 * build time, so set them as Docker build args.
 */
export const publicConfig = {
  /** Public API origin shown in docs and called by the playground. */
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
  /** Convex deployment the developer console connects to. */
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210",
  /** MapLibre style for the basemap. */
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/styles/root.json",
} as const;

export const siteConfig = {
  name: "Ubhub Location Service",
  description: "Geocoding, reverse geocoding and routing APIs for Mongolia.",
  /** Where the map opens: central Ulaanbaatar. */
  defaultCenter: [106.9177, 47.9184] as [number, number],
  defaultZoom: 12,
} as const;
