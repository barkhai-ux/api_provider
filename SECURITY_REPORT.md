# Security report

Review of the Geo Platform monorepo (`apps/web`, `apps/api`, `apps/convex`, `packages/*`, Dockerfiles, `docker-compose.yml`, `render.yaml`) on 2026-09-24. Method: manual code review of every trust boundary, targeted probes against a local instance with mocked upstreams, dependency/secret/container/static scanners, an OWASP ZAP baseline scan, and nmap/ffuf reconnaissance of the local stack (2026-09-24/25). No production system and no ArcGIS service was attacked.

Passing scanners shows what the scanners cover, not that the system is secure. The residual risks at the end are real and need decisions.

## Executive summary

- **1 high-severity code finding, fixed:** anyone could register the reserved system address before the first deploy and take ownership of the website's site key (H1).
- **2 high-severity operational findings, open:** production-grade credentials were exposed outside secret storage during setup (H2), and the ArcGIS credential used for routing has portal administrator privileges (H3). Both need action in the ArcGIS portal and the secret stores, not code.
- **14 medium findings, all fixed or mitigated.** They cover the open redirect after sign-in and the lack of a script CSP. They also cover spoofable visitor addresses, trust in gateway input, and missing pre-authentication throttling. The rest are denial-of-service vectors in parameter parsing and upstream fan-out, weak configuration guards, and base images with critical CVEs.
- **24 low findings plus informational notes:** most are fixed; the rest are documented as residual risks.
- **Regression tests added:**
  - API: 92 new tests (`apps/api/tests/security`, 213 in total).
  - Convex: 30 new tests (`convex-test`: IDOR, sessions, gateway, accounts).
  - Web: 9 new unit tests (64 in total).
  - E2E: 5 new security tests (32 in total).
- **All suites and scanners pass:**
  - npm audit, pip-audit and OSV-Scanner: 0 vulnerabilities.
  - Semgrep: 0 findings; Bandit: 0 at medium severity or above.
  - gitleaks: 0 leaks in history or in the commit set.
  - Trivy: 0 critical and 0 fixable high findings in the API and website images; the remaining highs are Debian packages with no published fix.

## Architecture reviewed

```text
Internet ─► (Render edge / nginx) ─► Next.js 16 ─► FastAPI /v1 ─► Convex HTTP actions (keys, limits, usage)
                                        │   site key      │  hash only
                                        │   server-side   └─► ArcGIS GeocodeServer / NAServer (server-side token)
                                        └─► Convex (Convex Auth sessions, dashboard data)
Developers' servers ─► FastAPI /v1 (Bearer API key)
```

Trust boundaries, assets and actors: [docs/security/threat-model.md](docs/security/threat-model.md).

## Attack surface

| Surface | Exposure | Entry points |
|---|---|---|
| Website | Public | Pages; `GET /api/v1/{geocode,reverse-geocode,route}` (anonymous, site key); `POST /api/auth`; `POST /api/playground/token`, `GET /api/playground/keys`, `GET /api/session` (session) |
| Public API | Public | `GET /v1/geocode`, `/v1/reverse-geocode`, `/v1/route` (Bearer key); `/health`, `/health/ready`, `/openapi.json`; `/docs`, `/redoc` (now off in production) |
| Convex | Public (Convex Cloud) | Public functions (session required), Convex Auth actions (`auth:signIn`, `auth:signOut`), `/gateway/*` HTTP actions (gateway secret) |
| ArcGIS | Outbound only | Configured locator, route service, token endpoint |
| Hosts and containers | Operators | Render dashboard, Convex dashboard/CLI, SSH (self-hosted) |

## Findings

Status: **Fixed** (code changed and covered by a test), **Mitigated** (risk reduced, residual documented), **Open** (needs action outside the code).

### High

| ID | Finding | Component | Status |
|---|---|---|---|
| H1 | System-account takeover: `platform:upsertSystemUser` looked up the system user by email (`platform@system.internal`), and sign-up accepted that address. An attacker registering it before the first `ensureSiteKey` became the owner of the site key: they could see all map usage, revoke the key (map outage) or regenerate it (a working key limited only per visitor). | Convex | **Fixed** |
| H2 | Credentials exposed outside secret storage: ArcGIS OAuth client IDs/secrets and API-key tokens were pasted into a chat during setup, and a screenshot showed the local `.env` (API key pepper, gateway secret, site key, ArcGIS client secret, part of an ArcGIS token). | Operations | **Open**: rotate all of them before production |
| H3 | Excessive privilege: the ArcGIS credential used for the route service holds many `portal:admin:*` privileges. Its leak (see H2) would expose the whole portal. | ArcGIS portal | **Open**: create a least-privilege OAuth app (routing privilege plus the two shared items only) |

