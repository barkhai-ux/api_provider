export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, GeoClient } from "./client";
export type {
  GeocodeParams,
  GeoClientOptions,
  LngLat,
  RequestOptions,
  ReverseGeocodeParams,
  RouteParams,
} from "./client";
export { GeoApiError } from "./errors";
export type { ClientErrorCode, RateLimitInfo } from "./errors";
export type {
  Address,
  ErrorCode,
  GeocodeResponse,
  GeocodeResult,
  Location,
  ReverseGeocodeResponse,
  Route,
  RouteResponse,
  TravelMode,
  Waypoint,
} from "@geo-platform/types";
