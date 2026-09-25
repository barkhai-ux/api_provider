# Threat model

STRIDE analysis of the Ubhub Location Service as deployed on Render (website and API as containers, Convex Cloud, ArcGIS services) or self-hosted behind nginx. Findings and their status are in [`SECURITY_REPORT.md`](../../SECURITY_REPORT.md).

## System and trust boundaries

```text
            (B1)                (B2)                    (B3)                 (B4)
Browser ──HTTPS──► Next.js ──HTTPS──► FastAPI /v1 ──HTTPS──► Convex HTTP actions (/gateway/*)
   │                 │  site key        │  hash only             │
   │                 │  (server only)   │                        └─ accounts, keys, usage, limits
   │                 │                  │ (B5)
   │                 │                  └──HTTPS──► ArcGIS GeocodeServer / NAServer (token in header)
   │ (B6)            │
   └──WSS/HTTPS──► Convex (queries, mutations, Convex Auth)  ◄── session JWT
Developer servers ──HTTPS──► FastAPI /v1 (Bearer API key)                      (B7)
Operators ──SSH/CLI──► host, Render, Convex dashboard/CLI, ArcGIS portal       (B8)
```

| Boundary | Who is on the untrusted side | Authentication |
|---|---|---|
| B1 Browser → Next.js | anyone on the internet | Convex Auth session cookies (dashboard only) |
| B2 Next.js → API | the website server | site API key (per-visitor limits via X-Client-IP) |
| B3 API → Convex | the API gateway | `GATEWAY_SECRET` bearer, constant-time compare |
| B4 Convex data | every tenant | per-function session check and ownership check |
| B5 API → ArcGIS | ArcGIS responses are untrusted input | ArcGIS token / OAuth app, server side only |
| B6 Browser → Convex | any signed-in developer | Convex Auth JWT + live session check |
| B7 Developer → API | anyone holding or guessing a key | `Authorization: Bearer <key>` |
| B8 Operators | insiders, stolen admin credentials | provider accounts, SSH keys |

## Assets

| Asset | Where | Impact if lost |
|---|---|---|
| Developer accounts and sessions | Convex (`users`, `authAccounts`, `authSessions`), browser cookies | Account takeover, key theft |
| API keys | Convex stores HMAC hashes; developers hold secrets | Quota theft, impersonation in usage |
| Site API key | Website and API environment | Anonymous unlimited use of the platform's own key |
| `GATEWAY_SECRET`, `API_KEY_PEPPER` | API and Convex environment | Forged authorizations/usage (secret); offline key checks (pepper) |
| ArcGIS credentials and tokens | API environment only | Access to (and billing of) internal GIS services; with admin privileges, the portal |
| Convex deploy/admin keys | Operators, CI | Full control of the data |
| Usage and location data | Convex `apiRequests` (path, status, timing, no query strings) | Privacy of developers' traffic patterns |
| Routing and geocoding capacity | ArcGIS services | Cost, denial of service |
| Source code, images, hosts | GitHub, registries, Render/hosts | Supply-chain compromise |

## Threat actors

Anonymous internet attacker; malicious registered developer; holder of a stolen API key; attacker with a compromised developer account; malicious insider or operator; compromised dependency or base image; compromised container; attacker on the host.

## STRIDE by boundary

Each row: threat → attack path → mitigation (code) → residual risk → test.

### B1 Browser → Next.js

| STRIDE | Threat and attack path | Mitigation | Residual | Test |
|---|---|---|---|---|
| S | Phishing via open redirect after sign-in (`?next=/%09/evil`) | `safeNextPath` resolves with the URL parser, rejects control characters and other origins (`lib/auth-errors.ts`) | none known | `auth-errors.test.tsx`, E2E `the sign-in redirect cannot leave the site` |
| T | XSS through ArcGIS names, key names, profile names, docs | React escaping; popups use `textContent`; Shiki renders static samples on the server; nonce CSP with `strict-dynamic` blocks injected scripts (`proxy.ts`, `lib/csp.ts`) | `style-src 'unsafe-inline'`; Convex Auth keeps the access JWT in localStorage, so any XSS would expose it | E2E `pages get a fresh CSP nonce…`, `no Content-Security-Policy violations…` |
| T | CSRF on state-changing routes | Convex Auth checks Origin on `/api/auth`; `/api/playground/token` checks `Sec-Fetch-Site`/Origin; cookies `SameSite=Lax`, `__Host-` | none known | `http.test.ts` (`isSameOrigin`) |
| I | Secrets in client bundles | Server-only modules import `server-only`; only `NEXT_PUBLIC_*` reach the browser; no client source maps; server maps deleted from the image | none known | E2E bundle scan, build leak check (SECURITY_REPORT) |
| D | Abuse of `/api/v1/*` (anonymous relay for the site key) | Endpoint and parameter allowlist, validation, 1 KB query cap; per-visitor limit keyed on a trusted client IP only | when the client IP is unknown all visitors share one limit (fail closed) | `app/api/v1/[endpoint]/route.test.ts` |
| E | Reaching the dashboard without a session | `proxy.ts` redirect plus server check in the dashboard layout plus session check in every Convex function | none known | E2E `dashboard requires sign-in` |

