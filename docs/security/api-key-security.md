# API key security

## Lifecycle

| Step | Behaviour | Code |
|---|---|---|
| Create | `geo_` + 32 characters from `crypto.getRandomValues` (base62, rejection sampling, about 190 bits). The developer chooses the endpoints (`geocode`, `reverse-geocode`, `route`, at least one) and an expiry (30/60/90 days, 1 year, a date up to 5 years ahead, or never). | `apps/convex/convex/apiKeys.ts`, `lib/keys.ts` |
| Store | Only `HMAC-SHA256(API_KEY_PEPPER, key)` and a display prefix (`geo_ab12`). The secret is returned once and never stored. | `apiKeys.ts` `create` |
| Use | Only `Authorization: Bearer <key>`. Query-string keys are ignored. The API checks the format locally, hashes the key and sends only the hash to Convex. | `apps/api/app/api/deps.py`, `app/core/security.py` |
| Regenerate | New secret for the same key; the old one stops working at once; playground tokens are deleted. Expired keys cannot be regenerated. | `apiKeys.ts` `regenerate` |
| Revoke | Immediate (checked on every request); playground tokens deleted; cannot be undone. | `apiKeys.ts` `revoke`, `admin.ts` `revokeKey` |

Keys created before the single key type (`geo_live_…`, `geo_test_…`) keep working.

## Verification at the gateway

1. Exactly one `Authorization` header, scheme `Bearer`; otherwise 401.
2. The token must fully match `^geo_(?:(?:live|test)_)?[A-Za-z0-9]{32}$` (ASCII only) or the playground-token format. Truncated, over-long, homoglyph, zero-width and oversized values are refused without a lookup.
3. A client that failed authentication `FAILED_AUTH_PER_IP_PER_MINUTE` times (default 60) in the current minute gets 429 before any lookup.
4. Hashes Convex already answered with a terminal status (unknown, revoked, expired) are answered from a 30-second in-process cache.
5. Convex `gateway:authorize` looks the hash up by index, then checks revocation, expiry, the owner account (disabled accounts count as revoked), the endpoint scope, and the rate limits.

Timing: the lookup is by hash, so no comparison involves the secret; the site key is compared with `hmac.compare_digest`.

## Where keys must never appear

| Place | Control |
|---|---|
| Logs | Redaction of `geo_…` keys (all formats), bearer/basic credentials, cookies, `token=`/`client_secret=`/`password=` pairs, JSON token fields, ArcGIS `AAP…` tokens and URL credentials (`app/core/logging.py`); only the key id is logged |
| Error messages | Fixed messages; no echo of the header |
| URLs | Not accepted in query strings; docs show only the header form |
| Browser | The playground uses 15-minute playground tokens (`geo_pt_…`) bound to one key; pasted keys stay in memory only; the site key never leaves the server (E2E bundle scan) |
| Analytics | None are used |
| Git | gitleaks in CI with a placeholder-only allowlist (`.gitleaks.toml`) |

## Playground tokens

Issued by `apiKeys:createPlaygroundToken` for the signed-in owner of a non-revoked, non-expired key; valid 15 minutes; at most 5 live tokens per key; deleted when the key is revoked or regenerated; count against the key's limits and appear in its usage.

## The pepper

`API_KEY_PEPPER` lives only in the API and Convex environments. Keys have about 190 bits of entropy, so hashes plus pepper still do not reveal keys; the pepper mainly prevents confirming guesses against a leaked table. Rotating it invalidates every key (all keys must be recreated), so rotate only after a compromise of both the database and the environment. See [incident-response.md](incident-response.md).