H1 fix, in `apps/convex/convex/platform.ts` and `auth.ts`:
- The system user is now looked up by its `isSystem` flag (new `by_system` index).
- Deploy refuses to continue if a regular account uses the system address.
- Reserved domains (`.internal`, `.local`, `.localhost`, `.invalid`, `.test`, `.example`) can no longer register.
- The system account is created on every deploy and can never hold a session.

Tests: `apps/convex/tests/accounts.test.ts` ("system account"). The live dev deployment was checked: its system user is genuine.

### Medium

| ID | Finding | Status | Fix (where) | Regression test |
|---|---|---|---|---|
| M1 | Open redirect after sign-in: `?next=/%09/evil.example` passed `safeNextPath`; browsers drop the tab and navigate to `//evil.example`. | Fixed | URL-parser resolution, control characters and backslashes refused (`apps/web/lib/auth-errors.ts`) | `auth-errors.test.tsx`; E2E "sign-in redirect cannot leave the site" |
| M2 | CSP allowed `script-src 'unsafe-inline'`. Any HTML injection would run script and could read the Convex Auth access JWT from localStorage. | Fixed | Per-request nonce with `'strict-dynamic'`, runtime CSP in `proxy.ts`, dynamic rendering, `upgrade-insecure-requests` only over HTTPS (`lib/csp.ts`) | E2E nonce and "no CSP violations" tests |
| M3 | Visitor-IP spoofing: the website trusted the right-most `X-Forwarded-For`, which a direct client controls. Random values per request bypassed the per-visitor limit on the site key, giving unlimited anonymous use of the platform key. | Fixed | Only a configured trusted header (`CLIENT_IP_HEADER`) or proxy hop count (`TRUSTED_PROXY_HOPS`); otherwise no address is forwarded and all anonymous traffic shares one limit (`lib/http.ts`) | `http.test.ts`, route tests |
| M4 | Convex `recordUsage` trusted the caller's key/user pairing. A buggy gateway or a leaked gateway secret could write usage into any tenant. Future timestamps pinned `lastUsedAt`, and very large ones broke whole batches. | Fixed | Owner read from the key; endpoint/method/status/time/duration validated; ids normalized; batch ≤ 1000; malformed records dropped in the HTTP action (`gateway.ts`, `http.ts`) | `gateway.test.ts` "recordUsage" |
| M5 | Retention not enforced at volume: pruning deleted 1000 rows per 10 minutes, so above ~1.7 requests/s old rows outlived the retention window. Rate-limit buckets stored raw visitor IPs. | Fixed | Prune reschedules itself while batches are full; IPs stored as HMAC hashes (`maintenance.ts`, `gateway.ts`) | `gateway.test.ts` (hashed buckets) |
| M6 | No throttling before authentication: every well-formed random key caused a Convex call; revoked and expired keys did too on every request. | Fixed | Per-IP failed-authentication limit (60/min, 429) and a 30-second cache of terminal statuses; skipped when the client address is unknown so one client cannot lock out others (`app/core/abuse.py`, `deps.py`) | `tests/security/test_auth.py` |
| M7 | Quadratic query parsing: a 62 KB URL with 15k parameters blocked the event loop for 4.5 s. Any key holder could trigger it (one worker per container). | Fixed | `RequestLimitsMiddleware`: query ≤ 2048 bytes, ≤ 16 parameters, no duplicates, headers ≤ 64 / 16 KB, all before routing | `test_input_validation.py` |
| M8 | Authentication and ArcGIS shared one connection pool, with no cap on upstream concurrency and no overall deadline. A slow ArcGIS starved authentication: unrelated requests got 503, and a trickling body held requests for more than 30 s. | Fixed | Separate Convex pool; shared ArcGIS concurrency budget with queue timeout; per-attempt deadline covering the body; response size cap (`client.py`, `main.py`) | `test_ssrf.py` (deadline, concurrency, size) |
| M9 | Geocode fan-out: up to 2× `limit` billable `findAddressCandidates` calls per request, including results that were then discarded. | Fixed | Resolve at most `limit` suggestions (`locator.py`) | existing locator tests |
| M10 | `/health/ready` was public, uncached and fanned out to Convex plus every data source. | Fixed | Single run per 15 s shared by concurrent callers (`health.py`) | covered by API suite |
| M11 | Weak abuse controls on accounts: no per-visitor throttle, length-only password policy, email-case mismatch in password reset. | Mitigated | Per-visitor `POST /api/auth` limit when the address is known; common and derived password refusal; normalized emails; errors mapped to fixed codes (`proxy.ts`, `auth.ts`, `lib/commonPasswords.ts`, `lib/passwordReset.ts`). Residual: no email verification or CAPTCHA; per-account lockout can be triggered by others. | `accounts.test.ts` |
| M12 | Site key limited only per exact IP string: rotating addresses within an IPv6 /64 bypassed it, and it had no overall cap. | Fixed | IPv6 grouped by /64, IPv4-mapped normalized, zone ids dropped; overall cap on the site key (`abuse.py`, `gateway.ts`) | `test_rate_limits.py`, `gateway.test.ts` |
| M13 | The production configuration guard accepted plain-HTTP, private, metadata or credential-bearing upstream URLs, CORS `*`, an HTTP public URL, and the same value for pepper and gateway secret. | Fixed | `app/core/urls.py` and the settings validator (upstream checks run in every environment; production-only rules added) | `test_ssrf.py`, `test_headers.py`, `test_security_and_config.py` |
| M14 | Container images: the website base (bookworm) had 4 critical CVEs; bundled npm/pip carried fixable highs; the Convex deploy image ran as root; source maps were shipped in the image. | Fixed | Debian 13 bases; npm/npx/corepack, pip and uv removed from runtime images; non-root Convex deploy user with npm 11; source maps deleted; health checks | Trivy results below |

