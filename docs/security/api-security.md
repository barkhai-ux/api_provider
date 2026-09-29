# API security contract

## Demo versus customer API

| Property | Anonymous demo (`/demo`) | Customer API (`/v1`) |
|---|---|---|
| Authentication | None; discovery is expected | `Authorization: Bearer geo_…` |
| Authorization | Fixed demo operations only | Key endpoint scopes |
| Rate limit | IP/network + endpoint + global, minute/hour | Key + tenant + route, per minute |
| Quota | Low demo hour/global budgets | Key/tenant/endpoint, daily/monthly cost units |
| Results | At most configured demo maximum (default 5) | Endpoint contract maximum |
| Deadline/concurrency | Independent small budget | Customer/ArcGIS pool budget |
| Cache | Public normalized geocode/reverse only | Provider cache; never cross-tenant private data |

The website calls `/demo` directly and sends no customer credential. Forged or
missing Origin/Referer/User-Agent does not bypass server-side controls.

## Keys and scopes

Keys contain about 190 bits of entropy (`crypto.getRandomValues`, unbiased
base62), are shown once and stored as `HMAC-SHA-256(API_KEY_PEPPER, key)` plus a
non-secret display prefix. Supported logical scopes are:

- `geocode:read` → `/v1/geocode`, including reverse lookup in the v1 contract
- `route:read` → `/v1/route`

The current database field is named `endpoints` for compatibility, but it is
enforced as a scope allowlist in the central Convex authorization mutation.
Prefix text is never authentication. Revoked, expired, malformed and disabled-
tenant keys fail before GIS work. Zero-downtime rotation is create-new,
migrate, revoke-old; “regenerate” intentionally invalidates the old secret.

## Limits and quotas

Rate limiting uses distributed fixed windows in Convex and returns `429` plus
`Retry-After` and `X-RateLimit-*`. Edge limits are an additional layer. Cost
units distinguish expensive work: geocode/reverse default to one and route to
five. Customer quota buckets are derived from the authenticated key and owner:

- per key: daily and monthly;
- per tenant: daily and monthly across keys;
- per tenant and endpoint: monthly.

Denied work does not consume quota. Usage shown in the developer console is
server-derived. The quota defaults are plan placeholders and must be set to the
commercial plan values before launch.

## Input and response policy

- Only documented GET operations are enabled; other methods receive 405.
- Header count/bytes, URL bytes, parameter count, duplicate parameters and body
  bytes are bounded before route work.
- Coordinates reject NaN/infinity and out-of-range values. Route strings,
  query length, results and upstream records are bounded.
- Unknown and duplicate parameters are rejected by FastAPI before authentication
  or demo accounting, and route inputs use typed schemas/signatures.
- ArcGIS destinations are never accepted from a request. Fields, WHERE clauses,
  geometries and travel modes are constructed or allowlisted by adapters.
- Responses are typed, size-bounded at proxy/upstream boundaries, JSON only,
  `no-store` where authenticated, and use the standard error envelope.

## Errors

Clients receive stable codes including `INVALID_API_KEY`, `API_KEY_REVOKED`,
`ENDPOINT_NOT_ALLOWED`, `RATE_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED`,
`REQUEST_TIMEOUT`, `UPSTREAM_ERROR` and `SERVICE_UNAVAILABLE`. Every error has
an `X-Request-ID`/body request id. Stack traces, URLs, ArcGIS bodies, filesystem
paths and database/framework details remain in protected redacted logs only.

## Reproducible local checks

Never run load or attack tests against production.

```bash
# Customer authentication
curl -i 'http://localhost:8000/v1/geocode?q=Ulaanbaatar'
export API_KEY='replace-with-a-local-test-key'
curl -i -H "Authorization: Bearer ${API_KEY}" \
  'http://localhost:8000/v1/geocode?q=Ulaanbaatar'

# Discoverable anonymous demo; repeat to observe 429 + Retry-After
for i in $(seq 1 25); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    'http://localhost:8000/demo/geocode?q=Ulaanbaatar&limit=5'
done

# Origin is not authentication
curl -i -H 'Origin: https://forged.example' -H 'Referer: https://forged.example/' \
  'http://localhost:8000/demo/geocode?q=Ulaanbaatar'

# Validation and SSRF-shaped input
curl -i 'http://localhost:8000/demo/geocode?q=ab&url=http://169.254.169.254/'
curl -i 'http://localhost:8000/demo/reverse?lat=91&lon=106.9'
```

Automated suites:

```bash
cd apps/api && uv run pytest
npm test --workspace @geo-platform/convex
npm test --workspace @geo-platform/web
npm run typecheck --workspaces --if-present
```
