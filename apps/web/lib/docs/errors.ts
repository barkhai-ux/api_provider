/** The public error catalogue. Matches app/core/errors.py in the API. */

export type ErrorInfo = {
  status: number;
  code: string;
  meaning: string;
  action: string;
  example: { message: string; details?: Record<string, unknown> };
};

export const ERROR_CATALOG: ErrorInfo[] = [
  {
    status: 400,
    code: "INVALID_REQUEST",
    meaning:
      "A parameter is missing or invalid. `details.field` names it. Also used with status 405 for a wrong HTTP method and 413 for an oversized body.",
    action: "Fix the request; retrying it unchanged will fail again.",
    example: { message: "Invalid value for 'lat': input should be less than or equal to 90", details: { field: "lat" } },
  },
  {
    status: 401,
    code: "INVALID_API_KEY",
    meaning: "The Authorization header is missing or malformed, the key does not exist, or it has expired (`details.reason` is `expired`).",
    action: "Send a valid key as `Authorization: Bearer YOUR_API_KEY`.",
    example: { message: "The API key is missing or invalid." },
  },
  {
    status: 403,
    code: "API_KEY_REVOKED",
    meaning: "The key was revoked in the dashboard.",
    action: "Use another key or create a new one.",
    example: { message: "This API key has been revoked." },
  },
  {
    status: 404,
    code: "NOT_FOUND",
    meaning:
      "Nothing was found: no address near the point (reverse geocoding), no route or no road near a waypoint (routing, `details.reason` explains), or an unknown path.",
    action: "Check the coordinates. For routing, move the point closer to a road or try another mode.",
    example: { message: "No address or place was found near this location." },
  },
  {
    status: 408,
    code: "REQUEST_TIMEOUT",
    meaning: "The data service behind the API did not answer in time.",
    action: "Retry after a short delay with exponential backoff.",
    example: { message: "The data service did not respond in time." },
  },
  {
    status: 429,
    code: "RATE_LIMIT_EXCEEDED",
    meaning: "The key used up its requests for the current one-minute window.",
    action: "Wait for the number of seconds in the `Retry-After` header, then retry.",
    example: { message: "Too many requests.", details: { limit: 100 } },
  },
  {
    status: 500,
    code: "INTERNAL_ERROR",
    meaning: "An unexpected error in the API.",
    action: "Retry later. If it persists, report the `X-Request-ID`.",
    example: { message: "Internal server error." },
  },
  {
    status: 502,
    code: "UPSTREAM_ERROR",
    meaning: "The data service behind the API failed or returned an invalid answer.",
    action: "Retry with backoff.",
    example: { message: "The upstream data service returned an error." },
  },
  {
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    meaning: "The service is temporarily unavailable, for example while a data source is being configured or loaded.",
    action: "Retry with backoff. `details.retryable` is true when a retry can succeed.",
    example: { message: "This service is temporarily unavailable.", details: { retryable: true } },
  },
];

export function errorsFor(statuses: number[]): ErrorInfo[] {
  return ERROR_CATALOG.filter((error) => statuses.includes(error.status));
}
