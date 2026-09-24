"use client";

import { GeoApiError, type TravelMode } from "@geo-platform/api-client";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistance, formatDuration } from "@/lib/format";
import { siteGeoClient } from "@/lib/geo";
import { cn } from "@/lib/utils";

type DemoResult = { request: string; status: string; ok: boolean; body: unknown; summary?: string };

const MAX_PREVIEW_COORDINATES = 4;

/** Shortens long GeoJSON coordinate arrays so the response stays readable. */
function preview(body: unknown): unknown {
  if (body && typeof body === "object" && "route" in body) {
    const route = (body as { route: { geometry: { coordinates: unknown[] } } }).route;
    const coordinates = route.geometry.coordinates;
    if (coordinates.length > MAX_PREVIEW_COORDINATES) {
      return {
        ...body,
        route: {
          ...route,
          geometry: {
            ...route.geometry,
            coordinates: [...coordinates.slice(0, MAX_PREVIEW_COORDINATES), `… ${coordinates.length - MAX_PREVIEW_COORDINATES} more`],
          },
        },
      };
    }
  }
  return body;
}

async function run(request: string, call: () => Promise<unknown>, summarize?: (body: never) => string): Promise<DemoResult> {
  try {
    const body = await call();
    return { request, status: "200 OK", ok: true, body: preview(body), summary: summarize?.(body as never) };
  } catch (error) {
    if (error instanceof GeoApiError) {
      return {
        request,
        status: `${error.status} ${error.code}`,
        ok: false,
        body: { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      };
    }
    return { request, status: "Network error", ok: false, body: { error: "Could not reach the API." } };
  }
}

function ResultView({ result, pending }: { result: DemoResult | undefined; pending: boolean }) {
  return (
    <div className="flex min-h-80 flex-col overflow-hidden rounded-2xl border bg-code" aria-live="polite" aria-busy={pending}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 font-mono text-xs">
        <span className="truncate text-muted-foreground">{result?.request ?? "Send a request to see the response"}</span>
        {result && (
          <span className={cn("shrink-0 font-medium", result.ok ? "text-success" : "text-destructive")}>{result.status}</span>
        )}
      </div>
      {result?.summary && <p className="border-b px-4 py-2 text-sm font-medium">{result.summary}</p>}
      <pre className="max-h-96 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">
        {pending ? "Loading…" : result ? JSON.stringify(result.body, null, 2) : "{ }"}
      </pre>
    </div>
  );
}

function GeocodeDemo() {
  const [q, setQ] = useState("Ulaanbaatar");
  const mutation = useMutation({
    mutationFn: (query: string) =>
      run(`GET /v1/geocode?q=${encodeURIComponent(query)}&limit=5`, () => siteGeoClient.geocode({ q: query, limit: 5 })),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (q.trim().length >= 2) mutation.mutate(q.trim());
        }}
      >
        <Label htmlFor="demo-q">Search a location</Label>
        <Input
          id="demo-q"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search a location…"
          className="h-11 rounded-xl"
        />
        <Button type="submit" size="xl" className="self-start" disabled={mutation.isPending || q.trim().length < 2}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Play />} Send request
        </Button>
      </form>
      <ResultView result={mutation.data} pending={mutation.isPending} />
    </div>
  );
}

const COORDINATE = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

function RouteDemo() {
  const [origin, setOrigin] = useState("106.9177,47.9184");
  const [destination, setDestination] = useState("106.9057,47.9220");
  const [mode, setMode] = useState<TravelMode>("driving");
  const valid = COORDINATE.test(origin) && COORDINATE.test(destination);
  const mutation = useMutation({
    mutationFn: () =>
      run(
        `GET /v1/route?origin=${origin.trim()}&destination=${destination.trim()}&mode=${mode}`,
        () => siteGeoClient.route({ origin: origin.trim(), destination: destination.trim(), mode }),
        (body: { route: { distance_meters: number; duration_seconds: number } }) =>
          `${formatDistance(body.route.distance_meters)} · ${formatDuration(body.route.duration_seconds)}`,
      ),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) mutation.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="demo-origin">Origin (longitude,latitude)</Label>
          <Input
            id="demo-origin"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            className="h-11 rounded-xl font-mono"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="demo-destination">Destination (longitude,latitude)</Label>
          <Input
            id="demo-destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="h-11 rounded-xl font-mono"
          />
        </div>
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Mode</legend>
          {(["driving", "walking"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 capitalize">
              <input type="radio" name="demo-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="accent-primary" />
              {value}
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="xl" className="self-start" disabled={mutation.isPending || !valid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Play />} Calculate route
        </Button>
      </form>
      <ResultView result={mutation.data} pending={mutation.isPending} />
    </div>
  );
}

/** Live requests against the real public API (through this site's proxy). */
export function LiveDemo() {
  return (
    <Tabs defaultValue="geocode" className="gap-6">
      <TabsList className="h-11 rounded-full p-1">
        <TabsTrigger value="geocode" className="rounded-full px-5 font-semibold">
          Geocoding
        </TabsTrigger>
        <TabsTrigger value="route" className="rounded-full px-5 font-semibold">
          Routing
        </TabsTrigger>
      </TabsList>
      <TabsContent value="geocode">
        <GeocodeDemo />
      </TabsContent>
      <TabsContent value="route">
        <RouteDemo />
      </TabsContent>
    </Tabs>
  );
}
