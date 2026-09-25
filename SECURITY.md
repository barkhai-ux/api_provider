# Security policy

## Reporting a vulnerability

Please report security issues privately to the maintainers (GitHub → Security → "Report a vulnerability" on this repository), not in public issues. Include what you found, how to reproduce it, and its impact. We aim to acknowledge reports within 3 working days and to fix confirmed high-severity issues within 14 days.

Test only against your own local instance (`docker compose up`). Do not test the production services, and never test the ArcGIS services behind the API: they are third-party infrastructure.

## Supported versions

Only the latest `main` is supported. The public API contract is `/v1`.

## How the platform is protected

| Area | Summary | Details |
|---|---|---|
| Threat model | STRIDE per trust boundary | [docs/security/threat-model.md](docs/security/threat-model.md) |
| Accounts | Convex Auth, length-based password policy with a common-password check, session checks on every call, per-account and per-visitor throttling | [authentication.md](docs/security/authentication.md) |
| API keys | 190-bit keys, HMAC-SHA256 with a pepper, shown once, endpoint scopes, expiry, instant revocation, header only | [api-key-security.md](docs/security/api-key-security.md) |
| Abuse | Layered rate limits (edge, IP, key, account, endpoint, visitor), request shape limits, upstream budget | [rate-limiting.md](docs/security/rate-limiting.md) |
| SSRF | No user-controlled destinations; validated upstream configuration; no redirects | [ssrf.md](docs/security/ssrf.md) |
| Website | Nonce-based CSP, strict proxy routes, no secrets in bundles, safe redirects | [frontend-security.md](docs/security/frontend-security.md) |
| Data backend | Tenant isolation in every Convex function, protected gateway actions, operator tools | [convex-security.md](docs/security/convex-security.md) |
| ArcGIS | Server-side credentials, bounded adapter, least privilege | [arcgis-security.md](docs/security/arcgis-security.md) |
| Containers | Non-root, read-only, no capabilities, minimal images | [docker-hardening.md](docs/security/docker-hardening.md) |
| Hosts | SELinux, firewalld, SSH, systemd, nginx/TLS for self-hosting | [linux-hardening.md](docs/security/linux-hardening.md) |
| Operations | Credential rotation, compromised accounts, investigations | [incident-response.md](docs/security/incident-response.md) |
| Testing | What to test and how | [penetration-testing.md](docs/security/penetration-testing.md) |

The latest review and its findings: [SECURITY_REPORT.md](SECURITY_REPORT.md).

## Automated checks

`.github/workflows/ci.yml` (type checks, linters, unit, security and Convex tests) and `.github/workflows/security.yml` (gitleaks, `npm audit`, `pip-audit`, Bandit, Semgrep, Trivy for images and configuration). Security jobs fail on high or critical findings; lower ones are reviewed in the weekly run.

## Secrets

Never commit secrets. `.env*` files (except `.env.example`) are ignored; gitleaks scans every change and the full history. A secret that was committed, pasted into a chat or ticket, or shown in a screenshot is considered leaked: rotate it ([incident-response.md](docs/security/incident-response.md)).
