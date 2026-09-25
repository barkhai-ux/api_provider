# Frontend security (Next.js website)

Code: `apps/web`. The website serves the map, docs, API reference/playground and the developer dashboard.

## Content-Security-Policy

Set per request in `proxy.ts` with a fresh nonce (`lib/csp.ts`); Next.js reads the policy from the request headers and adds the nonce to its own scripts, which is why every page renders dynamically (`await connection()` in `app/layout.tsx`).

```text
default-src 'self'
script-src 'self' 'nonce-<random>' 'strict-dynamic'        ('unsafe-eval' only in development)
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: https:
font-src 'self' data:
connect-src 'self' <API origin> <Convex origin> <Convex wss origin> <map style origin>
worker-src 'self' blob:;  child-src blob:;  frame-src 'none'
frame-ancestors 'none';  object-src 'none';  base-uri 'self';  form-action 'self'
upgrade-insecure-requests                                    (only when served over HTTPS)
```

- No `'unsafe-inline'` or `'unsafe-eval'` for scripts in production; an injected `<script>` or inline handler does not run.
- Styles keep `'unsafe-inline'`: React `style` attributes, MapLibre and toasts set inline styles that cannot carry a nonce. Style injection cannot execute script.
- `img-src https:` is broad because map sprites and remote images come from the style host; tighten to explicit origins if the basemap is fixed.
- E2E checks: every `<script>` tag carries the nonce, the nonce changes per request, and the main pages load with no CSP violations.

## Other headers

`next.config.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (geolocation self only), `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security` (two years) in production builds. `poweredByHeader: false`.

## XSS review

| Sink | Data | Handling |
|---|---|---|
| Map popups and markers | ArcGIS names/addresses | `textContent` / `setDOMContent`; marker HTML is a constant |
| Search results, route panel | ArcGIS fields | React text |
| Docs code blocks (Shiki) | Static samples plus `NEXT_PUBLIC_API_URL` | Highlighted on the server with a fixed grammar set; output cached |
| Dashboard | Key names, profile names, usage rows | React text |
| Toasts | Error text | React text; server error text is mapped to fixed messages |
| Links | Constants and configuration only | No user-controlled `href` |

No `dangerouslySetInnerHTML` with user or ArcGIS data. Markdown is not rendered from untrusted input.

## Server routes

| Route | Methods | Protection |
|---|---|---|
| `/api/v1/[endpoint]` | GET | Allowlist `geocode` (forward `q`, or reverse `lat`+`lon`) and `route`; per-endpoint parameter allowlist; one value per parameter; format and range checks (NaN/Infinity, lat ±90, lon ±180, `q` 2–200, `limit` 1–20, `mode`); query ≤ 1 KB; upstream request built from scratch (Accept, Authorization with the server-only site key, X-Client-IP from a trusted header only); redirects refused; 25 s timeout (504); only JSON passed back, ≤ 2 MB, allowlisted headers; `no-store` |
| `/api/playground/token` | POST | Same-origin check (`Sec-Fetch-Site`/Origin), session required, body ≤ 1 KB, Zod-validated, ownership checked in Convex; `private, no-store` |
| `/api/playground/keys`, `/api/session` | GET | Session required; minimal fields; `private, no-store` |
| `/api/auth` | POST | Convex Auth proxy (Origin check); per-visitor throttle; errors mapped to stable codes |

`proxy.ts` matches all pages and `/api/*` except `/api/v1/*` and static assets. Dashboard pages are also checked on the server in their layout, and every Convex function checks the session again, so a bypass of the redirect exposes nothing.

## Secrets and configuration

- Browser-visible: only `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_MAP_STYLE_URL` (public by design, inlined at build time).
- Server-only: `SITE_API_KEY`, `API_INTERNAL_URL`, `CONVEX_URL`, `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`, read through modules that import `server-only`.
- Production builds ship no browser source maps; server source maps are deleted from the image.
- Checked by the E2E bundle scan and by searching a production build for the secret values (see `SECURITY_REPORT.md`).

## Browser storage

The application stores nothing itself. Convex Auth keeps its access JWT, a placeholder refresh token and a PKCE verifier in `localStorage`; the real refresh token is an `HttpOnly` cookie. Playground tokens and pasted keys live in memory only.

## Redirects

`safeNextPath` (`lib/auth-errors.ts`) allows only same-origin paths after sign-in: control characters and backslashes are refused and the value is resolved with the URL parser before use, so `/\t/evil.example` (which browsers turn into `//evil.example`) falls back to `/dashboard`.
