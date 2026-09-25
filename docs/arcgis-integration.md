# ArcGIS integration

The public API never exposes ArcGIS. The gateway reads your ArcGIS GeocodeServer (locator), Network Analyst route service and FeatureServer layers through one adapter (`apps/api/app/services/arcgis/`) and returns the platform's own schemas. This page explains what the adapter expects and how to configure it.

## GeocodeServer (locator)

Set `ARCGIS_GEOCODE_SERVER` to a locator URL, for example:

```
https://arcgis.ubhub.mn/arcgis/rest/services/locator/MN_OrtsGarts_POI/GeocodeServer
```

When set, the locator answers both geocoding endpoints, and any FeatureServer layers below become fallbacks.

**`/v1/geocode`**
- `suggest` finds matches for partial text in Latin or Cyrillic. `findAddressCandidates` alone only matches complete names.
- Each suggestion is then resolved to coordinates with `findAddressCandidates` and its `magicKey`: up to 6 at a time (`LOCATOR_RESOLVE_CONCURRENCY`), `maxLocations=1`, `outSR=4326`.
- Results keep the locator's ranking. Duplicates (same name and location) are dropped.
- Candidate fields map to the public schema as follows:

  | Public field | Locator field |
  |---|---|
  | `name` | `PlaceName` without the area suffix ("Name, 6-р хороо, District" → "Name") |
  | `address` | `Nbrhd`, `City`, `Subregion`, `Region`, plus `ADDRESS_DEFAULT_COUNTRY` |
  | `type` | `Type`, or `Addr_type` when `Type` is `Other`; lower-cased, e.g. `poi` |
  | `id` | stable hash of the name and location (`loc_…`) |

**`/v1/geocode` (reverse: `lat` & `lon`)**
- `reverseGeocode` runs with an expanding `distance`: 100 m, then 500 m, then 2 km.
- The locator answers a miss with HTTP 400 "Unable to find address for the specified location". The adapter treats that as "nothing here" and tries the next radius, then returns `404 NOT_FOUND`.
- Field mapping:

  | Public field | Locator field |
  |---|---|
  | `formatted` | `LongLabel` with repeated parts removed, plus the country |
  | `neighborhood` | `Neighborhood` (khoroo or bag) |
  | `district` | `City` (düüreg or sum) |
  | `city` | `Subregion` or `Region` |
  | `match_type` | `Addr_type`: `POI` → `place`; `PointAddress` and similar → `address`; `StreetName` and similar → `street` |

- The locator's `CntryName` is ignored; `ADDRESS_DEFAULT_COUNTRY` is used instead.

Readiness (`/health/ready`) checks the locator by reading its service description.

## Network Analyst route service

Set `ARCGIS_ROUTE_SERVICE` to a route layer, for example:

```
https://arcgis.ubhub.mn/arcgis/rest/services/NA_UBRoute_ds_xff8y7t7kflg7lgn/NetworkAnalysis/NAServer/Route
```

When set (with `ROUTING_PROVIDER=auto`, the default), the route service answers `/v1/route`, and the road-layer graph below is not used.

**Travel mode.** The layer description is read once to learn travel modes, cost attributes and units. Each public mode maps to a travel mode:
- `driving` uses a travel mode of type `AUTOMOBILE`;
- `walking` uses a travel mode of type `WALK`;
- time-based modes (for example "Driving Time") are preferred over distance-based ones;
- to choose exact names, set `ROUTING_NA_DRIVING_TRAVEL_MODE` and `ROUTING_NA_WALKING_TRAVEL_MODE`.

A public mode with no matching travel mode answers `400 INVALID_REQUEST` (`field: mode`).

**Solve.** `solve` is sent as a POST form with:
- two stops in WGS84;
- `outSR=4326` and `outputLines=esriNAOutputLineTrueShape`;
- directions off;
- the travel mode's time and distance attributes accumulated.

**Results.**
- `Total_<time attribute>` and `Total_<distance attribute>` are converted to seconds and meters using each attribute's units.
- If no distance attribute is available, distance comes from the geometry.
- Snapped waypoints are the first and last route vertices. `DistanceToNetworkInMeters` gives the snap distance when the service reports it.

**Failures.**
- "Stop is unlocated" answers `404` with `reason: origin_not_on_network` or `destination_not_on_network`.
- "No solution found" answers `404` with `reason: no_path`.
- Other solve errors answer `502 UPSTREAM_ERROR`.

## Authentication (secured services)

ArcGIS Enterprise services that answer `499 Token Required` need a token. Two options:

