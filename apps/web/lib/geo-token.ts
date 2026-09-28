import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-session tokens that gate the public map's API proxy (/api/v1/*).
 *
 * A token is minted only while a page is server-rendered (see app/layout.tsx)
 * and embedded in that response; there is no endpoint that mints one from
 * nothing. A bare request to the proxy therefore has no token and is refused,
 * so the endpoint cannot simply be called by anyone who discovers its URL.
 *
 * The token is an HMAC over `<exp>.<hardExp>.<nonce>`:
 *  - exp: the token stops working after this (short, ~15 min).
 *  - hardExp: the session may be refreshed (see /api/geo/token) only up to
 *    here (~2 h); after that the page must be loaded again. This caps how long
 *    one scraped token can be kept alive by refreshing it.
 *
 * The secret is GEO_TOKEN_SECRET, or the site key when that is unset (the site
 * key is already required for the proxy to work at all, so a working
 * deployment always has a secret). It never leaves the server.
 */
const TOKEN_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 2 * 60 * 60_000;

export interface GeoToken {
  token: string;
  /** Epoch ms when the token stops working; the client refreshes before this. */
  expiresAt: number;
}

interface Claims {
  exp: number;
  hardExp: number;
}

function secret(): string {
  return process.env.GEO_TOKEN_SECRET?.trim() || process.env.SITE_API_KEY?.trim() || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function assemble(exp: number, hardExp: number): string {
  const nonce = randomBytes(9).toString("base64url");
  const payload = `${exp}.${hardExp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/** A fresh token for a new page load, with a new refresh window. */
export function mintGeoToken(now = Date.now()): GeoToken {
  const exp = now + TOKEN_TTL_MS;
  return { token: assemble(exp, now + SESSION_TTL_MS), expiresAt: exp };
}

/**
 * Verifies the signature and returns the claims, or null when the token is
 * malformed or the signature does not match. Expiry is left to the caller: the
 * proxy requires `now < exp`, refresh requires `now < hardExp`.
 */
export function verifyGeoToken(token: string | null | undefined): Claims | null {
  if (!token || token.length > 256) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [expText, hardText, nonce, sig] = parts as [string, string, string, string];
  const expected = sign(`${expText}.${hardText}.${nonce}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expText);
  const hardExp = Number(hardText);
  if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(hardExp)) return null;
  return { exp, hardExp };
}

/** True when the token's signature is valid and it has not reached `exp`. */
export function isGeoTokenValid(token: string | null | undefined, now = Date.now()): boolean {
  const claims = verifyGeoToken(token);
  return claims !== null && now < claims.exp;
}

/**
 * A new token for a session that is still within its refresh window, or null
 * when the presented token is invalid or its hard expiry has passed (the page
 * must then be loaded again). The refresh window (hardExp) is carried over, so
 * refreshing cannot extend a session past its original cap.
 */
export function refreshGeoToken(token: string | null | undefined, now = Date.now()): GeoToken | null {
  const claims = verifyGeoToken(token);
  if (claims === null || now >= claims.hardExp) return null;
  const exp = Math.min(now + TOKEN_TTL_MS, claims.hardExp);
  return { token: assemble(exp, claims.hardExp), expiresAt: exp };
}
