# Convex security

Code: `apps/convex/convex`. Tests: `apps/convex/tests` (`npm test --workspace @geo-platform/convex`, using `convex-test`).

## Function surface

| Kind | Functions | Protection |
|---|---|---|
| Public queries/mutations/actions | `apiKeys.*`, `usage.*`, `users.*`, `auth:*` (Convex Auth) | Active session required (`requireUserId`: JWT + existing, unexpired session + account not disabled + not the system account); every id argument checked for ownership |
| Internal functions | `gateway.*`, `platform.*`, `maintenance.*`, `admin.*`, helpers | Not callable from clients; run by HTTP actions, crons or the CLI with an admin/deploy key |
| HTTP actions | `/gateway/health`, `/gateway/authorize`, `/gateway/usage`, Convex Auth routes | Gateway routes require `Authorization: Bearer <GATEWAY_SECRET>` |

## Tenant isolation

- `apiKeys.rename/revoke/regenerate/createPlaygroundToken` load the key and require `key.userId === userId`.
- `usage.daily/endpoints` query through the user's index; `usage.recent` rejects another user's `keyId` outright and caps pages at 100 rows.
- `users.updateProfile` patches only `name`; no function changes `email` or `isSystem`.
- Sign-up cannot set platform fields: `profile()` builds the user document.
- Regression tests: `tests/authorization.test.ts` (user A against user B's keys and usage, sessions, sign-in requirement).

## Gateway HTTP actions

- Secret compared in constant time; secrets shorter than 32 characters are never accepted; `GATEWAY_SECRET_PREVIOUS` allows zero-downtime rotation.
- Bodies must be JSON objects ≤ 256 KB; malformed input gets 400, not 500.
- `authorize`: hash format checked; limits clamped; endpoint scope, revocation, expiry and the owner's `disabledAt` checked; layered limits (see [rate-limiting.md](rate-limiting.md)); visitor IPs stored only as HMAC hashes.
- `recordUsage`: at most 1000 records per call; each record is dropped unless its key exists and belongs to the named user, the endpoint is one of the three `/v1` paths, the method is GET/HEAD, the status is an integer 100–599 and the time is within the last 24 hours (and not in the future); the owner written is always the key's owner.
- Replay: the gateway authenticates with a static bearer over TLS; a captured request could be replayed only by someone who can already read the secret. Accepted; rotate on suspicion.

## System account

The website's site key belongs to a system account (`isSystem: true`, no password). It is found by the flag, never by email; the reserved domain cannot be registered; the deploy script refuses to continue if a regular account uses the system address; the system account can never hold a session.

## Data retention

- `apiRequests`: raw rows deleted after `USAGE_RETENTION_DAYS` (30); the prune job reschedules itself while there is more to delete.
- `rateLimitWindows`: deleted after 5 minutes; contain hashed IPs only.
- `playgroundTokens`: deleted when expired, when the key is revoked or regenerated; at most 5 per key.
- `usageDaily`: aggregate counts per key, endpoint and day, kept for the dashboard.
- Keys: at most 25 active and 200 total per account.

## Operator functions

`admin.ts` (internal): `findUser`, `revokeKey`, `disableUser` (revokes keys and tokens, ends sessions, locks the account), `enableUser`. See [incident-response.md](incident-response.md).

## Environment variables

Set with `npx convex env set` (or `apps/convex/scripts/deploy.sh`): `API_KEY_PEPPER`, `GATEWAY_SECRET` (+ optional `GATEWAY_SECRET_PREVIOUS`), `SITE_API_KEY`, `SITE_URL`, `ENVIRONMENT` (only `development`/`test` enable dev-only paths; anything else is production), `EMAIL_BACKEND`/`RESEND_API_KEY`/`EMAIL_FROM`, `RATE_LIMIT_PER_MINUTE`, `ACCOUNT_RATE_LIMIT_PER_MINUTE`, `ROUTE_RATE_LIMIT_PER_MINUTE`, `USAGE_RETENTION_DAYS`, and `JWT_PRIVATE_KEY`/`JWKS` (generated once by the deploy script). Deploy keys and admin keys grant full access: keep them out of the repository and CI logs, and use a production deploy key only in the release job.