### B2/B7 Clients → FastAPI

| STRIDE | Threat and attack path | Mitigation | Residual | Test |
|---|---|---|---|---|
| S | Guessing or brute-forcing keys | 190-bit keys; strict ASCII format check; per-IP failed-auth limiter and 30 s negative cache before Convex (`app/core/abuse.py`, `deps.py`) | limiter is per process | `tests/security/test_auth.py` |
| S | Spoofing a visitor IP to escape per-visitor limits | `X-Client-IP` honoured only with the site key; website forwards only a trusted header; IPv6 grouped by /64 | depends on correct `CLIENT_IP_HEADER` at the edge | `tests/security/test_rate_limits.py`, `http.test.ts` |
| T | HTTP parameter pollution, header tricks | Duplicate parameters and duplicate `Authorization` headers refused; header/query size caps (`RequestLimitsMiddleware`) | none known | `test_input_validation.py`, `test_auth.py` |
| R | Denying having made requests | Usage rows per key (endpoint, status, time); request id in header, body and logs | usage rows are per key, not per end user | `test_api.py` usage tests |
| I | Errors leaking internals | Stable error envelope; upstream text never returned; `request_id` only | none known | `test_information_leakage.py` |
| D | Parameter floods, slow upstreams, fan-out | Query and header limits; ArcGIS concurrency cap, per-attempt deadline, response size cap; geocode resolves only `limit` suggestions; readiness probe cached | fixed-window limits allow 2× bursts at window edges | `test_ssrf.py`, `test_input_validation.py` |
| E | Using a key on endpoints it was not granted | Endpoint scopes checked in Convex `authorize` | none known | Convex `gateway.test.ts`, E2E scope test |

### B3/B4 Convex

| STRIDE | Threat and attack path | Mitigation | Residual | Test |
|---|---|---|---|---|
| S | Calling `/gateway/*` without the secret | Constant-time compare, min 32 chars, rotation via `GATEWAY_SECRET_PREVIOUS` | static bearer: a leaked secret works until rotated; no replay protection beyond TLS | `gateway.test.ts` HTTP tests |
| S | Registering the system account's address to own the site key | System account found by `isSystem` flag; reserved domains refused at sign-up; deploy refuses if an impostor exists | none known | `accounts.test.ts` |
| T | Writing usage into another tenant | Owner taken from the key; endpoint/method/status/time validated | none known | `gateway.test.ts` recordUsage |
| I | IDOR on keys and usage | Every public function checks an active session and ownership | none known | `authorization.test.ts` |
| D | Table growth (tokens, keys, requests) | Caps per user/key; self-rescheduling retention job | `usageDaily` kept indefinitely (aggregates) | `authorization.test.ts` |
| E | Using a session after sign-out or password change | Session row checked on every call, not only the JWT | none known | `authorization.test.ts` sessions |

### B5 FastAPI → ArcGIS

| STRIDE | Threat and attack path | Mitigation | Residual | Test |
|---|---|---|---|---|
| S | SSRF to internal services | No user-controlled URLs; configured URLs validated (https, public, no credentials, no obscure IPv4); redirects never followed | DNS of configured hosts is not pinned (use egress rules) | `test_ssrf.py` |
| T | Malicious or broken ArcGIS responses | Pydantic validation, size cap, ArcGIS error bodies detected and translated | none known | `test_arcgis_client.py`, `test_ssrf.py` |
| I | Token leakage | Tokens in `X-Esri-Authorization` header, never in URLs or logs; log redaction for `AAP…` tokens | a credential with admin privileges is in use (see report) | `test_information_leakage.py` |
| D | Cost/availability of ArcGIS | Per-key, per-account and routing limits; concurrency cap | ArcGIS quotas are outside this system | `gateway.test.ts` |

### B8 Operators, supply chain and hosts

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S/E | Stolen operator credentials | Provider MFA (out of scope of the code); key-only SSH for an admin group; least-privilege ArcGIS credential | depends on account hygiene |
| T | Compromised dependency or image | Lockfiles, `npm audit`, `pip-audit`, Trivy, Semgrep, Bandit, gitleaks in CI; minimal runtime images without package managers | zero-days; GitHub Actions pinned by tag, not SHA |
| E | Container escape / lateral movement | Non-root, read-only root, all capabilities dropped, `no-new-privileges`, resource limits; ports on 127.0.0.1; SELinux enforcing | kernel vulnerabilities |
| I | Secrets in images, logs, git | Runtime secret injection; `.env*` ignored; gitleaks; redaction | secrets already shared outside the repository must be rotated |
