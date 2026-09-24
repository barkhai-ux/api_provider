"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  FullscreenControl,
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { ESRI_ATTRIBUTION, isEsriVectorTileStyle, resolveMapStyle } from "@/lib/basemap";

export type LngLatTuple = [longitude: number, latitude: number];

export type MapMarker = {
  id: string;
  kind: "place" | "origin" | "destination" | "pin";
  lngLat: LngLatTuple;
  label: string;
};

export type CameraRequest =
  | { key: number; center: LngLatTuple; zoom?: number }
  | { key: number; bounds: [LngLatTuple, LngLatTuple] };

export type PopupAction = { label: string; onSelect: () => void };

export type MapPopup = {
  lngLat: LngLatTuple;
  title: string;
  lines: string[];
  actions: PopupAction[];
};

export type MapViewProps = {
  styleUrl: string;
  initialCenter: LngLatTuple;
  initialZoom: number;
  markers: MapMarker[];
  route: LngLatTuple[] | null;
  camera: CameraRequest | null;
  popup: MapPopup | null;
  reducedMotion: boolean;
  /** Padding (px) kept clear of overlaid panels when fitting routes. */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Height (px) of a panel covering the bottom of the map; controls move above it. */
  bottomInset?: number;
  /** Require Ctrl/⌘ + scroll to zoom (for maps embedded in scrolling pages). */
  cooperativeGestures?: boolean;
  /** Hide the fullscreen, geolocate and scale controls (compact embeds). */
  minimalControls?: boolean;
  onMapClick?: (lngLat: LngLatTuple) => void;
  onPopupClose?: () => void;
  onStyleError?: () => void;
};

// Bundlers do not emit MapLibre's worker; scripts/copy-maplibre-worker.mjs
// copies it (and its shared chunk) to public/maplibre/.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const ROUTE_SOURCE = "geo-route";
const ROUTE_LINE_COLOR = "#2f6bff";
const ROUTE_CASING_COLOR = "#ffffff";
const EMPTY_ROUTE: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const MARKER_COLORS: Record<MapMarker["kind"], string> = {
  place: "#2f6bff",
  origin: "#0f172a",
  destination: "#dc2626",
  pin: "#475569",
};

function markerElement(marker: MapMarker): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", marker.label);
  element.dataset.kind = marker.kind;
  element.className = "geo-marker";
  element.style.width = "28px";
  element.style.height = "36px";
  // Static SVG built from constants only (no user text), so innerHTML is safe here.
  element.innerHTML = `<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">
    <path d="M14 1C7 1 1.5 6.5 1.5 13.3 1.5 22.6 14 35 14 35s12.5-12.4 12.5-21.7C26.5 6.5 21 1 14 1Z"
      fill="${MARKER_COLORS[marker.kind]}" stroke="#ffffff" stroke-width="2"/>
    <circle cx="14" cy="13.5" r="4.5" fill="#ffffff"/>
  </svg>`;
  return element;
}

function popupContent(popup: MapPopup): HTMLElement {
  // Built with textContent only: place names come from the API and are never
  // interpreted as HTML.
  const root = document.createElement("div");
  root.className = "geo-popup";
  const title = document.createElement("p");
  title.className = "geo-popup-title";
  title.textContent = popup.title;
  root.append(title);
  for (const line of popup.lines) {
    const p = document.createElement("p");
    p.className = "geo-popup-line";
    p.textContent = line;
    root.append(p);
  }
  if (popup.actions.length) {
    const actions = document.createElement("div");
    actions.className = "geo-popup-actions";
    for (const action of popup.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", action.onSelect);
      actions.append(button);
    }
    root.append(actions);
  }
  return root;
}

