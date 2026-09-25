import type { CodeExample } from "@/components/docs/code-block";

/**
 * Request examples in every documented language. `apiUrl` is the public API
 * origin of this deployment, so copied examples work as-is.
 */

type Param = [name: string, value: string];

function curlExample(apiUrl: string, path: string, params: Param[]): string {
  const lines = [`curl -G "${apiUrl}${path}" \\`];
  for (const [name, value] of params) {
    lines.push(/^[\w.,-]+$/.test(value) ? `  -d ${name}=${value} \\` : `  --data-urlencode "${name}=${value}" \\`);
  }
  lines.push('  -H "Authorization: Bearer YOUR_API_KEY"');
  return lines.join("\n");
}

function fetchExample(apiUrl: string, path: string, params: Param[], use: string): string {
  const entries = params.map(([name, value]) => `  ${name}: "${value}",`).join("\n");
  return `const params = new URLSearchParams({
${entries}
});

const response = await fetch(\`${apiUrl}${path}?\${params}\`, {
  headers: { Authorization: \`Bearer \${process.env.GEO_API_KEY}\` },
});
const body = await response.json();

if (!response.ok) {
  // Every error uses the same envelope: { error: { code, message, details } }
  throw new Error(\`\${body.error.code}: \${body.error.message}\`);
}

${use}`;
}

function pythonExample(apiUrl: string, path: string, params: Param[], use: string): string {
  const entries = params
    .map(([name, value]) => `"${name}": ${/^-?\d+(\.\d+)?$/.test(value) && name !== "origin" && name !== "destination" ? value : `"${value}"`}`)
    .join(", ");
  return `import os

import httpx

response = httpx.get(
    "${apiUrl}${path}",
    params={${entries}},
    headers={"Authorization": f"Bearer {os.environ['GEO_API_KEY']}"},
    timeout=10,
)
body = response.json()
if response.is_error:
    raise RuntimeError(f"{body['error']['code']}: {body['error']['message']}")

${use}`;
}

function dartExample(apiUrl: string, path: string, params: Param[], use: string): string {
  const entries = params.map(([name, value]) => `'${name}': '${value}'`).join(", ");
  return `import 'dart:convert';

import 'package:http/http.dart' as http;

/// Call the API from your backend, or from an app through your own server:
/// never ship an API key inside a mobile app.
Future<void> main() async {
  const apiKey = String.fromEnvironment('GEO_API_KEY');
  final uri = Uri.parse('${apiUrl}${path}').replace(
    queryParameters: {${entries}},
  );
  final response = await http.get(uri, headers: {'Authorization': 'Bearer $apiKey'});
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  if (response.statusCode != 200) {
    throw Exception('\${body['error']['code']}: \${body['error']['message']}');
  }

${use}
}`;
}

function typedFetchExample(
  apiUrl: string,
  path: string,
  params: Param[],
  types: string,
  responseType: string,
  use: string,
): string {
  const entries = params.map(([name, value]) => `  ${name}: "${value}",`).join("\n");
  return `${types}

type ApiError = { error: { code: string; message: string; details?: Record<string, unknown> } };

const params = new URLSearchParams({
${entries}
});

const response = await fetch(\`${apiUrl}${path}?\${params}\`, {
  headers: { Authorization: \`Bearer \${process.env.GEO_API_KEY}\` },
});
if (!response.ok) {
  const { error } = (await response.json()) as ApiError;
  throw new Error(\`\${error.code}: \${error.message}\`);
}
const body = (await response.json()) as ${responseType};

${use}`;
}

const GEOCODE_TYPES = `type GeocodeResult = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  type: string;
  distance_meters?: number; // reverse lookups only
};
type GeocodeResponse = { query: string; results: GeocodeResult[]; count: number };`;

const ROUTE_TYPES = `type RouteResponse = {
  route: {
    distance_meters: number;
    duration_seconds: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  };
  mode: "driving" | "walking";
};`;

