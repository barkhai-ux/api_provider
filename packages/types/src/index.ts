/**
 * Public API types for Ubhub Location Service `/v1`, generated from the OpenAPI schema
 * (`openapi.json`, exported by the API). Regenerate with `npm run generate:types`.
 */
import type { components, operations, paths } from "./openapi";

export type { components, operations, paths };

type Schemas = components["schemas"];

export type GeocodeResponse = Schemas["GeocodeResponse"];
export type GeocodeResult = Schemas["GeocodeResult"];
export type ReverseGeocodeResponse = Schemas["ReverseGeocodeResponse"];
export type Address = Schemas["Address"];
export type Location = Schemas["Location"];
export type RouteResponse = Schemas["RouteResponse"];
export type Route = Schemas["Route"];
export type Waypoint = Schemas["Waypoint"];
export type LineString = Schemas["LineString"];
export type TravelMode = Schemas["TravelMode"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type ErrorDetail = Schemas["ErrorDetail"];
export type ErrorCode = ErrorDetail["code"];

export type GeocodeParams = NonNullable<operations["geocode"]["parameters"]["query"]>;
export type ReverseGeocodeParams = NonNullable<operations["reverseGeocode"]["parameters"]["query"]>;
export type RouteParams = NonNullable<operations["route"]["parameters"]["query"]>;

export const TRAVEL_MODES = ["driving", "walking"] as const satisfies readonly TravelMode[];

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "INVALID_API_KEY",
  "API_KEY_REVOKED",
  "ENDPOINT_NOT_ALLOWED",
  "NOT_FOUND",
  "REQUEST_TIMEOUT",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_ERROR",
  "UPSTREAM_ERROR",
  "SERVICE_UNAVAILABLE",
] as const satisfies readonly ErrorCode[];
