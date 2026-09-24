import "server-only";

/**
 * Server-only configuration, read at request time so one Docker image works in
 * every environment. Never import this from client components.
 */
export function serverEnv() {
  return {
    /** The API gateway as reachable from the Next.js server. */
    apiInternalUrl: (process.env.API_INTERNAL_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
    /** The website's own API key, used only by the /api/v1 proxy. */
    siteApiKey: process.env.SITE_API_KEY ?? "",
    /** Convex as reachable from the Next.js server (may differ from the browser URL). */
    convexUrl:
      process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210",
  };
}
