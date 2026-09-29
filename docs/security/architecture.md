# Security architecture

This document describes the implemented trust boundaries. It is an engineering
design aligned with OWASP API Security Top 10, OWASP ASVS, NIST CSF/SSDF and
CIS guidance; it is not a certification.

## Surfaces and trust boundaries

```text
Internet
  ├─ website / Next.js ──► FastAPI /demo/* ─┐
  └─ customer systems ──► FastAPI /v1/* ────┤
                                               ├─► ArcGIS adapter ─► ArcGIS Enterprise
FastAPI ── authenticated gateway channel ─► Convex (identity, keys, limits,
                                               quotas, usage, audit)
```

The browser-visible route is not secret. The browser calls FastAPI's
discoverable `/demo` API directly. Direct curl/Postman calls receive exactly
the same distributed limits as browser traffic. Origin, Referer and User-Agent
are not authentication.

`/v1` is the customer data plane. A bearer key is HMAC-SHA-256 hashed in
FastAPI and only the hash crosses the gateway boundary. Convex resolves the
key, its owner (the tenant), its project/application credential (the key id),
endpoint scope, status, rate limits and quotas. Client-supplied tenant/user/key
ids never participate in this resolution.

## Implemented request paths

### Anonymous demo

1. FastAPI derives the source address from a configured trusted edge header or
   the socket peer. Without one, all callers share `unknown` and fail closed.
2. Convex HMACs the address before storage and atomically charges minute, hour,
   per-endpoint and global cost buckets.
3. FastAPI applies a small concurrency budget and application deadline.
4. Pydantic/query validation bounds text, coordinates, route inputs and result
   count. The adapter receives no user-controlled upstream URL.
5. Public geocode/reverse results may use a short, isolated in-process cache.

Defaults: 20 units/minute/address, 100 units/hour/address, route cost 5,
maximum five results, five-second deadline, four concurrent demo operations.
Every value is configurable.

### Customer API

1. The gateway accepts exactly one correctly shaped bearer credential.
2. It hashes the credential with a server-only pepper and asks Convex to
   authorize the hash.
3. Convex checks key status, expiry, owner status and endpoint scope.
4. Distributed per-key, per-tenant and expensive-route rate limits run.
5. Durable daily/monthly key, tenant and endpoint quotas consume cost units.
6. Only then does the service call the allowlisted ArcGIS adapter.

Production refuses `AUTH_CACHE_TTL_SECONDS > 0`; this guarantees that key
revocation, tenant suspension, scope changes and quotas take effect on the
next request across all instances.

## ArcGIS boundary

Upstream URLs and credentials come only from server configuration. URL
configuration rejects unsafe schemes, embedded credentials and production
metadata/private destinations unless an operator deliberately enables a
private network. Redirects are disabled. The adapter builds an explicit set of
ArcGIS parameters, sends tokens in headers, bounds connection pools,
concurrency, queue time, attempt time and response bytes, retries selected
transient failures, and opens a circuit after repeated availability failures.
Only a single half-open probe is admitted during recovery.

## Identity and isolation model

The current product has one developer account per tenant and one API-key record
per application/project credential. Those identifiers are derived from the key
record and appear as `tenant_id` and `project_id` in structured logs. Convex
dashboard functions always obtain the account from the active server-checked
session and re-check resource ownership. Cross-account ids return a generic
not-found error. If organizations later need multiple members/projects, add
membership tables without changing the invariant: authorization must join from
the authenticated principal, never from a request tenant id.

## Data and observability

- Request logs are JSON and include request id, path, method, status, latency,
  tenant/project/key ids, trusted source address, bounded User-Agent and limit
  result. Query strings, bodies and credentials are excluded/redacted.
- `securityAuditEvents` is append-oriented and has no public query. It records
  key lifecycle, authentication, authorization, rate-limit and quota events.
- Raw request usage is retained for a configured period; daily aggregates,
  quotas and audit data have separate retention policies.
- `/health` is minimal. `/health/ready` uses generic dependency names, bounded
  checks and a shared short cache; it returns no hostnames or credentials.

## Network/deployment boundary

Production runs behind an edge/WAF and hardened reverse proxy. TLS termination,
HTTP normalization, connection/body limits and coarse denial-of-service rules
exist at the edge; FastAPI repeats application controls. The API, Convex data
plane, databases and ArcGIS administrative interfaces must not be directly
internet reachable except for intentionally public service endpoints.