### Low

| ID | Finding | Status |
|---|---|---|
| L1 | `usage.recent` did not check ownership of `keyId`, so pagination metadata leaked activity of another tenant's key (the ID had to be known); page size uncapped | Fixed (`usage.ts`; `authorization.test.ts`) |
| L2 | Access tokens stayed valid for up to 1 h after sign-out, password change or reset (only the JWT was checked) | Fixed: session row checked on every call (`lib/session.ts`) |
| L3 | `isProduction()` failed open for values like `prod` (console email with reset codes in logs, demo seeding) | Fixed: only `development`/`test` are non-production |
| L4 | Mixed-case emails broke password reset | Fixed: normalized in forms and in the reset provider |
| L5 | Password policy was length-only | Fixed partly: common and derived passwords refused; breach-corpus check not implemented |
| L6 | Unbounded keys and playground tokens per user | Fixed: 200 keys total, 5 live tokens per key |
| L7 | Playground tokens survived `regenerate`/`revoke`; expired keys could get tokens | Fixed |
| L8 | Account enumeration through direct calls to the public Convex Auth actions (sign-up "exists", reset of unknown email, timing) | Open (library behaviour); email verification recommended |
| L9 | ArcGIS token provider: 5-minute tokens were never reused, failures had no backoff, and concurrent 498 responses caused repeated re-issues | Fixed (`auth.py`) |
| L10 | Log redaction gaps: `client_secret=`, `password=`, Basic auth, cookies, JSON token fields, `AAP…` tokens, URL credentials, lists | Fixed (`logging.py`; `test_information_leakage.py`) |
| L11 | Unbounded leading-wildcard LIKE terms from long search text | Fixed: 8 unique words |
| L12 | No header size/count limit in Uvicorn | Fixed (431) |
| L13 | Trailing-slash 307 redirect echoed the Host header | Fixed: `redirect_slashes=False` |
| L14 | Swagger UI/ReDoc public in production (external assets, pasted keys); no HSTS | Fixed: off in production by default; HSTS on API and website |
| L15 | Map proxy passed any content type and unbounded bodies, used 408 for timeouts, and named `SITE_API_KEY` in an error | Fixed |
| L16 | Playground token route parsed unbounded bodies | Fixed (1 KB) |
| L17 | CSP fixed at build time (runtime `CSP_EXTRA_CONNECT_SRC` ignored) | Fixed: built per request |
| L18 | Raw Convex Auth error text reached the browser | Fixed: stable codes only |
| L19 | Server source maps inside the web image | Fixed |
| L20 | Gateway secret had no minimum length; a `null` body produced 500 | Fixed |
| L21 | Route coordinate parser accepted non-ASCII digits and spaces | Fixed (`re.ASCII`) |
| L22 | Sign-in, sign-up, reset, settings and playground forms had no `method`: submitted before scripts loaded (or by a scanner), they sent email, password or a pasted key in the URL, and so into history and logs (found by ZAP) | Fixed: `method="post"` on every form (`login-form.test.tsx`) |
| L23 | `img-src https:` allowed images from any host; 404 pages for `.xml`/`.txt` paths had no CSP (ZAP) | Fixed: `img-src` limited to self, data, blob and the map style host; proxy matcher covers those paths |
| L24 | The API sent `server: uvicorn`, which nmap used to fingerprint the service | Fixed: `--no-server-header` (E2E header test) |

