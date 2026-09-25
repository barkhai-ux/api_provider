# ArcGIS security

The API gateway is the only component that talks to ArcGIS. Browsers only ever see the public Esri basemap style (`basemaps.arcgis.com`), never the internal locator, route service or credentials.

## Boundary

```text
FastAPI route ─► GeoServices provider ─► ArcGISFeatureServerClient ─► configured ArcGIS URL
                  (normalizes, maps       (token, timeouts, retries,
                   errors to /v1 codes)    size/concurrency limits,
                                           error-body detection)
```

`apps/api/app/services/arcgis/` holds the adapter: `client.py` (HTTP, retries, limits), `auth.py` (token providers), `locator.py` (GeocodeServer), `network_analyst.py` (NAServer), `providers.py` (FeatureServer fallbacks), `where.py` (safe WHERE clauses).

| Concern | Control |
|---|---|
| Destination | Only `ARCGIS_*` URLs from configuration, validated at start-up (see [ssrf.md](ssrf.md)) |
| Timeouts | `ARCGIS_TIMEOUT_SECONDS` (8 s) per attempt, covering the whole body; overall deadline across retries |
| Retries | Only connect errors and 429/502/503/504, exponential backoff with jitter, `ARCGIS_MAX_RETRIES` (2); read timeouts are not retried |
| Concurrency | `ARCGIS_MAX_CONCURRENCY` (16) shared by all calls; waiting longer than `ARCGIS_QUEUE_TIMEOUT_SECONDS` (5 s) gives 503 |
| Response size | `ARCGIS_MAX_RESPONSE_BYTES` (32 MB) on decoded bytes |
| Redirects | Never followed |
| Validation | Pydantic models for every response shape; ArcGIS "HTTP 200 with an `error` body" detected; unknown shapes are errors |
| Query building | WHERE clauses escape quotes and LIKE wildcards and allow only letters, digits and a few separators (Latin and Cyrillic); at most 8 search words |
| Error translation | Timeouts → 408 `REQUEST_TIMEOUT`, unreachable/overloaded → 503, rejected or malformed → 502 `UPSTREAM_ERROR`, no location/route → 404; ArcGIS messages, URLs, tokens and `httpx` text are never returned |
| Cost | Geocoding resolves only `limit` suggestions; routing has its own rate limit; `/health/ready` is cached for 15 s |

## Credentials and tokens

Precedence: OAuth app (`ARCGIS_CLIENT_ID` + `ARCGIS_CLIENT_SECRET`) → service account (`ARCGIS_USERNAME` + `ARCGIS_PASSWORD`) → static token (`ARCGIS_TOKEN`).

- All are server-side settings of the API only; never `NEXT_PUBLIC_*`, never in images, never in the browser, never in logs (redaction covers `AAP…` tokens, `client_secret=`, `password=` and bearer values).
- Tokens are sent in the `X-Esri-Authorization` header, never in URLs.
- Generated tokens are cached and renewed before expiry (at most a fifth of their lifetime early); one renewal at a time (lock), a 5-second backoff after the token service fails, and a rejected token (498/499) is dropped only if it is still the current one, then the request is retried once.
- `ARCGIS_TOKEN_EXPIRATION_MINUTES` (default 60) keeps generated tokens short-lived. Prefer the OAuth app; a static token cannot be renewed and should be scoped and short-lived.
- `ARCGIS_TOKEN_REFERER` binds tokens to a Referer that the gateway sends itself on server-to-server calls.

## Least privilege (action required)

Use a dedicated ArcGIS identity that can only:

- use the locator (GeocodeServer) and route service (NAServer) items the platform needs, and
- hold the routing privilege (`premium:user:networkanalysis:routing`) and nothing administrative.

During setup, the credential used for routing had many `portal:admin:*` privileges. A leak of such a credential would expose the whole portal, not just the two services. Create a separate OAuth app or user with the minimal role, share only the two items with it, rotate the old credential, and update `ARCGIS_CLIENT_ID`/`ARCGIS_CLIENT_SECRET` (or `ARCGIS_TOKEN`). See [incident-response.md](incident-response.md#arcgis-credentials).

## Testing boundaries

Tests use mocked ArcGIS responses (`respx`, `httpx.MockTransport`). Do not load-test or fuzz the real ArcGIS services: they are third-party infrastructure (see [penetration-testing.md](penetration-testing.md)).