export function geocodeExamples(apiUrl: string, q = "Sukhbaatar Square", limit = 5): CodeExample[] {
  const params: Param[] = [
    ["q", q],
    ["limit", String(limit)],
  ];
  return [
    { label: "cURL", lang: "bash", code: curlExample(apiUrl, "/v1/geocode", params) },
    {
      label: "JavaScript",
      lang: "javascript",
      code: fetchExample(
        apiUrl,
        "/v1/geocode",
        params,
        `for (const place of body.results) {\n  console.log(place.name, place.latitude, place.longitude);\n}`,
      ),
    },
    {
      label: "TypeScript",
      lang: "typescript",
      code: typedFetchExample(
        apiUrl,
        "/v1/geocode",
        params,
        GEOCODE_TYPES,
        "GeocodeResponse",
        `for (const place of body.results) {\n  console.log(place.name, place.latitude, place.longitude);\n}`,
      ),
    },
    {
      label: "Python",
      lang: "python",
      code: pythonExample(
        apiUrl,
        "/v1/geocode",
        params,
        `for place in body["results"]:\n    print(place["name"], place["latitude"], place["longitude"])`,
      ),
    },
    {
      label: "Dart",
      lang: "dart",
      code: dartExample(
        apiUrl,
        "/v1/geocode",
        params,
        `  for (final place in body['results'] as List<dynamic>) {\n    print('\${place['name']}: \${place['latitude']}, \${place['longitude']}');\n  }`,
      ),
    },
  ];
}

export function reverseGeocodeExamples(apiUrl: string, lat = 47.9184, lon = 106.9177): CodeExample[] {
  const params: Param[] = [
    ["lat", String(lat)],
    ["lon", String(lon)],
  ];
  return [
    { label: "cURL", lang: "bash", code: curlExample(apiUrl, "/v1/geocode", params) },
    {
      label: "JavaScript",
      lang: "javascript",
      code: fetchExample(apiUrl, "/v1/geocode", params, `const [match] = body.results;
if (match) console.log(match.address, match.type, match.distance_meters);`),
    },
    {
      label: "TypeScript",
      lang: "typescript",
      code: typedFetchExample(
        apiUrl,
        "/v1/geocode",
        params,
        GEOCODE_TYPES,
        "GeocodeResponse",
        `const [match] = body.results;
if (match) console.log(match.address, match.type, match.distance_meters);`,
      ),
    },
    {
      label: "Python",
      lang: "python",
      code: pythonExample(apiUrl, "/v1/geocode", params, `match = body["results"][0] if body["results"] else None
if match:
    print(match["address"], match["type"], match.get("distance_meters"))`),
    },
    {
      label: "Dart",
      lang: "dart",
      code: dartExample(apiUrl, "/v1/geocode", params, `  final results = body['results'] as List<dynamic>;
  if (results.isNotEmpty) print(results.first['address']);`),
    },
  ];
}

export function routeExamples(
  apiUrl: string,
  origin = "106.9177,47.9184",
  destination = "106.9057,47.9220",
  mode = "driving",
): CodeExample[] {
  const params: Param[] = [
    ["origin", origin],
    ["destination", destination],
    ["mode", mode],
  ];
  return [
    { label: "cURL", lang: "bash", code: curlExample(apiUrl, "/v1/route", params) },
    {
      label: "JavaScript",
      lang: "javascript",
      code: fetchExample(
        apiUrl,
        "/v1/route",
        params,
        `const { distance_meters, duration_seconds, geometry } = body.route;\nconsole.log(\`\${(distance_meters / 1000).toFixed(1)} km, \${Math.round(duration_seconds / 60)} min\`);\n// geometry is a GeoJSON LineString: add it to your map as a line layer.`,
      ),
    },
    {
      label: "TypeScript",
      lang: "typescript",
      code: typedFetchExample(
        apiUrl,
        "/v1/route",
        params,
        ROUTE_TYPES,
        "RouteResponse",
        `const { distance_meters, duration_seconds, geometry } = body.route;\nconsole.log(distance_meters, duration_seconds, geometry.coordinates.length);`,
      ),
    },
    {
      label: "Python",
      lang: "python",
      code: pythonExample(
        apiUrl,
        "/v1/route",
        params,
        `route = body["route"]\nprint(f"{route['distance_meters'] / 1000:.1f} km, {route['duration_seconds'] / 60:.0f} min")`,
      ),
    },
    {
      label: "Dart",
      lang: "dart",
      code: dartExample(
        apiUrl,
        "/v1/route",
        params,
        `  final route = body['route'] as Map<String, dynamic>;\n  print('\${route['distance_meters']} m, \${route['duration_seconds']} s');`,
      ),
    },
  ];
}
