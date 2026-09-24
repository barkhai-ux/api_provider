"use client";

import { GeoApiError, type GeocodeResult, type RouteResponse, type TravelMode } from "@geo-platform/api-client";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Navigation, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { publicConfig, siteConfig } from "@/lib/config";
import { formatCoordinate } from "@/lib/format";
import { siteGeoClient } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { CameraRequest, LngLatTuple, MapMarker, MapPopup } from "./map-view";
import { RoutePanel, type RouteEndpoint } from "./route-panel";
import { SearchBox } from "./search-box";

const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />,
});

const PLACE_ZOOM = 16;
const EMPTY_ENDPOINT: RouteEndpoint = { text: "", lngLat: null };

type Selection = { id: string; lngLat: LngLatTuple; kind: "place" | "pin" };

function friendlyError(error: unknown, action: "route" | "reverse"): string {
  if (error instanceof GeoApiError) {
    if (error.code === "SERVICE_UNAVAILABLE") {
      return action === "route" ? "Routing is temporarily unavailable." : "Address lookup is temporarily unavailable.";
    }
    if (error.code === "RATE_LIMIT_EXCEEDED") return "Too many requests. Wait a moment and try again.";
    return error.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

function routeBounds(route: RouteResponse): [LngLatTuple, LngLatTuple] | null {
  const coords = route.route.geometry.coordinates;
  if (!coords.length) return null;
  let [minX, minY] = coords[0];
  let [maxX, maxY] = coords[0];
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export function MapApp() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const reducedMotion = usePrefersReducedMotion();

  const [searchText, setSearchText] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [popup, setPopup] = useState<MapPopup | null>(null);
  const [from, setFrom] = useState<RouteEndpoint>(EMPTY_ENDPOINT);
  const [to, setTo] = useState<RouteEndpoint>(EMPTY_ENDPOINT);
  const [mode, setMode] = useState<TravelMode>("driving");
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"search" | "directions">("search");
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [styleError, setStyleError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheetRef = useRef<HTMLElement>(null);
  const cameraKey = useRef(0);
  const routeAbort = useRef<AbortController | null>(null);
  const reverseAbort = useRef<AbortController | null>(null);

  const moveCamera = useCallback((request: Omit<CameraRequest, "key">) => {
    cameraKey.current += 1;
    setCamera({ ...request, key: cameraKey.current } as CameraRequest);
  }, []);

  const openDirections = useCallback(() => {
    setDirectionsOpen(true);
    setMobileTab("directions");
    setSheetExpanded(true);
  }, []);

  // --- Routing ------------------------------------------------------------------------

  const routeMutation = useMutation({
    mutationFn: async (args: { from: LngLatTuple; to: LngLatTuple; mode: TravelMode }) => {
      routeAbort.current?.abort();
      const controller = new AbortController();
      routeAbort.current = controller;
      return siteGeoClient.route(
        { origin: args.from, destination: args.to, mode: args.mode },
        { signal: controller.signal },
      );
    },
    onSuccess: (route) => {
      setRouteError(null);
      const bounds = routeBounds(route);
      if (bounds) moveCamera({ bounds });
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRouteError(friendlyError(error, "route"));
    },
  });

  const calculate = useCallback(
    (nextFrom = from, nextTo = to, nextMode = mode) => {
      if (!nextFrom.lngLat || !nextTo.lngLat) return;
      setRouteError(null);
      routeMutation.mutate({ from: nextFrom.lngLat, to: nextTo.lngLat, mode: nextMode });
    },
    [from, to, mode, routeMutation],
  );

  const clearRoute = useCallback(() => {
    routeAbort.current?.abort();
    routeMutation.reset();
    setRouteError(null);
    setFrom(EMPTY_ENDPOINT);
    setTo(EMPTY_ENDPOINT);
  }, [routeMutation]);

  const setEndpoint = useCallback(
    (which: "from" | "to", endpoint: RouteEndpoint) => {
      const nextFrom = which === "from" ? endpoint : from;
      const nextTo = which === "to" ? endpoint : to;
      if (which === "from") setFrom(endpoint);
      else setTo(endpoint);
      routeMutation.reset();
      setRouteError(null);
      openDirections();
      if (nextFrom.lngLat && nextTo.lngLat) calculate(nextFrom, nextTo, mode);
    },
    [from, to, mode, calculate, routeMutation, openDirections],
  );

  // --- Place selection and reverse geocoding ------------------------------------------

  const placePopup = useCallback(
    (title: string, lines: string[], lngLat: LngLatTuple): MapPopup => ({
      lngLat,
      title,
      lines,
      actions: [
        { label: "Directions from here", onSelect: () => setEndpoint("from", { text: title, lngLat }) },
        { label: "Directions to here", onSelect: () => setEndpoint("to", { text: title, lngLat }) },
      ],
    }),
    [setEndpoint],
  );

  const selectPlace = useCallback(
    (place: GeocodeResult) => {
      const lngLat: LngLatTuple = [place.longitude, place.latitude];
      reverseAbort.current?.abort();
      setSelection({ id: place.id, lngLat, kind: "place" });
      setPopup(
        placePopup(place.name, [place.address ?? "", `${formatCoordinate(place.latitude)}, ${formatCoordinate(place.longitude)}`].filter(Boolean), lngLat),
      );
      moveCamera({ center: lngLat, zoom: PLACE_ZOOM });
      setSheetExpanded(false);
    },
    [moveCamera, placePopup],
  );

  const reverseGeocode = useCallback(
    async (lngLat: LngLatTuple) => {
      reverseAbort.current?.abort();
      const controller = new AbortController();
      reverseAbort.current = controller;
      const coordinates = `${formatCoordinate(lngLat[1])}, ${formatCoordinate(lngLat[0])}`;
      setSelection({ id: `pin-${lngLat.join(",")}`, lngLat, kind: "pin" });
      setPopup({ lngLat, title: "Looking up this location…", lines: [coordinates], actions: [] });
      try {
        const result = await siteGeoClient.reverseGeocode({ lat: lngLat[1], lon: lngLat[0] }, { signal: controller.signal });
        const { address } = result;
        const title = address.name ?? address.street ?? address.formatted.split(",")[0] ?? "Selected location";
        setPopup(placePopup(title, [address.formatted, coordinates], lngLat));
      } catch (error) {
        if (controller.signal.aborted) return;
        const notFound = error instanceof GeoApiError && error.code === "NOT_FOUND";
        setPopup(
          placePopup(
            notFound ? "Dropped pin" : "Address unavailable",
            [notFound ? "No address found nearby." : friendlyError(error, "reverse"), coordinates],
            lngLat,
          ),
        );
      }
    },
    [placePopup],
  );

  const useMyLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setRouteError("Your browser does not support location access.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setEndpoint("from", {
          text: "My location",
          lngLat: [position.coords.longitude, position.coords.latitude],
        });
      },
      () => {
        setLocating(false);
        setRouteError("Location permission was denied or your position is unavailable.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [setEndpoint]);

  // Switching mode on an existing route recalculates it.
  const changeMode = useCallback(
    (nextMode: TravelMode) => {
      setMode(nextMode);
      if (routeMutation.data || routeError) calculate(from, to, nextMode);
    },
    [from, to, calculate, routeMutation.data, routeError],
  );

  useEffect(
    () => () => {
      routeAbort.current?.abort();
      reverseAbort.current?.abort();
    },
    [],
  );

  // Track the mobile sheet's height so map controls and route framing stay clear of it.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const observer = new ResizeObserver(([entry]) => setSheetHeight(Math.round(entry.contentRect.height)));
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [isDesktop]);

  // --- Derived map state ----------------------------------------------------------------

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (selection) {
      list.push({
        id: "selection",
        kind: selection.kind,
        lngLat: selection.lngLat,
        label: selection.kind === "place" ? "Selected place" : "Dropped pin",
      });
    }
    if (from.lngLat) list.push({ id: "origin", kind: "origin", lngLat: from.lngLat, label: `Start: ${from.text}` });
    if (to.lngLat) list.push({ id: "destination", kind: "destination", lngLat: to.lngLat, label: `Destination: ${to.text}` });
    return list;
  }, [selection, from, to]);

  const route = routeMutation.data && !routeError ? (routeMutation.data.route.geometry.coordinates as LngLatTuple[]) : null;
  const padding = isDesktop
    ? { top: 80, right: directionsOpen ? 400 : 48, bottom: 48, left: 48 }
    : { top: 32, right: 32, bottom: sheetHeight + 32, left: 32 };

  const routePanel = (
    <RoutePanel
      from={from}
      to={to}
      mode={mode}
      onFromChange={(endpoint) => (endpoint.lngLat ? setEndpoint("from", endpoint) : setFrom(endpoint))}
      onToChange={(endpoint) => (endpoint.lngLat ? setEndpoint("to", endpoint) : setTo(endpoint))}
      onModeChange={changeMode}
      onSwap={() => {
        setFrom(to);
        setTo(from);
        routeMutation.reset();
        if (from.lngLat && to.lngLat) calculate(to, from, mode);
      }}
      onUseMyLocation={useMyLocation}
      locating={locating}
      onCalculate={() => calculate()}
      onClear={clearRoute}
      calculating={routeMutation.isPending}
      result={routeError ? null : (routeMutation.data ?? null)}
      error={routeError}
      inlineResults={!isDesktop}
    />
  );

  const searchBox = (
    <SearchBox
      label="Search location"
      placeholder="Search places in Mongolia"
      size="lg"
      inlineResults={!isDesktop}
      text={searchText}
      onTextChange={setSearchText}
      onSelect={selectPlace}
      onClear={() => {
        setSelection(null);
        setPopup(null);
      }}
    />
  );

  return (
    <div className="theme-dark relative h-full w-full overflow-hidden bg-muted text-foreground">
      <h1 className="sr-only">Geo Platform map</h1>
      <MapView
        styleUrl={publicConfig.mapStyleUrl}
        initialCenter={siteConfig.defaultCenter}
        initialZoom={siteConfig.defaultZoom}
        markers={markers}
        route={route}
        camera={camera}
        popup={popup}
        reducedMotion={reducedMotion}
        padding={padding}
        bottomInset={isDesktop ? 0 : sheetHeight}
        onMapClick={reverseGeocode}
        onPopupClose={() => setPopup(null)}
        onStyleError={() => setStyleError(true)}
      />

      {styleError && (
        <div role="alert" className="absolute inset-x-3 top-20 z-20 mx-auto max-w-md rounded-xl border bg-background p-3 text-sm shadow-lg">
          The basemap could not be loaded. Search and routing still work; check your connection or the map style URL.
        </div>
      )}

      {/* Desktop search */}
      {isDesktop && (
        <div className="absolute top-3 left-3 z-20 w-[400px] max-w-[calc(100vw-1.5rem)] rounded-2xl border bg-background/95 p-2 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur supports-backdrop-filter:bg-background/90">
          {searchBox}
        </div>
      )}

      {/* Desktop directions panel */}
      {isDesktop &&
        (directionsOpen ? (
          <section
            aria-labelledby="directions-heading"
            className="absolute top-3 right-3 z-10 max-h-[calc(100%-1.5rem)] w-[380px] overflow-y-auto max-w-[calc(100vw-1.5rem)] rounded-2xl border bg-background/95 p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="directions-heading" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                Directions
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setDirectionsOpen(false)} aria-label="Hide route panel">
                <X />
              </Button>
            </div>
            {routePanel}
          </section>
        ) : (
          <Button size="pill" className="absolute top-3 right-3 z-10 h-10 px-5 shadow-lg" onClick={openDirections}>
            <Navigation /> Directions
          </Button>
        ))}

      {/* Mobile bottom sheet: search and directions */}
      {!isDesktop && (
        <section
          ref={sheetRef}
          aria-label="Search and directions"
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl border-t bg-background shadow-[0_-4px_16px_rgb(0_0_0/0.08)]",
            sheetExpanded ? "max-h-[75dvh]" : "max-h-[45dvh]",
          )}
        >
          <button
            type="button"
            onClick={() => setSheetExpanded((value) => !value)}
            aria-expanded={sheetExpanded}
            aria-label={sheetExpanded ? "Collapse panel" : "Expand panel"}
            className="flex w-full items-center justify-center py-2 text-muted-foreground"
          >
            <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
            {sheetExpanded ? <ChevronDown className="sr-only" /> : <ChevronUp className="sr-only" />}
          </button>
          <div className="px-4">
            <div role="tablist" aria-label="Panel" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(["search", "directions"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === tab}
                  onClick={() => {
                    setMobileTab(tab);
                    if (tab === "directions") setDirectionsOpen(true);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm text-muted-foreground",
                    mobileTab === tab && "bg-background font-medium text-foreground shadow-xs",
                  )}
                >
                  {tab === "search" ? <Search className="size-4" /> : <Navigation className="size-4" />}
                  {tab === "search" ? "Search" : "Directions"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onFocusCapture={() => setSheetExpanded(true)}>
            {mobileTab === "search" ? searchBox : routePanel}
          </div>
        </section>
      )}
    </div>
  );
}
