import { GeoClient } from "@geo-platform/api-client";

/**
 * Browser client for the website's own API proxy (/api/v1/* on this origin).
 * The proxy adds the site key on the server, so no key is needed here.
 */
export const siteGeoClient = new GeoClient({ baseUrl: "/api", timeoutMs: 20_000 });
