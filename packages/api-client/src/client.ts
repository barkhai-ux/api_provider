import type {
  GeocodeResponse,
  ReverseGeocodeResponse,
  RouteResponse,
  TravelMode,
} from "@geo-platform/types";
import { GeoApiError, type RateLimitInfo } from "./errors";

export const DEFAULT_BASE_URL = "https://api.YOUR_DOMAIN";
export const DEFAULT_TIMEOUT_MS = 15_000;

/** `[longitude, latitude]`, as in GeoJSON. */
export type LngLat = readonly [longitude: number, latitude: number];

export interface GeoClientOptions {
  /** Your API key (`geo_live_…`). Keep it on the server; never ship it in browser code. */
  apiKey?: string;
  /** API origin, without `/v1`. Defaults to the production API. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Custom fetch implementation (for tests or older runtimes). */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  /** Abort the request, for example when a newer search replaces it. */
  signal?: AbortSignal;
}

export interface GeocodeParams {
  q: string;
  limit?: number;
}

export interface ReverseGeocodeParams {
  lat: number;
  lon: number;
}

export interface RouteParams {
  origin: LngLat | string;
  destination: LngLat | string;
  mode?: TravelMode;
}

type Query = Record<string, string | number | undefined>;

function formatLngLat(value: LngLat | string): string {
  return typeof value === "string" ? value : `${value[0]},${value[1]}`;
}

function parseRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  if (limit === null || remaining === null || reset === null) return undefined;
  return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) };
}

/**
 * Client for the Geo Platform public API (`/v1`).
 *
 * ```ts
 * const client = new GeoClient({ apiKey: process.env.GEO_API_KEY });
 * const { results } = await client.geocode({ q: "Sukhbaatar Square" });
 * ```
 */
export class GeoClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  /** Rate-limit state from the most recent response, if the API sent it. */
  lastRateLimit: RateLimitInfo | undefined;

  constructor(options: GeoClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  /** Place name or address to coordinates. */
  geocode(params: GeocodeParams, options?: RequestOptions): Promise<GeocodeResponse> {
    return this.get<GeocodeResponse>("/v1/geocode", { q: params.q, limit: params.limit }, options);
  }

  /** Coordinates to the nearest address, place or street. */
  reverseGeocode(params: ReverseGeocodeParams, options?: RequestOptions): Promise<ReverseGeocodeResponse> {
    return this.get<ReverseGeocodeResponse>("/v1/reverse-geocode", { lat: params.lat, lon: params.lon }, options);
  }

  /** Fastest route between two points for a travel mode (default `driving`). */
  route(params: RouteParams, options?: RequestOptions): Promise<RouteResponse> {
    return this.get<RouteResponse>(
      "/v1/route",
      {
        origin: formatLngLat(params.origin),
        destination: formatLngLat(params.destination),
        mode: params.mode,
      },
      options,
    );
  }

  private buildUrl(path: string, query: Query): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const qs = search.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async get<T>(path: string, query: Query, options?: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), this.timeoutMs);
    const onAbort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) controller.abort(options.signal.reason);
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    const headers: Record<string, string> = { Accept: "application/json", ...this.headers };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(path, query), { headers, signal: controller.signal });
    } catch (error) {
      if (options?.signal?.aborted) throw error; // caller cancelled: surface the AbortError as-is
      const timedOut = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError";
      throw new GeoApiError({
        status: timedOut ? 408 : 0,
        code: timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        message: timedOut ? `The request took longer than ${this.timeoutMs} ms.` : "Could not reach the API.",
      });
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", onAbort);
    }

    const rateLimit = parseRateLimit(response.headers);
    this.lastRateLimit = rateLimit ?? this.lastRateLimit;
    const requestId = response.headers.get("X-Request-ID") ?? undefined;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GeoApiError({
        status: response.status,
        code: "INVALID_RESPONSE",
        message: `Expected JSON from the API (HTTP ${response.status}).`,
        requestId,
        rateLimit,
      });
    }
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })
        ?.error;
      throw new GeoApiError({
        status: response.status,
        code: (error?.code as GeoApiError["code"]) ?? "INVALID_RESPONSE",
        message: error?.message ?? `HTTP ${response.status}`,
        details: error?.details,
        requestId,
        rateLimit,
      });
    }
    return body as T;
  }
}