### Informational

- Fixed-window limits allow up to twice the limit across a window boundary.
- The in-memory limits (website auth throttle, API failed-authentication limit, known-bad cache) are per instance. Render runs one instance per service today.
- `/gateway/*` uses a static bearer secret over TLS, with no request signing or replay protection. Rotation is supported through `GATEWAY_SECRET_PREVIOUS`.
- `style-src 'unsafe-inline'` and `img-src https:` remain in the CSP (see [frontend-security.md](docs/security/frontend-security.md)).
- Bandit's LOW findings are `assert` statements used for type narrowing, `random` used for retry jitter, and a development-only placeholder constant. Semgrep's `sha1` hit is `usedforsecurity=False` for stable ids. All are false positives.
- gitleaks' earlier hits were documentation placeholders (`Bearer YOUR_API_KEY`, `${…}` variables, the documented development demo key). An allowlist now covers them in `.gitleaks.toml`, which allows only those patterns.

## Exploit reproduction (before the fixes)

How each was confirmed: M6 and M7 were measured with probes against the API in-process (mocked Convex and ArcGIS). M1 was shown with the URL parser and the Next.js router source; it was not run in a real browser. H1 and M3 follow from the code paths; they are now covered by regression tests.

- **H1 (system-account takeover).** On a fresh deployment where `ensureSiteKey` has not run:
  1. Register `platform@system.internal` through the website.
  2. Run the deploy.
  3. The site key now appears in the attacker's dashboard.
  - Now: registration answers "Enter a valid email address", and deploy stops with "A regular account uses the reserved address…".
- **M1 (open redirect).** Open `/login?next=%2F%09%2Fevil.example` and sign in. The value resolved to `https://evil.example/`, and the Next.js router performs a full navigation to external origins. Now it goes to `/dashboard` (verified end to end).
- **M3 (visitor-IP spoofing).** Run `for i in $(seq 200); do curl -s -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 10.0.$((i/250)).$((i%250))" 'http://localhost:3000/api/v1/geocode?q=sukh'; done`. Each request carried a different visitor address, so none reached the 60-per-minute limit. Now requests without a trusted header share one visitor limit and get 429 after 60.
- **M7 (parameter flood).** `GET /v1/geocode?q=ab&p0=1&…&p15000=1` with a valid key blocked the worker for about 4.5 s. Now it gets 400 immediately, before authentication.
- **M6 (no pre-auth throttle).** 50 random keys caused 50 Convex calls. Now the first failures are cached and the client gets 429 after 60 failures a minute.

## Evidence

### Tests (all passing)

| Suite | Count | Command |
|---|---|---|
| API (pytest, includes `tests/security`) | 213 | `cd apps/api && uv run pytest` |
| Convex (`convex-test`) | 30 | `npm test --workspace @geo-platform/convex` |
| Website (Vitest) | 64 | `npm test --workspace @geo-platform/web` |
| API client | 6 | `npm test --workspace @geo-platform/api-client` |
| End-to-end (Playwright, hardened containers) | 32 | `npx playwright test --config e2e/playwright.config.ts` |

Type checks (TypeScript, mypy) and linters (ESLint, Ruff) are clean.

### Scanners

