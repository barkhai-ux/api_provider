# Authentication (developer accounts)

Developer accounts use [Convex Auth](https://labs.convex.dev/auth) (`@convex-dev/auth` 0.0.95) with the Password provider. Code: `apps/convex/convex/auth.ts`, `lib/passwordReset.ts`, `lib/session.ts`, `users.ts`, and `apps/web/proxy.ts` on the website side.

## Passwords

- Stored by Convex Auth as scrypt hashes in `authAccounts`; never logged or returned.
- Policy (NIST SP 800-63B style): 10 to 128 characters counted as Unicode characters, any characters allowed, no composition rules, and refused when common or trivially guessable: a built-in list of common long passwords, one repeated character or short chunk, keyboard or alphabet runs, the email address or its local part (`lib/commonPasswords.ts`). Checked on sign-up, reset and password change.
- Not implemented: a breached-password corpus check (for example Have I Been Pwned k-anonymity). Add it where outbound calls from Convex are acceptable.

## Sign-in, sign-up and enumeration

- Email addresses are trimmed and lowercased in the forms and in Convex, so every flow uses the account's canonical address.
- Reserved domains cannot register (`.internal`, `.local`, `.localhost`, `.invalid`, `.test`, `.example`), which protects the system account `platform@system.internal`.
- Sign-in failures for unknown emails and wrong passwords return the same code (`InvalidCredentials`) through the website; other Convex error text is mapped to a fixed set of codes before it reaches the browser (`proxy.ts`).
- Known trade-off: sign-up says when an email is already registered, and a direct call to the public `auth:signIn` Convex action can distinguish unknown accounts during password reset. Email verification would remove the first; see "Residual risks".

## Brute force and credential stuffing

| Layer | Limit | Where |
|---|---|---|
| Per account | 10 failed sign-ins or reset codes per hour (Convex Auth default) | library |
| Per visitor | 60 requests to `POST /api/auth` per 10 minutes, when the visitor IP is known (`CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS`) | `apps/web/proxy.ts` |
| Per IP at the edge | 10 requests per minute to `/api/auth` (self-hosted) | `deploy/nginx/geo-platform.conf` |

When the visitor IP is not known, the website does not apply its own limit: one shared bucket would let a single client lock out everyone. The per-account limit also lets an attacker keep one account locked by failing ten times an hour (library behaviour; accepted, documented).

## Password reset

- Codes: 8 digits from `crypto.getRandomValues`, valid 15 minutes, one live code per account (a new request replaces the previous code), 10 wrong codes per hour per email.
- The code is tied to the account's normalized email (custom `authorize` in `lib/passwordReset.ts`).
- Production refuses `EMAIL_BACKEND=console` (codes would be logged); use Resend. Never set `AUTH_LOG_LEVEL=DEBUG` in production: the library then logs codes.
- A successful reset ends every other session.

## Sessions

- Convex Auth issues a short-lived JWT (1 hour) and a refresh token (session: 30 days total, 30 days inactive, refresh-token rotation).
- The website stores them in cookies set by `convexAuthNextjsMiddleware`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, with the `__Host-` prefix outside localhost. The library also keeps the access JWT in `localStorage` for the Convex client; the nonce-based CSP is the defence against script injection that could read it.
- Every Convex function checks that the session behind the JWT still exists, belongs to the user, has not expired and that the account is not disabled (`lib/session.ts`). Sign-out, password change, reset and `admin:disableUser` therefore take effect immediately instead of when the JWT expires.
- The system account can never be used for a session.

## CSRF

State-changing requests are `POST /api/auth` (Convex Auth checks the Origin), `POST /api/playground/token` (requires `Sec-Fetch-Site: same-origin` or a matching Origin) and Convex mutations (authenticated with the JWT sent by the Convex client, not with cookies). Cookies are `SameSite=Lax`.

## Residual risks

- No email verification: anyone can register any address (spam sign-ups, "account exists" hints). Recommended: `verify:` with the Email provider plus a CAPTCHA (for example Cloudflare Turnstile) on sign-up and reset.
- Per-account lockout can be triggered by others (see above).
- Direct calls to the public Convex Auth actions bypass the website's per-visitor limit; only the per-account limits apply there.
