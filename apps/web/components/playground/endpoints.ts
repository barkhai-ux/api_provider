import { z } from "zod";

/** Endpoints the playground can call, with client-side checks that mirror the API. */

export type PlaygroundEndpointId = "geocode" | "route";

export type ParamSpec = {
  name: string;
  label: string;
  kind: "text" | "number" | "select";
  required: boolean;
  defaultValue: string;
  description: string;
  options?: readonly string[];
  inputMode?: "text" | "decimal" | "numeric";
};

export type PlaygroundEndpoint = {
  id: PlaygroundEndpointId;
  method: "GET";
  path: string;
  title: string;
  params: ParamSpec[];
  schema: z.ZodType<Record<string, string>, Record<string, string>>;
};

const number = (min: number, max: number, integer = false) =>
  z
    .string()
    .trim()
    .refine((value) => value !== "" && Number.isFinite(Number(value)), "Enter a number.")
    .refine((value) => !integer || Number.isInteger(Number(value)), "Enter a whole number.")
    .refine((value) => Number(value) >= min && Number(value) <= max, `Must be between ${min} and ${max}.`);

const lngLat = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/, "Use longitude,latitude, for example 106.9177,47.9184.")
  .refine((value) => {
    const [lon, lat] = value.split(",").map(Number);
    return Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  }, "Longitude must be within ±180 and latitude within ±90.");

export const PLAYGROUND_ENDPOINTS: Record<PlaygroundEndpointId, PlaygroundEndpoint> = {
  geocode: {
    id: "geocode",
    method: "GET",
    path: "/v1/geocode",
    title: "Geocode",
    params: [
      {
        name: "q",
        label: "q",
        kind: "text",
        required: true,
        defaultValue: "Sukhbaatar Square",
        description: "Place name or address, 2–200 characters. (Reverse geocoding uses lat & lon; see the docs.)",
      },
      {
        name: "limit",
        label: "limit",
        kind: "number",
        required: false,
        defaultValue: "5",
        description: "Maximum results, 1–20.",
        inputMode: "numeric",
      },
    ],
    schema: z.object({
      q: z.string().trim().min(2, "At least 2 characters.").max(200, "At most 200 characters."),
      limit: z.union([z.literal(""), number(1, 20, true)]),
    }),
  },
  route: {
    id: "route",
    method: "GET",
    path: "/v1/route",
    title: "Route",
    params: [
      {
        name: "origin",
        label: "origin",
        kind: "text",
        required: true,
        defaultValue: "106.9177,47.9184",
        description: "longitude,latitude",
      },
      {
        name: "destination",
        label: "destination",
        kind: "text",
        required: true,
        defaultValue: "106.9057,47.9220",
        description: "longitude,latitude",
      },
      {
        name: "mode",
        label: "mode",
        kind: "select",
        required: false,
        defaultValue: "driving",
        description: "Travel mode.",
        options: ["driving", "walking"],
      },
    ],
    schema: z.object({ origin: lngLat, destination: lngLat, mode: z.enum(["driving", "walking"]) }),
  },
};

export function defaultValues(endpoint: PlaygroundEndpoint): Record<string, string> {
  return Object.fromEntries(endpoint.params.map((param) => [param.name, param.defaultValue]));
}

/** Path with an encoded query string, omitting empty optional parameters. */
export function buildRequestPath(endpoint: PlaygroundEndpoint, values: Record<string, string>): string {
  const query = endpoint.params
    .map((param) => {
      const raw = (values[param.name] ?? "").trim();
      // Coordinates are sent without spaces: "106.9177,47.9184".
      return [param.name, param.name === "origin" || param.name === "destination" ? raw.replace(/\s+/g, "") : raw] as const;
    })
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${endpoint.path}?${query}` : endpoint.path;
}

/** Copyable cURL command. The credential is always replaced by a placeholder. */
export function buildCurl(apiUrl: string, path: string): string {
  return `curl "${apiUrl}${path}" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function statusLine(status: number, statusText?: string): string {
  return `${status} ${statusText || STATUS_TEXT[status] || ""}`.trim();
}