| Option | Settings | Behavior |
|---|---|---|
| OAuth app (client credentials) | `ARCGIS_CLIENT_ID`, `ARCGIS_CLIENT_SECRET`, usually `ARCGIS_TOKEN_REFERER` | Tokens come from `https://<server>/arcgis/sharing/rest/oauth2/token` (`grant_type=client_credentials`), cached and renewed like the service-account tokens. If the portal answers "Invalid Referer", set `ARCGIS_TOKEN_REFERER` to one of the app's registered redirect URIs. The app identity must be allowed to use each secured service. |
| Service account | `ARCGIS_USERNAME`, `ARCGIS_PASSWORD` | Tokens come from `generateToken`: `ARCGIS_TOKEN_URL`, by default `https://<server>/arcgis/sharing/rest/generateToken`. They are cached, renewed 5 minutes before they expire (`ARCGIS_TOKEN_EXPIRATION_MINUTES`), and renewed once more if a service rejects one (498/499). |
| Static token | `ARCGIS_TOKEN` | Used as is. |

- Tokens are bound to the API server's IP address (`client=requestip`) by default. Set `ARCGIS_TOKEN_REFERER` to bind them to a Referer instead; the gateway then sends that Referer with every request.
- Tokens travel in the `X-Esri-Authorization` header, never in URLs.
- Credentials and tokens are never logged or returned.
- Use an account that can only read the services the platform needs.

## Layers

| Variable | Used by | Geometry | Notes |
|---|---|---|---|
| `ARCGIS_GEOCODING_FEATURE_SERVER` | `/v1/geocode`, reverse fallback | points (lines/polygons also work: a representative point is used) | named places |
| `ARCGIS_REVERSE_GEOCODING_FEATURE_SERVER` | `/v1/geocode` (reverse) | points | address points |
| `ARCGIS_ROUTING_FEATURE_SERVER` | `/v1/route`, reverse fallback | polylines | road centerlines |

- Each value is a layer URL (`…/FeatureServer/<id>`). A service URL (`…/FeatureServer`) means layer 0.
- Layers may use any spatial reference: the adapter always requests `outSR=4326`.
- Secured services: set `ARCGIS_TOKEN`. It is sent as `X-Esri-Authorization: Bearer <token>`, never in the URL.
- Token errors (498/499) surface as `502 UPSTREAM_ERROR` and are logged.

## Field mapping

Map your attribute names with environment variables. Set a variable to empty when your layer lacks that field.

**Places layer** (`ARCGIS_PLACES_*`)

| Variable | Default | Meaning |
|---|---|---|
| `NAME_FIELD` | `name` | display name, searched |
| `ALT_NAME_FIELD` | `alt_name` | second searched name, for example the Mongolian Cyrillic name |
| `ADDRESS_FIELD` | `address` | short address shown under the name |
| `TYPE_FIELD` | `type` | category returned as `type` (lower-cased) |
| `IMPORTANCE_FIELD` | `importance` | number; higher ranks first among equal matches |

**Addresses layer** (`ARCGIS_ADDRESSES_*`)

| Variable | Default | Meaning |
|---|---|---|
| `FORMATTED_FIELD` | `address` | full formatted address, if your data has one |
| `NAME_FIELD` | `name` | building or place name |
| `HOUSE_NUMBER_FIELD` | `house_number` | |
| `STREET_FIELD` | `street` | |
| `DISTRICT_FIELD` | `district` | |
| `CITY_FIELD` | `city` | falls back to `ADDRESS_DEFAULT_CITY` |
| `COUNTRY_FIELD` | `country` | falls back to `ADDRESS_DEFAULT_COUNTRY` |

When there is no formatted address, one is composed from name, house number, street, district, city and country.

**Roads layer** (`ARCGIS_ROADS_*`)

| Variable | Default | Meaning |
|---|---|---|
| `NAME_FIELD` | `name` | street name (reverse fallback, waypoint names) |
| `CLASS_FIELD` | `road_class` | road class, matched against the speed table and exclusions (lower-cased) |
| `ONEWAY_FIELD` | `oneway` | see "One-way streets" below |
| `SPEED_FIELD` | `speed_kmh` | optional speed in km/h; empty means use the class speeds |

## How the endpoints use the data

### Geocoding

1. The query is cleaned to letters of any script, digits, spaces and a little punctuation.
   - SQL wildcards are removed.
   - Quotes are escaped.
2. Two queries run in parallel:
   - prefix: `UPPER(name) LIKE 'Q%'` on each searched field;
   - contains: every word must appear.
3. Results are ranked:
   1. exact name;
   2. prefix;
   3. every word is a word prefix;
   4. contains.

   Ties are broken by importance, then by the shorter name.
