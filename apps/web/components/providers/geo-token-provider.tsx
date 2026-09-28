"use client";

import { useEffect, useRef, useState } from "react";
import { setGeoToken } from "@/lib/geo";

const REFRESH_MARGIN_MS = 60_000;
const MIN_REFRESH_MS = 10_000;

interface GeoTokenProviderProps {
  token: string;
  /** Epoch ms when `token` stops working. */
  expiresAt: number;
}

/**
 * Makes the per-session token minted during server rendering available to the
 * map's API calls, and refreshes it shortly before it expires so a page left
 * open keeps working. Refreshing stops once the server declines (past the
 * session's hard expiry); the next call then fails and the visitor reloads.
 */
export function GeoTokenProvider({ token, expiresAt }: GeoTokenProviderProps) {
  // Set synchronously on first render so the token is in place before any child
  // effect fires a request.
  useState(() => {
    setGeoToken(token);
    return null;
  });

  const currentRef = useRef(token);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = (at: number) => {
      const delay = Math.max(at - REFRESH_MARGIN_MS - Date.now(), MIN_REFRESH_MS);
      timer = setTimeout(refresh, delay);
    };

    const refresh = async () => {
      try {
        const response = await fetch("/api/geo/token", {
          method: "POST",
          headers: { "x-geo-token": currentRef.current },
          cache: "no-store",
        });
        if (!response.ok || cancelled) return; // past hard expiry: stop refreshing
        const next = (await response.json()) as { token: string; expiresAt: number };
        setGeoToken(next.token);
        // The refreshed token becomes the credential for the next refresh too.
        currentRef.current = next.token;
        schedule(next.expiresAt);
      } catch {
        // Network hiccup: leave the current token; a later request may retry.
      }
    };

    schedule(expiresAt);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Run once; refresh reschedules itself with the rotated token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