| Tool | Before | After |
|---|---|---|
| `npm audit` | 0 | 0 |
| `pip-audit` (API runtime dependencies) | 0 | 0 |
| OSV-Scanner 2.6.0 (`package-lock.json`, `uv.lock`: 986 + 37 packages, dev included) | not run | 0 |
| Bandit | 8 LOW (false positives) | 0 at `-ll -ii` |
| Semgrep (python, typescript, react, nextjs, secrets, dockerfile) | 3 (1 real: Convex deploy image root) | 0 |
| gitleaks, history | 9 (placeholders) | 0 |
| gitleaks, files to be committed | 9 (placeholders) | 0 |
| Trivy config | 1 HIGH (Convex Dockerfile root) | 0 HIGH/CRITICAL |
| Trivy `geo-platform-web` | 4 CRITICAL, 60 HIGH (8 fixable) | 0 CRITICAL, 43 HIGH, 0 fixable |
| Trivy `geo-platform-api` | 46 HIGH (2 fixable) | 44 HIGH, 0 fixable |
| Trivy `geo-platform-convex-deploy` | 11 fixable (bundled npm) | 0 |
| Secrets in images (Trivy) | 0 | 0 |
| Production build leak search (secret values, ArcGIS hosts) | none found | E2E bundle scan passes |

Remaining Trivy highs are Debian 13 packages (util-linux, ncurses, systemd libraries, perl-base, acl) marked "affected" or "fix deferred" upstream. Rebuild images when fixes ship.

### OWASP ZAP baseline (local stack)

`zap-baseline.py` (spider plus passive rules) against `http://localhost:3000` and `http://localhost:8000`.

| Run | Website | API |
|---|---|---|
| First | 0 FAIL, 10 WARN | 0 FAIL, 1 WARN (cacheable `openapi.json`/health responses; intended) |
| After fixing L22/L23 | 0 FAIL, 9 WARN | not re-run (no API change) |

Triage of the remaining website warnings:

| ZAP rule | Assessment |
|---|---|
| 10055 CSP `style-src 'unsafe-inline'` | Known and documented (inline styles from React, MapLibre and toasts; cannot run script) |
| 10202 Absence of anti-CSRF tokens | Heuristic on the (now `method="post"`) forms. These forms never post to the server natively: state changes go through `fetch` to `/api/auth` (Origin check) or Convex (JWT, not cookies) |
| 10031 User-controllable attribute | Query values reflected into React-escaped attributes of the playground form; no script context |
| 10023 "Debug error messages" | The documented error catalogue text ("Internal server error") on the API reference page |
| 10019 Content-Type missing | 307 redirects of `/dashboard/*` when signed out |
| 10049, 10096, 10111 | Informational (dynamic pages are not cacheable, a timestamp in a bundle, a login form exists) |
| 90004 Cross-Origin-Embedder-Policy missing | Intentional: COEP `require-corp` would block the cross-origin map tiles and fonts |

Resolved between the runs: 10024 (credentials in URL, L22), 10038 (CSP missing on a 404 page, L23), 10055 wildcard directive (`img-src https:`, L23).

### Local aggressive testing (2026-09-25, `docker compose up`)

Run against the local stack (dev mode; ArcGIS pointed at the self-hosted server). Attacks that are rejected before authentication or before the upstream sent nothing to ArcGIS; a small set of injection strings and one route call reached it.

| Attack | Result |
|---|---|
| Malformed values (`q` 201 chars, `NaN`, `Infinity`, `1e309`, lat 95, `limit` 0/99, 3-coord origin) | 400/401 (validation or auth first) |
| Quadratic-parse flood (200 params) | 400 |
| Oversized header (20 KB), long query (5 KB), 100 KB token | 431 / 414 / 431 |
| Duplicate query parameter | 400 before auth |
| SSRF via `url=`/`target=` (metadata, loopback) | rejected (unknown parameter / 404 for `/proxy`) |
| Method tampering (POST/PUT/DELETE/PATCH on `/v1/geocode`) | 405 |
| Duplicate `Authorization`, key in query string, malformed key | 401, no Convex lookup |
| Pre-auth flood: 70 distinct well-formed unknown keys | 60 × 401, then 429 with `Retry-After`; 0 ArcGIS calls |
| Per-visitor rate limit via the site proxy: 65 valid searches | cut off at 60, then 429 |
| Injection in `q` (SQL `' OR '1'='1`, `DROP TABLE`, UNION; NoSQL `{$gt:''}`; XSS `<script>`, `<img onerror>`; log4shell `${jndi:...}`; path `../../etc/passwd`; Cyrillic + quote) | all 200 with clean JSON, no 500, no traceback/URL/SQL/pydantic text; response `content-type: application/json` (XSS inert) |
| Route request | 502 `UPSTREAM_ERROR` (the pre-existing ArcGIS routing-permission block), clean envelope with `request_id`, no upstream detail leaked |
| ffuf (`common.txt`) on `/`, `/api/`, API `/`, `/v1/` | only public pages and known API paths; `.git/…`, `cgi-bin/` are 308→404 artifacts |
| Sensitive files (`.git/config`, `.env`, `.env.local`, `.next/BUILD_ID`, `server.js`, `package.json`, `*.js.map`) | all 404; no source maps served |

