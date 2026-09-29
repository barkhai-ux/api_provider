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
| 7 | Per endpoint | key + endpoint | 100/min; routing is capped at 30/min (`ENDPOINT_RATE_LIMIT_PER_MINUTE`, `ROUTE_RATE_LIMIT_PER_MINUTE`) | Convex |
| 8 | Customer global | all authenticated traffic | 100,000/min emergency ceiling (`GLOBAL_RATE_LIMIT_PER_MINUTE`) | Convex |
| 9 | Anonymous demo | visitor network + endpoint + global | 20 units/min, 100/hour; route costs 5 | Convex `/gateway/demo-authorize` |
| 10 | Customer quotas | authenticated key + tenant + endpoint | daily/monthly configured cost units | Convex `quotaWindows` |
| 11 | Upstream budget | process | 16 concurrent ArcGIS calls, 5 s queue, 8 s per attempt, 32 MB per response, circuit breaker | `ArcGISFeatureServerClient` |

Layers 5–10 are stored in Convex and shared by all API instances. Rate limits use fixed windows (with boundary-burst risk); quotas use UTC day/month windows. Layers 2 and 4 are in memory per instance.

Creating more keys does not raise the ceiling (layers 6 and 8); rotating IPs does not help with a key (layers 5–8 are key/account/global); rotating User-Agent or other headers changes nothing.

## Which client address is trusted

Forwarding headers are client-controlled unless a trusted proxy overwrites them.

| Deployment | Website | API |
|---|---|---|
| Render (behind Cloudflare) | `CLIENT_IP_HEADER=cf-connecting-ip` | `CLIENT_IP_HEADER=cf-connecting-ip` |
| Self-hosted behind `deploy/nginx` | `CLIENT_IP_HEADER=x-real-ip` (nginx overwrites it) | `CLIENT_IP_HEADER=x-real-ip` (the API port is reachable only from the host) |
| Direct exposure (local Docker) | none: forwarding headers ignored | peer address |

When the API cannot establish a trusted visitor address, the demo uses one `unknown` bucket (fail closed). The two in-memory failure limits (website auth throttle, API failed-authentication limit) are skipped when the address is unknown rather than shared: a shared bucket would let one client lock everyone out. Behind any proxy, configure `CLIENT_IP_HEADER` and prevent direct origin access; never trust an arbitrary forwarded header.

After deploying on Render, confirm that `cf-connecting-ip` reaches the services: make a few map searches from two networks and check that `X-RateLimit-Remaining` counts separately.

## Expensive operations

- Routing has its own lower limit (layer 7) and ArcGIS Network Analyst calls share the upstream budget (layer 10).
- Geocoding resolves at most `limit` (≤ 20, default 5) locator suggestions; search text is capped at 200 characters and, for FeatureServer search, at 8 unique words.
- Reverse geocoding tries at most the configured radii (100/500/2000 m by default).
- `/health/ready` runs its checks at most once every 15 seconds.

## Responses

429 with `Retry-After` and `X-RateLimit-*` is returned on limited `/v1` and `/demo` requests. `QUOTA_EXCEEDED` uses the quota reset. Bodies never name internal buckets.