/** Imperative MapLibre wrapper. Loaded client-side only (see map-loader.tsx). */
export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const popupRef = useRef<Popup | null>(null);
  // The map exists once its style is resolved; `ready` once the style loaded.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef(props);

  useEffect(() => {
    latest.current = props;
  });

  // Create the map once its style is resolved (ArcGIS styles are rewritten first).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    let created: MapLibreMap | null = null;
    const { styleUrl, initialCenter, initialZoom, cooperativeGestures, minimalControls } = latest.current;

    resolveMapStyle(styleUrl, controller.signal)
      .then((style) => {
        if (controller.signal.aborted) return;
        const instance = new MapLibreMap({
          container,
          style,
          center: initialCenter,
          zoom: initialZoom,
          attributionControl: {
            compact: true,
            customAttribution: isEsriVectorTileStyle(styleUrl) ? ESRI_ATTRIBUTION : undefined,
          },
          cooperativeGestures: cooperativeGestures ?? false,
        });
        created = instance;
        instance.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
        if (!minimalControls) {
          instance.addControl(
            new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
            "bottom-right",
          );
          instance.addControl(new FullscreenControl(), "bottom-right");
          instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
        }

        instance.on("load", () => {
          instance.addSource(ROUTE_SOURCE, { type: "geojson", data: EMPTY_ROUTE });
          instance.addLayer({
            id: `${ROUTE_SOURCE}-casing`,
            type: "line",
            source: ROUTE_SOURCE,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": ROUTE_CASING_COLOR, "line-width": 9, "line-opacity": 0.9 },
          });
          instance.addLayer({
            id: `${ROUTE_SOURCE}-line`,
            type: "line",
            source: ROUTE_SOURCE,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": ROUTE_LINE_COLOR, "line-width": 5 },
          });
          setReady(true);
        });
        instance.on("click", (event) => {
          latest.current.onMapClick?.([event.lngLat.lng, event.lngLat.lat]);
        });
        instance.on("error", (event) => {
          if (!instance.isStyleLoaded()) {
            console.warn("Basemap failed to load", event.error?.message);
            latest.current.onStyleError?.();
          }
        });
        setMap(instance);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Basemap style could not be loaded", error);
        latest.current.onStyleError?.();
      });

    const markers = markersRef.current;
    return () => {
      controller.abort();
      markers.forEach((marker) => marker.remove());
      markers.clear();
      popupRef.current?.remove();
      created?.remove();
      setMap(null);
      setReady(false);
    };
  }, []);

  // Markers.
  useEffect(() => {
    if (!map) return;
    const existing = markersRef.current;
    const wanted = new Set(props.markers.map((m) => m.id));
    for (const [id, marker] of existing) {
      if (!wanted.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }
    for (const marker of props.markers) {
      const key = marker.id;
      const current = existing.get(key);
      if (current && current.getElement().dataset.kind === marker.kind) {
        current.setLngLat(marker.lngLat);
        current.getElement().setAttribute("aria-label", marker.label);
      } else {
        current?.remove();
        existing.set(
          key,
          new Marker({ element: markerElement(marker), anchor: "bottom" }).setLngLat(marker.lngLat).addTo(map),
        );
      }
    }
  }, [map, props.markers]);

  // Route line.
  useEffect(() => {
    if (!map || !ready) return;
    const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
    source?.setData(
      props.route
        ? {
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: props.route } }],
          }
        : EMPTY_ROUTE,
    );
  }, [map, props.route, ready]);

  // Camera requests (search result selected, route calculated, ...).
  const cameraKey = props.camera?.key;
  useEffect(() => {
    const camera = latest.current.camera;
    if (!map || !camera) return;
    const { reducedMotion, padding } = latest.current;
    if ("bounds" in camera) {
      const bounds = new LngLatBounds(camera.bounds[0], camera.bounds[1]);
      map.fitBounds(bounds, { padding, maxZoom: 16, animate: !reducedMotion, duration: 800 });
    } else if (reducedMotion) {
      map.jumpTo({ center: camera.center, zoom: camera.zoom ?? map.getZoom() });
    } else {
      map.flyTo({ center: camera.center, zoom: camera.zoom ?? map.getZoom(), speed: 1.4, essential: false });
    }
  }, [map, cameraKey]);

  // Popup.
  useEffect(() => {
    if (!map) return;
    // Clear the ref first: remove() fires "close", which must not be mistaken
    // for the user closing the popup.
    const previous = popupRef.current;
    popupRef.current = null;
    previous?.remove();
    if (!props.popup) return;
    const popup = new Popup({ offset: 30, closeButton: true, closeOnClick: false, maxWidth: "280px" })
      .setLngLat(props.popup.lngLat)
      .setDOMContent(popupContent(props.popup))
      .addTo(map);
    popup.on("close", () => {
      if (popupRef.current === popup) latest.current.onPopupClose?.();
    });
    popupRef.current = popup;
  }, [map, props.popup]);

  // MapLibre sets `position: relative` on its container, so the container
  // fills an absolutely positioned wrapper instead of being positioned itself.
  return (
    <div
      className="geo-map absolute inset-0"
      style={{ "--map-bottom-inset": `${props.bottomInset ?? 0}px` } as React.CSSProperties}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label="Interactive map. Use arrow keys to pan and plus or minus to zoom."
      />
    </div>
  );
}
