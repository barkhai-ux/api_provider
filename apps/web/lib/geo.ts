import { GeoClient } from "@geo-platform/api-client";

/**
 * Browser client for the website's own API proxy (/api/v1/* on this origin).
 * The proxy adds the site key on the server, so no key is needed here.
 *
 * The proxy also requires a per-session token (see lib/geo-token.ts). The token
 * is set once the page has loaded (GeoTokenProvider) and sent on every request
 * through the custom fetch below; requests made before it is set omit it and
 * are refused, which only happens in the brief moment before the provider runs.
 */
let geoToken: string | undefined;

/** Sets the token the proxy requires; called by GeoTokenProvider. */
export function setGeoToken(token: string | undefined): void {
  geoToken = token;
}

const geoFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (geoToken) headers.set("x-geo-token", geoToken);
  return fetch(input, { ...init, headers });
};

export const siteGeoClient = new GeoClient({ baseUrl: "/api", timeoutMs: 20_000, fetch: geoFetch });