No new vulnerability. The route 502 is the known ArcGIS portal-permission gap (H3-adjacent operational item), and it is handled without leaking upstream detail.

### Reconnaissance (nmap, ffuf)

- **nmap:**
  - From the LAN address, ports 3000, 3210, 3211, 6791, 8000, 8008 and 8009 are closed. The stack listens on 127.0.0.1 only.
  - Service detection on loopback identified the API as "Uvicorn" from its `server` header (L24, fixed).
  - Port 80 on the review machine is an unrelated Apache 2.4.58 listening on all interfaces; it is outside this project.
- **ffuf 2.3.0** (SecLists `common.txt`, 4,751 words) against `/`, `/api/`, `/_next/`, API `/` and `/v1/`:
  - Only the public pages and the known API paths answer.
  - `/dashboard` redirects to sign-in, and `/api/auth` answers GET with 405.
  - `.git/…`, `cgi-bin/` and similar paths return a 308 to a same-origin path, then 404.
  - The API serves `/docs` only because the local stack runs in development mode (off in production, covered by a test).
- **Follow-up probes:**
  - Trailing-slash and double-slash redirects (`//evil.example/`, `/\evil.example/`, `/%09/…`) all stay on the same origin.
  - `/_next/image` refuses remote, internal (`169.254.169.254`, `127.0.0.1`) and protocol-relative URLs: no remote image patterns are configured.

## Remediation still required (owners: operators)

1. **Rotate every exposed credential (H2).** That covers the ArcGIS OAuth client secret, ArcGIS API keys and tokens, `API_KEY_PEPPER`, `GATEWAY_SECRET` and `SITE_API_KEY`. Use fresh values from `node scripts/generate-secrets.mjs` for production, and a separate production Convex deployment.
2. **Least-privilege ArcGIS identity (H3).** Grant it only the routing privilege and the locator and route items.
3. **Before going to production:**
   - Enable a real email backend (Resend); `EMAIL_BACKEND=console` is refused in production.
   - Decide on email verification and a CAPTCHA (M11, L8).
4. **After deploying on Render:**
   - Confirm `cf-connecting-ip` reaches both services (per-visitor limits count separately from two networks).
   - Set `CORS_ORIGINS` to the website origin.
5. **Enable GitHub security features and CI:**
   - Turn on branch protection so CI and Security must pass.
   - Turn on GitHub secret scanning.
   - Consider pinning third-party actions by commit SHA.

## Remaining risks

- **Accounts:** no email verification or CAPTCHA. Anyone can register any address. Per-account lockout can be triggered by others. Direct calls to Convex Auth actions bypass the website's per-visitor throttle.
- **XSS impact:** the Convex Auth library keeps the access JWT in `localStorage`, so the nonce CSP is the main barrier against script injection.
- **DNS:** configured upstream host names are not pinned. A DNS hijack could redirect gateway traffic; restrict egress on self-hosted hosts.
- **Per-instance limits:** in-memory limits are per instance. Scaling out multiplies them; Convex-backed limits are shared.
- **Authorization cache (`AUTH_CACHE_TTL_SECONDS`, default 15s):** when enabled, a valid API key's limits and scopes are cached in the API and rate limiting is enforced locally, to skip the ~250ms Convex round-trip. Trade-offs: revocation, expiry and account-disable take effect within the TTL (not instantly), and rate limits become per API instance. Rate limiting stays exact per instance (every request is counted; only the key's static metadata is cached). The negative (known-bad) cache, pre-auth failed-attempt limiter, key hashing and playground-token handling are unchanged; playground tokens are never cached. Set `0` for instant revocation, or keep it small when running more than one instance. Convex remains the source of truth.
- **Not verified on the target platforms:**
  - The Render edge headers and limits.
  - The RHEL host configuration on a real host (nginx, Quadlet and systemd files are syntax- and policy-checked only).
  - The CI workflows, which have not yet run on GitHub.
- **Testing depth:** Burp Suite was not used. Dynamic testing was a ZAP baseline (passive) scan, nmap and ffuf reconnaissance, and the scripted probes and tests listed above; no authenticated active scan was run. A manual penetration test of a staging deployment is recommended ([docs/security/penetration-testing.md](docs/security/penetration-testing.md)).
