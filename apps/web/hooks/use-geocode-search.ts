"use client";

import type { GeocodeResponse } from "@geo-platform/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { siteGeoClient } from "@/lib/geo";
import { useDebouncedValue } from "./use-debounced-value";

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_SEARCH_LENGTH = 2;
const SEARCH_LIMIT = 6;

/**
 * Debounced place search through the public API. A new query aborts the
 * previous request (TanStack Query cancels queries that lose their observers).
 */
export function useGeocodeSearch(text: string, enabled = true) {
  const debounced = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const active = enabled && debounced.length >= MIN_SEARCH_LENGTH;
  const query = useQuery<GeocodeResponse>({
    queryKey: ["geocode", debounced.toLowerCase(), SEARCH_LIMIT],
    queryFn: ({ signal }) => siteGeoClient.geocode({ q: debounced, limit: SEARCH_LIMIT }, { signal }),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const settling = text.trim() !== debounced;
  return { ...query, active, settling, debouncedText: debounced };
}
