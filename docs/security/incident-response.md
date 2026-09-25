# Incident response

Commands use the Convex CLI against the production deployment (`--prod`, from `apps/convex` with the operator logged in, or `CONVEX_DEPLOY_KEY` set). Replace `--prod` with nothing to act on the development deployment.

## First steps for any incident

1. Note the time, what was observed, and any `X-Request-ID` values.
2. Contain first (revoke, disable, rotate), then investigate.
3. Keep logs: Render → service → Logs (or `journalctl --user -u geo-api` on self-hosted hosts); Convex dashboard → Logs.
4. Afterwards, add a regression test and update this document.

## A developer's API key leaked

The developer revokes it in the dashboard (API keys → … → Revoke) and creates a new one. Revocation applies to the next request.

Operator, if the developer cannot:

```bash
npx convex run --prod admin:findUser '{"email":"dev@example.com"}'     # lists keys (prefix, last used)
npx convex run --prod admin:revokeKey '{"keyId":"<id>"}'
```

## A developer account is compromised

```bash
npx convex run --prod admin:disableUser '{"email":"dev@example.com"}'
```

This revokes all of the account's keys and playground tokens, ends all sessions and blocks the account from every dashboard function. Investigate (below). To restore: `admin:enableUser`, then the owner resets the password and creates new keys (old keys stay revoked).

## GATEWAY_SECRET leaked (or scheduled rotation)

Zero-downtime rotation; Convex accepts both values during steps 2–3.

```bash
NEW=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')
cd apps/convex
npx convex env set --prod GATEWAY_SECRET_PREVIOUS -- "<current value>"
npx convex env set --prod GATEWAY_SECRET -- "$NEW"
# Update GATEWAY_SECRET on the API service (Render → geoplatform-api → Environment) and redeploy.
npx convex env remove --prod GATEWAY_SECRET_PREVIOUS                 # once the API runs with the new value
```

If the secret leaked, remove `GATEWAY_SECRET_PREVIOUS` as soon as the API is updated, and review Convex logs for `/gateway/*` calls that did not come from the API.

## SITE_API_KEY leaked

1. `node scripts/generate-secrets.mjs` and take the new `SITE_API_KEY`.
2. `npx convex env set --prod SITE_API_KEY -- "<new>"` and `npx convex run --prod platform:ensureSiteKey` (registers the new key and revokes the old one immediately).
3. Update `SITE_API_KEY` on both Render services and redeploy them. The map is unavailable between step 2 and step 3, so do them together.

## API_KEY_PEPPER leaked

The pepper alone does not reveal keys (they have about 190 bits of entropy). If only the environment leaked, rotate the other secrets and monitor. If the Convex data leaked too, rotate the pepper: set a new value in Convex and on the API at the same time. Every existing key stops working; tell developers to create new keys, and re-register the site key (`platform:ensureSiteKey`).

## ArcGIS credentials

1. In the ArcGIS portal: invalidate the OAuth app secret (or change the service account password, or delete the API key).
2. Prefer a new least-privilege OAuth app (see [arcgis-security.md](arcgis-security.md#least-privilege-action-required)).
3. Update `ARCGIS_CLIENT_ID`/`ARCGIS_CLIENT_SECRET` (or `ARCGIS_TOKEN`) on the API service and redeploy. Cached tokens die with the old process.
4. Review the portal's logs for use of the old credential.

Values that were ever pasted into chats, tickets, screenshots or email are leaked: rotate them before going to production.

## Convex deploy key or admin key leaked

Revoke it in the Convex dashboard (Settings → Deploy keys), create a new one, update CI/operators, and review the deployment's function and data history for unexpected changes. Rotate `GATEWAY_SECRET` and `API_KEY_PEPPER` if environment variables may have been read.

## Investigating suspicious requests

- API logs are JSON lines: `request_id`, `method`, `endpoint`, `status`, `response_time_ms`, `api_key_id`. Filter by the request id a developer quotes, or by `api_key_id`.
- Signals: bursts of 401 (key guessing; the per-IP failure limit answers 429 after 60 failures a minute), 403 `ENDPOINT_NOT_ALLOWED` or `API_KEY_REVOKED` (stolen or old keys still in use), 429 on one key or account, 502/503 (ArcGIS trouble).
- Convex: `apiRequests` has endpoint, status, timing and key per request (30 days); `usageDaily` has daily totals. `admin:findUser` shows a user's keys and their last use.
- Query strings, bodies and credentials are never logged or stored, so what was searched cannot be reconstructed (by design).

## Restoring service

- Render: Service → Events → pick the last good deploy → Rollback.
- Convex: check out the last good commit and run `apps/convex/scripts/deploy.sh` (see [deploy-render.md](../deploy-render.md)); schema changes are additive, so rolling back functions is safe.
- Self-hosted: `podman auto-update --rollback` or restart the Quadlet unit with the previous image tag.
- Readiness: `curl https://<api>/health/ready` shows which dependency fails (accounts, geocoding, reverse geocoding, routing).

## Emergency security fixes

1. Fix on a branch with a regression test; CI runs type checks, linters, unit and security tests, dependency audits and scanners.
2. Merge to `main`: Render redeploys the changed services automatically.
3. If `apps/convex` changed, run the Convex deploy for production.
4. Verify with the regression test against production where safe, and watch logs.
5. Rotate any secret the vulnerability could have exposed.
