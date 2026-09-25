"use client";

import type { RouteResponse, TravelMode } from "@geo-platform/api-client";
import { ArrowDownUp, Car, Circle, Footprints, LocateFixed, Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { LngLatTuple } from "./map-view";
import { SearchBox } from "./search-box";

export type RouteEndpoint = { text: string; lngLat: LngLatTuple | null };

type RoutePanelProps = {
  from: RouteEndpoint;
  to: RouteEndpoint;
  mode: TravelMode;
  onFromChange: (endpoint: RouteEndpoint) => void;
  onToChange: (endpoint: RouteEndpoint) => void;
  onModeChange: (mode: TravelMode) => void;
  onSwap: () => void;
  onUseMyLocation: () => void;
  locating: boolean;
  onCalculate: () => void;
  onClear: () => void;
  calculating: boolean;
  result: RouteResponse | null;
  error: string | null;
  /** Show search results inline (mobile bottom sheet). */
  inlineResults?: boolean;
  className?: string;
};

const MODES: { value: TravelMode; labelKey: string; icon: typeof Car }[] = [
  { value: "driving", labelKey: "map.driving", icon: Car },
  { value: "walking", labelKey: "map.walking", icon: Footprints },
];

export function RoutePanel(props: RoutePanelProps) {
  const { from, to, mode, result, error, calculating } = props;
  const t = useT();
  const canCalculate = from.lngLat !== null && to.lngLat !== null && !calculating;

  return (
    <form
      method="post"
      className={cn("flex flex-col gap-3", props.className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (canCalculate) props.onCalculate();
      }}
      aria-label="Route planner"
    >
      <div className="flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SearchBox
            label={t("map.from")}
            hideLabel={false}
            placeholder={t("map.startPlaceholder")}
            inlineResults={props.inlineResults}
            icon={<Circle />}
            text={from.text}
            onTextChange={(text) => props.onFromChange({ text, lngLat: null })}
            onSelect={(place) => props.onFromChange({ text: place.name, lngLat: [place.longitude, place.latitude] })}
          />
          <SearchBox
            label={t("map.to")}
            hideLabel={false}
            placeholder={t("map.destinationPlaceholder")}
            inlineResults={props.inlineResults}
            icon={<MapPin />}
            text={to.text}
            onTextChange={(text) => props.onToChange({ text, lngLat: null })}
            onSelect={(place) => props.onToChange({ text: place.name, lngLat: [place.longitude, place.latitude] })}
          />
        </div>
        <div className="flex flex-col justify-end gap-2 pb-0.5">
          <Button type="button" variant="ghost" size="icon" onClick={props.onSwap} aria-label={t("map.swap")}>
            <ArrowDownUp />
          </Button>
        </div>
      </div>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto self-start px-0"
        onClick={props.onUseMyLocation}
        disabled={props.locating}
      >
        {props.locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
        {t("map.useMyLocationAsStart")}
      </Button>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium">{t("map.mode")}</legend>
        <div role="radiogroup" aria-label={t("map.travelMode")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {MODES.map(({ value, labelKey, icon: Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-sm text-muted-foreground transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring",
                mode === value && "bg-background font-medium text-foreground shadow-xs",
              )}
            >
              <input
                type="radio"
                name="travel-mode"
                value={value}
                checked={mode === value}
                onChange={() => props.onModeChange(value)}
                className="sr-only"
              />
              <Icon className="size-4" aria-hidden="true" />
              {t(labelKey)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={!canCalculate}>
          {calculating && <Loader2 className="animate-spin" />}
          {t("map.calculateRoute")}
        </Button>
        {(result || from.text || to.text) && (
          <Button type="button" variant="outline" onClick={props.onClear} aria-label={t("map.clearRoute")}>
            <X />
          </Button>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {result && !error && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">{formatDuration(result.route.duration_seconds)}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatDistance(result.route.distance_meters)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.mode === "walking" ? "Walking" : "Driving"} · estimated travel time
            </p>
          </div>
        )}
      </div>
    </form>
  );
}
