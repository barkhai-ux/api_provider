"use client";

import { GeoApiError, type GeocodeResult } from "@geo-platform/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import type { CameraRequest, LngLatTuple, MapMarker } from "@/components/map/map-view";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { publicConfig, siteConfig } from "@/lib/config";
import { siteGeoClient } from "@/lib/geo";
import { cn } from "@/lib/utils";

const MapView = dynamic(() => import("@/components/map/map-view"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />,
});

type Timed = { results: GeocodeResult[]; ms: number; status: string; body: unknown };

const PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

/** A live map with floating panels that call the real public API. */
export function HeroShowcase() {
  const [text, setText] = useState("Сүхбаатар");
  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const cameraKey = useRef(0);
  const reducedMotion = usePrefersReducedMotion();
  const q = useDebouncedValue(text.trim(), 300);

  const search = useQuery<Timed>({
    queryKey: ["hero-geocode", q],
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const started = performance.now();
      try {
        const body = await siteGeoClient.geocode({ q, limit: 5 }, { signal });
        return { results: body.results, ms: Math.round(performance.now() - started), status: "200 OK", body };
      } catch (error) {
        if (error instanceof GeoApiError) {
          const body = { error: { code: error.code, message: error.message } };
          return { results: [], ms: Math.round(performance.now() - started), status: `${error.status} ${error.code}`, body };
        }
        throw error;
      }
    },
  });

  function choose(result: GeocodeResult) {
    setSelected(result);
    cameraKey.current += 1;
    setCamera({ key: cameraKey.current, center: [result.longitude, result.latitude], zoom: 15 });
  }

  const markers = useMemo<MapMarker[]>(() => {
    const list = search.data?.results ?? [];
    return list.map((r) => ({
      id: r.id,
      kind: selected?.id === r.id ? "place" : "pin",
      lngLat: [r.longitude, r.latitude] as LngLatTuple,
      label: r.name,
    }));
  }, [search.data, selected]);

  const results = search.data?.results ?? [];
  const request = `GET /v1/geocode?q=${encodeURIComponent(q)}&limit=5`;
  const ok = search.data?.status.startsWith("200");

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-10%] -top-24 h-[520px] bg-[radial-gradient(50%_60%_at_50%_40%,var(--glow),transparent_70%)]"
      />
      <div className="relative rounded-[28px] border border-white/10 bg-card/80 p-2 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.8)]">
        <div className="relative grid overflow-hidden rounded-[20px] bg-muted lg:block lg:h-[560px]">
          <div className="relative h-[340px] lg:absolute lg:inset-0 lg:h-auto">
            <MapView
              styleUrl={publicConfig.mapStyleUrl}
              initialCenter={siteConfig.defaultCenter}
              initialZoom={12}
              markers={markers}
              route={null}
              camera={camera}
              popup={null}
              reducedMotion={reducedMotion}
              padding={PADDING}
              cooperativeGestures
              minimalControls
            />
          </div>

          {/* Search panel */}
          <section
            aria-label="Try the geocoding API"
            className="relative z-10 flex flex-col gap-3 border-t bg-background/95 p-4 backdrop-blur lg:absolute lg:top-4 lg:bottom-4 lg:left-4 lg:w-[320px] lg:rounded-2xl lg:border"
          >
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Try the API</p>
            <label className="relative block">
              <span className="sr-only">Search a place</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Search a place…"
                className="h-11 w-full rounded-xl border border-input bg-secondary pr-9 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              {search.isFetching && (
                <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </label>
            <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-live="polite">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => choose(result)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent",
                      selected?.id === result.id && "bg-accent",
                    )}
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{result.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{result.address}</span>
                    </span>
                  </button>
                </li>
              ))}
              {q.length >= 2 && search.isSuccess && results.length === 0 && (
                <li className="px-2.5 py-2 text-sm text-muted-foreground">No places found.</li>
              )}
            </ul>
          </section>

          {/* Request / response panel */}
          <section
            aria-label="API response"
            className="relative z-10 hidden flex-col gap-3 bg-background/95 p-4 backdrop-blur lg:absolute lg:top-4 lg:right-4 lg:flex lg:max-h-[calc(100%-8rem)] lg:w-[340px] lg:rounded-2xl lg:border"
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Response</p>
              {search.data && (
                <span className={cn("font-mono text-xs font-semibold", ok ? "text-success" : "text-destructive")}>
                  {search.data.status} · {search.data.ms} ms
                </span>
              )}
            </div>
            <code className="block truncate rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-foreground">
              <span className="font-bold text-primary">GET</span> {request.slice(4)}
            </code>
            <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-code p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {search.data ? JSON.stringify(search.data.body, null, 2) : "…"}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
