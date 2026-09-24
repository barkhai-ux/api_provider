# Geo Platform

Geocoding, reverse geocoding and routing APIs for Mongolia, with a public map, a developer portal, documentation, an in-browser API playground and a live usage dashboard.

Your ArcGIS FeatureServer layers are the data source, but they stay an internal detail: clients only ever see the platform's own versioned contract at `https://api.YOUR_DOMAIN/v1`. The public map on the website uses that same API.

## Contents

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Environment variables](#environment-variables)
- [Data storage (Convex)](#data-storage-convex)
- [ArcGIS configuration](#arcgis-configuration)
- [Running locally without Docker](#running-locally-without-docker)
- [Running tests](#running-tests)
- [API documentation](#api-documentation)
- [Deployment](#deployment)
- [Security](#security)
- [Project structure](#project-structure)
- [Design decisions and deviations from the original spec](#design-decisions-and-deviations-from-the-original-spec)

## Architecture

```mermaid
flowchart TB
    subgraph Clients
        dev["Developer apps<br/>(any HTTP client)"]
        browser["Browser"]
    end

    subgraph Web["Next.js website (apps/web)"]
        pages["Map · Developers · Docs · Dashboard"]
        bff["/api/v1/* proxy<br/>(adds server-only SITE_API_KEY)"]
        authproxy["/api/auth (Convex Auth)<br/>/api/session · /api/playground/*"]
    end

    subgraph API["Public API gateway (apps/api, FastAPI)"]
        gw["/v1/geocode · /v1/reverse-geocode · /v1/route"]
        svc["Service layer<br/>GeocodingService · ReverseGeocodingService · RoutingService"]
        adapter["ArcGISFeatureServerClient + providers<br/>(pagination, retries, timeouts, validation)"]
        graph["In-memory road graph + A*"]
    end

    subgraph Convex["Convex (self-hosted, apps/convex)"]
        auth["Convex Auth: users, sessions"]
        keys["API keys (hashed)"]
        usage["Usage: requests + daily rollups"]
        rl["Rate-limit windows"]
    end

    arcgis[("ArcGIS FeatureServer<br/>(internal)")]

    dev -->|"Bearer geo_live_…"| gw
    browser --> pages
    pages --> bff --> gw
    pages -->|"live queries (dashboard)"| Convex
    pages --> authproxy --> Convex
    gw -->|"/gateway/authorize<br/>/gateway/usage (shared secret)"| Convex
    gw --> svc --> adapter --> arcgis
    svc --> graph
    adapter -.->|"road layer"| graph
```

### Request flow for `GET /v1/geocode`

```mermaid
sequenceDiagram
    participant C as Client
    participant G as API gateway
    participant X as Convex
    participant A as ArcGIS FeatureServer
    C->>G: GET /v1/geocode?q=… (Authorization: Bearer key)
    G->>G: validate format, HMAC-SHA256(pepper, key)
    G->>X: POST /gateway/authorize {hash}
    X-->>G: principal + rate-limit window (or invalid / revoked / rate_limited)
    G->>A: /query (prefix + contains, outSR=4326)
    A-->>G: Esri JSON
    G->>G: rank, normalize to the public schema
    G-->>C: 200 {query, results, count} + X-RateLimit-*
    G--)X: batched usage records (every second, off the request path)
```

What each component does:

- **API gateway** (`apps/api`): the public contract. It authenticates keys by hash, enforces rate limits, validates parameters and maps every failure to one error envelope. It talks to ArcGIS only through the adapter, and it is stateless apart from caches.
- **ArcGIS adapter** (`app/services/arcgis`): the only code that knows the ArcGIS REST protocol. It covers:
  - OBJECTID keyset pagination;
  - retries with backoff for transient failures;
  - timeouts;
  - detection of ArcGIS "HTTP 200 with an `error` body" responses;
  - Pydantic validation;
  - Esri JSON to GeoJSON conversion;
  - safe WHERE clauses;
  - field mapping from env vars.

  To replace ArcGIS, write new provider classes and wire them in `app/services/geo/factory.py`. Endpoints and schemas stay the same.
- **Convex**: developer accounts (Convex Auth, password + reset codes), API keys (HMAC-peppered hashes only), rate-limit counters, raw usage and daily rollups. The dashboard subscribes to live queries, so usage updates without refresh.
- **Website** (`apps/web`): Next.js 16 App Router.
  - The map and the landing-page demo call `/api/v1/*` on the same origin. The Next server forwards those calls to the public API with a key that never reaches the browser.
  - The API playground calls the public API directly, using a 15-minute playground token for one of the developer's keys.

## Requirements

- Docker with Compose v2 (to run everything).
- For local development: Node.js ≥ 20.9 (22 recommended), npm 10, Python 3.12+ and [uv](https://docs.astral.sh/uv/).

## Quick start (Docker Compose)

```bash
cp .env.example .env         # optional: every value has a development default
docker compose up --build
```

| Service | URL | Notes |
|---|---|---|
| Website | http://localhost:3000 | map, developer portal, docs, dashboard |
| Public API | http://localhost:8000/v1 | `/docs`, `/redoc`, `/openapi.json` |
| Convex | http://127.0.0.1:3210 (API), http://127.0.0.1:3211 (HTTP actions) | bound to localhost |
| Convex dashboard (optional) | http://127.0.0.1:6791 | `docker compose --profile tools up convex-dashboard`; admin key: `docker compose exec convex-backend ./generate_admin_key.sh` |

The `convex-deploy` one-shot job pushes the Convex functions and sets the deployment's environment. It also generates the session signing keys once and registers the website's key. In development it seeds a demo account:

> **DEVELOPMENT ONLY**: `demo@example.com` / `demo-password-dev-only`, API key `geo_test_DevOnlyDemoKey000000000000000000`.
> These predictable values are refused when `ENVIRONMENT=production`.

```bash
curl "http://localhost:8000/v1/geocode?q=Ulaanbaatar" \
  -H "Authorization: Bearer geo_test_DevOnlyDemoKey000000000000000000"
```

Until you configure ArcGIS layers, data endpoints answer `503 SERVICE_UNAVAILABLE`, and `GET /health/ready` reports them as `not_configured`. Authentication, rate limiting and usage tracking work regardless.

> If your Docker CLI points at an inactive context (for example Docker Desktop is not running), use `DOCKER_CONTEXT=default docker compose up --build`.

## Environment variables

Every variable is documented in [`.env.example`](.env.example). The important ones:

**Web**
- `NEXT_PUBLIC_API_URL`: public API origin (docs, playground). Build-time.
- `NEXT_PUBLIC_CONVEX_URL`: Convex URL for browsers. Build-time.
- `NEXT_PUBLIC_MAP_STYLE_URL`: basemap style. Build-time. The default is Esri's World Street Map (ArcGIS vector tiles, no key). ArcGIS `VectorTileServer` styles are adapted for MapLibre automatically, and any other MapLibre style URL also works, for example the ArcGIS Basemap Styles service with `?token=`. Esri's terms expect an ArcGIS account for production use of its basemaps; set a keyed style URL before going live.
- `API_INTERNAL_URL`, `CONVEX_URL`: the same services as seen from the web server. Runtime, server only.

**Shared secrets** (must match across services)
- `API_KEY_PEPPER`: HMAC pepper for API keys (API + Convex).
- `GATEWAY_SECRET`: protects Convex `/gateway/*` (API + Convex).
- `SITE_API_KEY`: the website's own key (web + API + Convex).

**Convex**
- `CONVEX_INSTANCE_SECRET`, `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`
- `EMAIL_BACKEND` (`console` or `resend`), `RESEND_API_KEY`, `EMAIL_FROM`: password reset emails.
- `USAGE_RETENTION_DAYS`: raw request retention.

**API**
- `RATE_LIMIT_PER_MINUTE` (default 100), `SITE_KEY_PER_IP_PER_MINUTE`, `CORS_ORIGINS`, `CACHE_GEOCODE_TTL_SECONDS`.

**ArcGIS**
- `ARCGIS_GEOCODING_FEATURE_SERVER`, `ARCGIS_REVERSE_GEOCODING_FEATURE_SERVER`, `ARCGIS_ROUTING_FEATURE_SERVER`, `ARCGIS_TOKEN`, plus field mappings and routing limits. See below.

A missing `ENVIRONMENT` counts as **production**. In production the API refuses to start when any secret still has a development default or is shorter than 32 characters.

## Data storage (Convex)

Accounts, keys, usage and rate limits live in a self-hosted [Convex](https://www.convex.dev/) backend. It runs with SQLite in the `convex-data` volume by default; set `POSTGRES_URL` on `convex-backend` to use PostgreSQL. The schema is defined in [`apps/convex/convex/schema.ts`](apps/convex/convex/schema.ts), and Convex applies it on deploy, so there are no migration files.

| Table | Purpose | Indexes |
|---|---|---|
| `users` (+ Convex Auth tables `authAccounts`, `authSessions`, …) | developer accounts; password hash (scrypt) lives in `authAccounts` | `email` |
| `apiKeys` | name, `keyPrefix`, `keyHash`, environment, `lastUsedAt`, `expiresAt`, `revokedAt`, optional per-key limit | `by_key_hash`, `by_user` |
| `apiRequests` | key, user, endpoint, method, status, response time, timestamp | `by_user_time`, `by_key_time`, `by_time` |
| `usageDaily` | per key/endpoint/UTC-day totals for dashboards | `by_user_day`, `by_key_endpoint_day` |
| `rateLimitWindows` | fixed one-minute counters per key (or per visitor IP for the site key) | `by_bucket_window`, `by_window` |
| `playgroundTokens` | 15-minute tokens for the docs playground | `by_token_hash`, `by_expires` |

A cron job prunes expired windows, tokens and old raw requests every 10 minutes.

### Using Convex Cloud instead

1. Put the deployment's URLs and a deploy key in `.env`:

   ```env
   CONVEX_DEPLOY_KEY=...                                   # Dashboard > Settings > Deploy keys
   NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
   CONVEX_URL=https://<deployment>.convex.cloud
   CONVEX_SITE_URL=https://<deployment>.convex.site
   ```

2. Use fresh random values for `API_KEY_PEPPER`, `GATEWAY_SECRET` and `SITE_API_KEY`, and set `SEED_DEMO_ACCOUNT=false`. The deployment is reachable from the internet, so development defaults are unsafe.
3. Run `docker compose up --build`. The `convex-deploy` job pushes the functions to the cloud; the local `convex-backend` container stays idle.

Without a deploy key, you can deploy from a machine where `npx convex login` has run:

```bash
set -a; . ./.env; set +a
CONVEX_DEPLOYMENT=dev:<deployment> SITE_URL=http://localhost:3000 apps/convex/scripts/deploy.sh
```

## ArcGIS configuration

**Geocoding and reverse geocoding: a GeocodeServer (locator).** This is the recommended source; the configured example is the Orts Garts POI locator:

```env
ARCGIS_GEOCODE_SERVER=https://arcgis.ubhub.mn/arcgis/rest/services/locator/MN_OrtsGarts_POI/GeocodeServer
```

**Routing: a Network Analyst route service.** It is secured, so the API also needs a service account (tokens are generated and renewed automatically) or a static `ARCGIS_TOKEN`:

```env
ARCGIS_ROUTE_SERVICE=https://arcgis.ubhub.mn/arcgis/rest/services/NA_UBRoute_ds_xff8y7t7kflg7lgn/NetworkAnalysis/NAServer/Route
ARCGIS_USERNAME=...
ARCGIS_PASSWORD=...
```

**Alternative routing and fallbacks: FeatureServer layers.** A road polyline layer is used for routing only when no route service is set. A service URL ending in `/FeatureServer` means layer 0.

```env
ARCGIS_GEOCODING_FEATURE_SERVER=https://gis.example.mn/arcgis/rest/services/Places/FeatureServer/0
ARCGIS_REVERSE_GEOCODING_FEATURE_SERVER=https://gis.example.mn/arcgis/rest/services/Addresses/FeatureServer/0
ARCGIS_ROUTING_FEATURE_SERVER=https://gis.example.mn/arcgis/rest/services/Roads/FeatureServer/0
ARCGIS_TOKEN=            # optional
```

For layers, map your field names with the `ARCGIS_PLACES_*`, `ARCGIS_ADDRESSES_*` and `ARCGIS_ROADS_*` variables. [`docs/arcgis-integration.md`](docs/arcgis-integration.md) describes:

- what each layer needs;
- how ranking, the reverse-geocoding fallback and routing work;
- one-way conventions;
- limits;
- how to add another provider, such as ArcGIS Network Analyst.

Check the connection with `curl http://localhost:8000/health/ready`.

## Running locally without Docker

```bash
npm install                                         # all JS workspaces
docker compose up -d convex-backend convex-deploy   # Convex + functions + dev seed

# API gateway (http://localhost:8000)
cd apps/api && cp .env.example .env && uv sync
uv run uvicorn app.asgi:app --reload

# Website (http://localhost:3000)
cp apps/web/.env.example apps/web/.env.local
npm run dev

# Convex functions with hot reload (optional)
cd apps/convex
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(docker compose exec convex-backend ./generate_admin_key.sh | tail -1)"
npx convex dev
```

## Running tests

```bash
# API gateway: unit + integration tests (ArcGIS and Convex mocked with respx)
cd apps/api && uv run pytest && uv run ruff check . && uv run mypy app

# Website: component tests (Vitest + Testing Library)
npm test --workspace @geo-platform/web

# Internal API client used by the website
npm test --workspace @geo-platform/api-client

# End-to-end (Playwright) against a running stack (docker compose up)
npx playwright install chromium
npm run test:e2e
```

**API tests** cover:
- authentication: missing, malformed, unknown, revoked and expired keys, and playground tokens;
- rate limiting, including the per-visitor site-key limit;
- geocoding, reverse geocoding and routing;
- parameter validation;
- upstream errors, timeouts and outages;
- usage recording;
- CORS, health, and OpenAPI contents and drift;
- the ArcGIS client itself: pagination, retries, error bodies, malformed responses, URL redaction;
- the routing graph: A*, one-way streets, snapping, disconnected islands, limits.

**E2E tests** cover:
- register → create key → call the API → usage appears in the dashboard → revoke → `403`;
- the playground with a connected key;
- docs navigation;
- map search and routing (with the map's API calls stubbed);
- no horizontal overflow at desktop and mobile widths.

## API documentation

- Human documentation: http://localhost:3000/developers/docs, covering getting started, authentication, each endpoint, errors, rate limits, versioning and code examples (cURL, JavaScript, TypeScript, Python, Dart).
- Interactive reference and playground: http://localhost:3000/developers/api-reference.
- OpenAPI: http://localhost:8000/openapi.json, with `/docs` (Swagger UI) and `/redoc`. It describes only the public API. A committed copy lives in `packages/types/openapi.json`.
- After changing the API, regenerate it and the TypeScript types with `npm run generate:types`. A backend test fails if the committed copy is stale.
- No SDK is offered: the API is plain HTTPS and JSON. [`packages/api-client`](packages/api-client) is an internal client the website itself uses; it is not published.

## Deployment

1. **Secrets.** Generate strong, unique values for these (for example `openssl rand -hex 32`):
   - `API_KEY_PEPPER`
   - `GATEWAY_SECRET`
   - `CONVEX_INSTANCE_SECRET`
   - `SITE_API_KEY`: `geo_live_` plus 32 letters and digits.

   Set `ENVIRONMENT=production`.
2. **Convex.** Run `convex-backend` behind TLS, for example `convex.YOUR_DOMAIN` for the API and `convex-site.YOUR_DOMAIN` for HTTP actions.
   - Set `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` to those URLs.
   - Set `REDACT_LOGS_TO_CLIENT=true`.
   - Prefer `POSTGRES_URL` for storage.
   - Run `apps/convex/scripts/deploy.sh` (or the `convex-deploy` image) on every release. Production seeds nothing.
3. **Email.** Configure password-reset email: `EMAIL_BACKEND=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. **API.** Serve it at `api.YOUR_DOMAIN`.
   - Set `PUBLIC_API_URL`.
   - Set `CORS_ORIGINS` to `*`, or to the browser origins you allow.
   - Scale by adding containers; each process holds its own road graph, so memory is roughly graph size × processes.
5. **Web.** Build the image with production `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CONVEX_URL` build args, and set `API_INTERNAL_URL`, `CONVEX_URL` and `SITE_API_KEY` at runtime.
6. **Reverse proxy.** Put a reverse proxy in front of the website that **overwrites** `X-Forwarded-For` with the client address. The per-visitor limit for the public map depends on it.
7. **Private network.** Keep `/gateway/*` reachable only by the API if you can. It is protected by `GATEWAY_SECRET` either way.

## Security

- **Passwords**: scrypt, via Convex Auth. Failed sign-ins are rate limited per account. Unknown email and wrong password return the same error.
- **API keys**:
  - format `geo_{live|test}_` + 32 base62 characters (~190 bits);
  - stored only as `HMAC-SHA256(API_KEY_PEPPER, key)`;
  - shown once;
  - regenerating replaces the hash immediately.
  - The gateway sends only the hash to Convex.
- **Sessions**:
  - Convex Auth JWTs (RS256, keys generated once per deployment).
  - The refresh token lives in an httpOnly, SameSite=Lax cookie; the `__Host-` prefix and `Secure` apply outside localhost.
  - Sign-in goes through a same-origin proxy that rejects cross-origin requests.
- **CSRF**: `/api/auth` rejects cross-origin requests (Convex Auth). `/api/playground/token` checks `Origin`/`Sec-Fetch-Site`.
- **No secrets in the browser**: the website's key and all internal URLs stay server-side. The E2E suite scans the client bundle to confirm.
- **Rate limiting**: 100 requests/minute per key by default, with `X-RateLimit-*` and `Retry-After` headers. If Convex is unreachable, requests fail closed with 503.
- **Validation and injection**:
  - strict parameter validation;
  - request body size limit;
  - ArcGIS WHERE clauses built from an allowlist of characters, with quotes escaped;
  - no SQL database in the request path.
- **Headers**: CSP on the website and API. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Cache-Control: no-store` on `/v1`.
- **Logging**: structured JSON. Keys, tokens, passwords, cookies and authorization headers are redacted. Query strings and upstream URLs are never logged or returned.
- **Upstream protection**: timeouts, bounded retries, pagination caps, a routing-graph size limit and a snap-distance limit.

## Project structure

```
apps/
  api/           FastAPI gateway: app/{api,core,schemas,services}, tests/
  convex/        Convex backend: convex/*.ts (schema, auth, gateway, keys, usage), scripts/deploy.sh
  web/           Next.js 16: app/ (routes), components/, hooks/, lib/
packages/
  api-client/    Internal API client used by the website (not published)
  types/         OpenAPI schema + generated TypeScript types
e2e/             Playwright tests
docs/            architecture.md, arcgis-integration.md
docker-compose.yml  .env.example
```

## Design decisions and deviations from the original spec

- **Convex instead of PostgreSQL + Redis + Alembic** (product decision). Convex stores accounts, keys, usage and rate limits and powers the live dashboard; FastAPI stays the public gateway. The spec's `users`, `api_keys`, `api_requests` and `sessions` tables map to the Convex tables above.
- **`JWT_SECRET` is not used.** Convex Auth signs sessions with an RS256 key pair (`JWT_PRIVATE_KEY`/`JWKS`) generated by the deploy job.
- **No mock geodata ships with the platform.** Data comes only from your ArcGIS layers. Automated tests use small inline ArcGIS-format responses.
- **Routing over a road polyline layer.** Plain FeatureServers don't compute routes, so the gateway loads the road layer into an in-memory graph and runs A*. A Network Analyst provider can be added behind the same interface.
- **Additive response fields** beyond the spec examples: `match_type` and `distance_meters` on reverse geocoding, and `mode` and `waypoints` on routing. The spec's shapes are unchanged.
