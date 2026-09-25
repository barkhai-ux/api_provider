# Rate limiting and resource limits

## Layers

| # | Layer | Key | Default | Where |
|---|---|---|---|---|
| 1 | Edge (self-hosted) | client IP | API 20 r/s (burst 40), website 30 r/s, `/api/auth` 10 r/min; 50 connections | `deploy/nginx/geo-platform.conf` |
| 2 | Website auth throttle | visitor IP (trusted header only) | 60 `POST /api/auth` per 10 min | `apps/web/proxy.ts` |
| 3 | API request shape | request | query ≤ 2048 bytes and ≤ 16 parameters, no duplicates; headers ≤ 64 and ≤ 16 KB; body ≤ 16 KB | `RequestLimitsMiddleware`, `BodySizeLimitMiddleware` |
| 4 | API failed authentication | client IP | 60 failures per minute, then 429 before any lookup; known-bad hashes cached 30 s | `app/core/abuse.py` |
| 5 | Per key | API key | 100/min (`RATE_LIMIT_PER_MINUTE`, or the key's own limit) | Convex `gateway:authorize` |
| 6 | Per account | user | max(key limit, 300/min) across all keys (`ACCOUNT_RATE_LIMIT_PER_MINUTE`) | Convex |
| 7 | Per endpoint | key (or visitor) + `route` | 30/min for routing (`ROUTE_RATE_LIMIT_PER_MINUTE`) | Convex |
| 8 | Site key per visitor | visitor IP (IPv6 by /64), stored as a keyed hash | 60/min (`SITE_KEY_PER_IP_PER_MINUTE`) | API + Convex |
| 9 | Site key overall | site key | the key's limit (10,000/min when registered) | Convex |
| 10 | Upstream budget | process | 16 concurrent ArcGIS calls, 5 s queue, 8 s per attempt, 32 MB per response | `ArcGISFeatureServerClient` |

Layers 5–9 are fixed one-minute windows stored in Convex, shared by all API instances; a client can get up to twice a limit across a window boundary. Layers 2 and 4 are in memory per instance.

Creating more keys does not raise the ceiling (layer 6); rotating IPs does not help with a key (layers 5–7 are per key and account); rotating User-Agent or other headers changes nothing.

## Which client address is trusted

Forwarding headers are client-controlled unless a trusted proxy overwrites them.

| Deployment | Website | API |
|---|---|---|
| Render (behind Cloudflare) | `CLIENT_IP_HEADER=cf-connecting-ip` | `CLIENT_IP_HEADER=cf-connecting-ip` |
| Self-hosted behind `deploy/nginx` | `CLIENT_IP_HEADER=x-real-ip` (nginx overwrites it) | `CLIENT_IP_HEADER=x-real-ip` (the API port is reachable only from the host) |
| Direct exposure (local Docker) | none: forwarding headers ignored | peer address |

When the website does not know the visitor's address, it sends none; the API then limits all anonymous map traffic as one visitor (fail closed). The two in-memory failure limits (website auth throttle, API failed-authentication limit) are skipped when the address is unknown rather than shared: a shared bucket would let one client lock everyone out. Behind any proxy, configure `CLIENT_IP_HEADER`; otherwise every client appears with the proxy's address. The API honours `X-Client-IP` only on requests made with the site key, whose secret only the website holds.

After deploying on Render, confirm that `cf-connecting-ip` reaches the services: make a few map searches from two networks and check that `X-RateLimit-Remaining` counts separately.

## Expensive operations

- Routing has its own lower limit (layer 7) and ArcGIS Network Analyst calls share the upstream budget (layer 10).
- Geocoding resolves at most `limit` (≤ 20, default 5) locator suggestions; search text is capped at 200 characters and, for FeatureServer search, at 8 unique words.
- Reverse geocoding tries at most the configured radii (100/500/2000 m by default).
- `/health/ready` runs its checks at most once every 15 seconds.

## Responses

429 with `Retry-After` (seconds until the window resets) and `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every `/v1` response that reached the limiter. The body is the standard envelope with code `RATE_LIMIT_EXCEEDED`; it names no internal bucket.
