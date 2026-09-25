# Penetration testing

## Rules of engagement

- **In scope:** your own local stack (`docker compose up`), or a staging deployment you are authorized to test.
- **Out of scope:**
  - production;
  - Convex Cloud's shared infrastructure beyond your own deployment's functions;
  - the ArcGIS services behind the API (a self-hosted GIS server, `arcgis.ubhub.mn`, likely shared with other applications; a flood could degrade it for them);
  - Render's and Cloudflare's platforms.
- **Protecting ArcGIS during tests:** it is not billed per request, but it is a shared production GIS server. Point `ARCGIS_*` at mocks or leave them unset (the API returns 503 for data endpoints while all authentication, validation and rate-limit paths still run), or keep request volumes tiny. Never load-test it.
- **Stop conditions:** stop and report if you reach data of another tenant, a secret, or a host shell.

## Local test environment

```bash
cp .env.example .env              # development values; ENVIRONMENT=development
docker compose up -d --build      # website :3000, API :8000 (both on 127.0.0.1)
```

For production-like behaviour (docs off, HSTS, strict CORS and upstream checks), run the API with `ENVIRONMENT=production` and strong secrets.

## Automated coverage (run in CI)

| What | Where |
|---|---|
| Auth parsing, throttling, known-bad cache | `apps/api/tests/security/test_auth.py` |
| Input validation, parameter pollution, size limits | `apps/api/tests/security/test_input_validation.py` |
| Headers, CORS, docs exposure, redirects | `apps/api/tests/security/test_headers.py` |
| SSRF, redirects, size and time limits | `apps/api/tests/security/test_ssrf.py` |
| Rate-limit inputs, visitor address trust | `apps/api/tests/security/test_rate_limits.py` |
| Error and log leakage | `apps/api/tests/security/test_information_leakage.py` |
| IDOR, sessions, gateway input, system account | `apps/convex/tests/*.test.ts` |
| Map proxy strictness, client IP trust, redirects | `apps/web/app/api/v1/[endpoint]/route.test.ts`, `apps/web/lib/http.test.ts`, `components/auth/*.test.tsx` |
| CSP nonce, CSP violations, bundle secrets, open redirect, proxy, API shape limits | `e2e/tests/security.spec.ts` |

## Manual test plan

### Reconnaissance

```bash
ss -tulpn | grep -E ':(3000|8000|3210|3211)'          # expect 127.0.0.1 bindings only
curl -sI http://localhost:3000/ | grep -iE 'content-security|strict-transport|x-frame|cross-origin'
curl -s http://localhost:8000/openapi.json | jq '.paths | keys'
nmap -sV -p- 127.0.0.1                                  # optional; compare with the expected ports
```

### Authentication

- Credential stuffing simulation: 30 sign-ins with wrong passwords for one account, then with many accounts from one address. Expect `TooManyFailedAttempts` after 10 per account; 429 from `/api/auth` when `CLIENT_IP_HEADER` is set.
- Reset-code guessing: request a code, try 11 wrong codes. Expect a lockout after 10.
- Session fixation and replay: sign in, copy the cookies, sign out, replay. Expect every dashboard call to fail. Change the password in one browser and check that the other is signed out.
- Open redirect: `/login?next=` with `//evil.example`, `/%09/evil.example`, `/\evil.example`, `https:evil.example`, `/%2F%2Fevil.example`.

### Authorization (two accounts, A and B)

With B's key ID (from B's dashboard network traffic), call `apiKeys:rename`, `revoke`, `regenerate`, `createPlaygroundToken` and `usage:recent` as A. You can do this through the Convex client in the browser console or `npx convex run --identity`. Expect "API key not found" every time.

### API keys

```bash
KEY=geo_...; API=http://localhost:8000
curl -s "$API/v1/geocode?q=ab" -H "Authorization: Bearer ${KEY%?}"               # truncated → 401
curl -s "$API/v1/geocode?q=ab" -H "Authorization: Bearer $KEY" -H "Authorization: Bearer x"   # duplicate → 401
curl -s "$API/v1/geocode?q=ab&api_key=$KEY"                                      # query key → 401
for i in $(seq 70); do curl -s -o /dev/null -w '%{http_code} ' "$API/v1/geocode?q=ab" -H "Authorization: Bearer geo_$(openssl rand -hex 16)"; done   # 401 × 60, then 429
```

Revoke a key and repeat a request (expect 403 `API_KEY_REVOKED`). Call `/v1/route` with a geocode-only key (expect 403 `ENDPOINT_NOT_ALLOWED`).

### Injection, SSRF and parameter tricks

- `q` with quotes, `%`, `_`, `--`, `/*`, Cyrillic and emoji. Expect results or empty results, never errors that echo the query.
- `lat=NaN`, `lat=1e309`, `lon=-180.0000001`, `origin=1,2,3`, duplicated parameters, 3,000-character queries, 100 parameters, 20 KB headers. Expect 400/414/431 in the standard envelope.
- Try to make any server fetch a URL of your choice (`url=`, `target=`, `callback=`, Host header tricks, trailing slashes). No such input exists; confirm that nothing is fetched (for example with a listener on your machine).

### Website

- ZAP baseline: `docker run --rm --network host ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://localhost:3000 -I`.
- XSS probes in names (sign-up name, key name) and in search text: `<img src=x onerror=alert(1)>`, `javascript:alert(1)`, `"><svg onload=alert(1)>`. Expect them rendered as text, and CSP reports if anything reflected.
- `ffuf -u http://localhost:3000/FUZZ -w <wordlist> -mc 200,301,302,500`: look for unexpected routes (there should be no debug, admin or source-map files).

### Resource exhaustion (local only)

Run concurrent routing requests (`hey -n 500 -c 50 ...`) with mocked or unset ArcGIS. Expect 429 from the route limit, and 503 when the upstream budget is exhausted; the rest of the API should stay responsive (check `/health` latency).

## What was run in the 2026-09-24 review

The review ran:

- the automated suites above;
- scripted probes against the API with mocked upstreams (parameter floods, header tricks, slow and oversized upstreams, redirects, token races);
- npm audit, pip-audit, OSV-Scanner, Bandit, Semgrep, gitleaks and Trivy (images and configuration);
- an OWASP ZAP baseline scan of the website and API;
- nmap (LAN and loopback) and ffuf (SecLists `common.txt`) against the local stack.

Burp Suite and authenticated active scanning were not run. Results: [SECURITY_REPORT.md](../../SECURITY_REPORT.md).