4. Candidates per query are capped by `GEOCODE_CANDIDATE_LIMIT` (default 50).

### Reverse geocoding

The search widens by radius, `REVERSE_GEOCODE_RADII_METERS`: 100 m, then 500 m, then 2 km. At each radius it tries three layers in order:

1. nearest address point;
2. nearest named place;
3. nearest named road.

The first match wins. `match_type` in the response tells the client which layer produced it. Nothing found within the last radius returns `404 NOT_FOUND`.

### Routing

The road layer is loaded once into an in-memory graph. Loading happens at startup, and again in the background every `ROUTING_GRAPH_TTL_SECONDS`.

**Graph build**
- Features are paged by OBJECTID. The whole layer is read, up to `ROUTING_MAX_FEATURES`.
- A count query runs first. A larger layer answers `503` instead of exhausting memory.
- Every polyline vertex is a node. Vertices are joined by coordinates rounded to about 0.1 m, so junctions in the middle of a line connect.
- Multipart lines are supported.

**Travel modes**

| | Driving | Walking |
|---|---|---|
| Road classes | all except `ROUTING_DRIVING_EXCLUDED_CLASSES` | all except `ROUTING_WALKING_EXCLUDED_CLASSES` |
| Speed | the speed field, or the per-class table (`ROUTING_DRIVING_SPEEDS_KMH`), capped at `ROUTING_DRIVING_MAX_SPEED_KMH` | `ROUTING_WALKING_SPEED_KMH` |
| One-way streets | respected | ignored |

**Snapping**
- Origin and destination snap to the nearest road segment the mode may use, within `ROUTING_MAX_SNAP_METERS`.
- Snapping only considers the largest connected part of the network. Isolated fragments, such as a disconnected parking aisle, are ignored.

**Limits**
- Straight-line distance is capped by `ROUTING_MAX_DISTANCE_KM` (`400`).
- Search size is capped by `ROUTING_MAX_EXPANSIONS` (`404` with `reason: "search_limit"`).

**Memory**
- Expect roughly 100–200 bytes per road vertex, per API process.
- A city network of 50k segments takes tens of MB.
- Run one API worker per container and scale with containers.

#### One-way streets

`ONEWAY_FIELD` values are matched against two lists:

- `ARCGIS_ONEWAY_FORWARD_VALUES` (default `FT,yes,true,1,Y,T`): traffic flows in the direction the line was digitized.
- `ARCGIS_ONEWAY_REVERSE_VALUES` (default `TF,-1,reverse`): traffic flows against the digitized direction.

Any other value means two-way.

## Resilience

| Condition | Behavior | Public result |
|---|---|---|
| Connect errors, HTTP 429/502/503/504, ArcGIS error bodies with code ≥ 500 | retried (`ARCGIS_MAX_RETRIES`, exponential backoff with jitter) | `502 UPSTREAM_ERROR` once retries run out |
| Read timeouts (`ARCGIS_TIMEOUT_SECONDS`) | fail fast, no retry | `408 REQUEST_TIMEOUT` |
| ArcGIS error bodies (HTTP 200 with `{"error": …}`) or malformed JSON | rejected | `502 UPSTREAM_ERROR` |
| Missing configuration or oversized road layer | not attempted | `503 SERVICE_UNAVAILABLE` |

- Error messages and logs never contain the FeatureServer URL or token.
- Readiness (`GET /health/ready`) fetches each layer's metadata and reports `ok`, `fail` or `not_configured`, without URLs.

## Replacing ArcGIS or adding providers

Providers implement small protocols in `app/services/geo/base.py`:

```python
class GeocodingProvider(Protocol):
    async def search(self, text: str, limit: int) -> list[Place]: ...

class ReverseGeocodingProvider(Protocol):
    async def reverse(self, point: Coordinate) -> AddressMatch | None: ...

class RoutingProvider(Protocol):
    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult: ...
    async def warm_up(self) -> None: ...
```

To switch a data source, for example to an ArcGIS Network Analyst route service or another geocoder:

1. Implement the protocol.
2. Translate that source's failures into `GeoProviderTimeout`, `GeoProviderUnavailable`, `GeoServiceUnavailable` or `GeoProviderError`.
3. Construct the provider in `app/services/geo/factory.py`. `ROUTING_PROVIDER` is the switch for routing.

Endpoints, response schemas, errors and the OpenAPI document stay unchanged.

To add a travel mode:
1. Add a profile in `build_travel_profiles` (`app/services/arcgis/providers.py`).
2. Add a value to `TravelMode` (`app/schemas/geo.py`).
3. Regenerate the OpenAPI types (`npm run generate:types`).
