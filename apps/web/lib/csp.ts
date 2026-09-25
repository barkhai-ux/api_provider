/**
 * Content-Security-Policy for pages, built per request with a fresh nonce
 * (see proxy.ts). Scripts run only if they carry the nonce or are loaded by a
 * script that does ('strict-dynamic'): an injected <script> or inline event
 * handler does not run even if some HTML injection slipped through.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";
const mapStyleUrl =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/styles/root.json";

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const convexOrigin = origin(convexUrl);
// Only exact origins: the API (playground), Convex (HTTPS + WebSocket) and the
// map style host (style, tiles, sprites and glyphs).
const connectSources = [
  "'self'",
  origin(apiUrl),
  convexOrigin,
  convexOrigin.replace(/^http/, "ws"),
  origin(mapStyleUrl),
  ...(process.env.CSP_EXTRA_CONNECT_SRC ?? "").split(/\s+/),
].filter(Boolean);

export function contentSecurityPolicy(nonce: string, { development = false, https = false } = {}): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in development, where React uses eval for error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Styles: React style attributes, MapLibre and toasts set inline styles,
    // which cannot carry a nonce. Style injection cannot run script.
    "style-src 'self' 'unsafe-inline'",
    // MapLibre builds sprites from blobs; the style host serves any images.
    `img-src 'self' data: blob: ${origin(mapStyleUrl)}`.trim(),
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    // MapLibre runs its worker from /maplibre and decodes tiles in blob: workers.
    "worker-src 'self' blob:",
    "child-src blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Only when the page itself is served over HTTPS: on plain-HTTP hosts
    // (local runs) it would rewrite same-site requests to an https:// that
    // does not exist.
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
