# Production deployment hardening

## Required topology

Terminate TLS 1.2/1.3 at a managed edge/WAF or the supplied nginx profile. Bind
Next.js and FastAPI to loopback/private networking. Permit the application tier
to reach only Convex, the explicitly configured ArcGIS services, token/email
providers and required DNS/NTP. Do not expose PostgreSQL, Redis, Convex admin,
ArcGIS Server Manager, Portal admin or REST administration to the internet.

The supplied container/runtime profiles run non-root, drop capabilities,
disable privilege escalation, use read-only roots and bounded memory/PIDs/CPU.
Images must be rebuilt regularly even when application dependencies are locked.

## Production gate

Before deployment:

1. Generate distinct `API_KEY_PEPPER`, `GATEWAY_SECRET`, auth signing keys and
   other secrets in a secret manager. Do not use build arguments for secrets.
2. Set `ENVIRONMENT=production`, explicit HTTPS `PUBLIC_API_URL`, customer and
   demo CORS allowlists, `AUTH_CACHE_TTL_SECONDS=0`, trusted proxy header, and
   commercial rate/quota values.
3. Use an isolated production Convex deployment and least-privilege ArcGIS
   OAuth application. Never share staging credentials or data.
4. Confirm HTTP→HTTPS, HSTS, certificate renewal, WAF rules, request/connection
   limits, header normalization and that direct origin access is blocked.
5. Run CI, unit/security tests, a production build leak scan, dependency and
   secret scans, and an authorized active scan against staging.

The API refuses wildcard/insecure production CORS, weak/default shared secrets,
unsafe public URLs and a production authorization cache.

## WAF and DDoS strategy

- CDN/edge volumetric protection keeps floods away from ArcGIS.
- WAF managed OWASP rules, HTTP anomaly detection and IP reputation run in
  monitor mode first, then block confirmed patterns.
- Edge connection/request/body limits protect Node/Uvicorn; application limits
  remain authoritative for identity, tenant, cost and quota.
- Demo per-address/hour/global limits and ArcGIS concurrency/circuit breaker
  cap origin cost even when edge controls are bypassed.
- Autoscaling must retain hard maximums so it cannot turn an attack into an
  unbounded ArcGIS or cloud bill.

Do not automatically ban a customer on one weak signal. Alert and correlate:
one key across many networks, one network trying many keys, sustained 401/403/
429, route-heavy traffic, unusual geography, upstream latency and circuit state.

## Monitoring and alerts

Build metrics from JSON access and security-audit events. At minimum dashboard:
requests/s, latency percentiles, 401/403/429/5xx, quota exhaustion, failed-key
volume, unique trusted source networks, ArcGIS latency/errors/retries/circuit
opens and demo global consumption. Alert on error-rate/latency burn rates and
sustained deviations from the service baseline, not single requests.

Logs must be access controlled in transit and at rest. Default retention:
raw usage 30 days, security audit 365 days, daily aggregates per business/legal
policy. Exact addresses and geospatial queries are not stored in usage rows;
access logs contain the trusted source address and therefore require a privacy
retention decision.

## Backups and recovery

- Encrypt backups with a separately controlled key; restrict restores and test
  them at least quarterly.
- Document Convex export/restore, ArcGIS item/data-store recovery, DNS and
  certificate recovery, and secret-manager break-glass access.
- API keys cannot be recovered from hashes. After a lost data store, customers
  create new keys. After pepper compromise plus database exposure, rotate the
  pepper and invalidate every existing key.
- Use immutable versioned artifacts and rebuild compromised hosts from trusted
  images; never “clean” a suspected host in place.

See [incident-response.md](incident-response.md) for compromise playbooks and
[linux-hardening.md](linux-hardening.md) / [docker-hardening.md](docker-hardening.md)
for the concrete host and container controls.

