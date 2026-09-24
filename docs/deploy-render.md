# Deploying to Render (free plan)

This guide deploys the platform with free services only:

| Part | Where | How |
|---|---|---|
| Website (`apps/web`) | Render web service `geoplatform-web` | Docker, built from `apps/web/Dockerfile` |
| Public API (`apps/api`) | Render web service `geoplatform-api` | Docker, built from `apps/api/Dockerfile` |
| Accounts, API keys, usage, rate limits (`apps/convex`) | Convex Cloud, production deployment | `apps/convex/scripts/deploy.sh` |

Render builds both images from this repository using the Blueprint in [`render.yaml`](../render.yaml), and redeploys on every push to `main` that touches the service's files.

## Free plan limits

- A free service stops after 15 minutes without traffic. The next request waits about a minute while it starts. When the website starts it wakes the API in the background (`apps/web/instrumentation.ts`), so the first map search usually does not wait twice.
- Render gives each workspace 750 free instance hours per month, shared by both services. Two services that never sleep would use about 1,440 hours, so services are suspended for the rest of the month once the hours run out. Low-traffic sites stay well under the limit because sleeping services use no hours.
- 512 MB of memory and 0.1 CPU per service, one instance each.
- Free services cannot receive private network traffic, so the website calls the API over its public HTTPS URL.

## Before you start

- The code is pushed to GitHub, and Render has access to the repository (Render Dashboard > Account settings > GitHub, or grant access while creating the Blueprint).
- The Convex CLI is logged in on your machine (`npx convex login`), and the project's development deployment is in `CONVEX_DEPLOYMENT` in the root `.env`.
- Your ArcGIS values from the root `.env` are at hand: `ARCGIS_GEOCODE_SERVER`, `ARCGIS_ROUTE_SERVICE`, `ARCGIS_CLIENT_ID`, `ARCGIS_CLIENT_SECRET`, `ARCGIS_TOKEN`, `ARCGIS_TOKEN_REFERER`. If any of these were ever shared in chat, email or a ticket, rotate them in ArcGIS first.

## 1. Generate production secrets

```bash
node scripts/generate-secrets.mjs > .env.production
```

This writes `API_KEY_PEPPER`, `GATEWAY_SECRET` and `SITE_API_KEY`. The file is gitignored; keep a copy in a password manager. Do not reuse the development values: API keys are hashed with `API_KEY_PEPPER`, and changing it later invalidates every key.

## 2. Deploy Convex to production

Choose the website URL first. With the Blueprint's service name it is `https://geoplatform-web.onrender.com`.

```bash
set -a; . ./.env; . ./.env.production; set +a
cd apps/convex
CONVEX_PROD=true \
SITE_URL=https://geoplatform-web.onrender.com \
EMAIL_BACKEND=console \
./scripts/deploy.sh
```

- `CONVEX_PROD=true` pushes to the project's production deployment and sets its environment variables there. The development deployment is not touched.
- `ENVIRONMENT` defaults to `production`, so no demo account is seeded.
- The script registers `SITE_API_KEY` and generates the session signing keys once.
- **Email.** Production refuses `EMAIL_BACKEND=console`, so with the command above sign-up and sign-in work but password-reset emails fail. To enable them, create a [Resend](https://resend.com) account and run the command with `EMAIL_BACKEND=resend RESEND_API_KEY=... EMAIL_FROM="Geo Platform <noreply@your-domain>"` instead.

Note the two production URLs from the Convex Dashboard (production deployment > Settings > URL & Deploy Key):

- **Cloud URL**, `https://<name>.convex.cloud`: used by the website.
- **HTTP Actions URL**, `https://<name>.convex.site`: used by the API.

## 3. Create the Render services

In the Render Dashboard choose **New > Blueprint**, select this repository and branch `main`. Render reads `render.yaml` and asks for every value marked `sync: false`:

**geoplatform-api**

| Variable | Value |
|---|---|
| `PUBLIC_API_URL` | `https://geoplatform-api.onrender.com` |
| `CONVEX_SITE_URL` | Convex HTTP Actions URL (`.convex.site`) |
| `API_KEY_PEPPER`, `GATEWAY_SECRET`, `SITE_API_KEY` | from `.env.production` |
| `ARCGIS_*` | from the root `.env` |

**geoplatform-web**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://geoplatform-api.onrender.com` |
| `NEXT_PUBLIC_CONVEX_URL` | Convex Cloud URL (`.convex.cloud`) |
| `CONVEX_URL` | Convex Cloud URL (same as above) |
| `API_INTERNAL_URL` | `https://geoplatform-api.onrender.com` |
| `SITE_API_KEY` | from `.env.production` (same as the API) |

Click **Apply**. The first build of the website takes several minutes.

`ARCGIS_TOKEN_REFERER` can stay `http://localhost:3000`. The API sends this Referer itself on server-to-server calls, so it only has to match what the ArcGIS tokens are bound to, not the website's real address.

### If Render changes a service URL

Service names are global. If one is taken, Render adds a suffix, for example `https://geoplatform-web-x1y2.onrender.com`. Then:

1. Update `PUBLIC_API_URL`, `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL` to the API's real URL (Render redeploys the services; `NEXT_PUBLIC_API_URL` needs the rebuild because it is inlined into the browser code).
2. If the website URL changed, update Convex: `cd apps/convex && npx convex env set --prod SITE_URL https://<real web URL>`.

## 4. Check the deployment

```bash
curl https://geoplatform-api.onrender.com/health
```

Then open the website:

1. Search on the map. This goes through the website's server with `SITE_API_KEY`, so it checks the web > API > Convex > ArcGIS chain.
2. Create an account, create an API key on the dashboard and call the API with it:

   ```bash
   curl "https://geoplatform-api.onrender.com/v1/geocode?q=Sukhbaatar" \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```

3. The request appears on the dashboard's Usage page within a few seconds.

If map searches fail with `SERVICE_UNAVAILABLE` or `UPSTREAM_ERROR`, check the API logs in Render. The most common causes are wrong Convex URLs or secrets that differ between Convex and the API, and ArcGIS servers that do not accept requests from Render's network (Render's `singapore` region; your ArcGIS server must be reachable from the internet).

## Visitor IP addresses

The public map limits requests per visitor (`SITE_KEY_PER_IP_PER_MINUTE`). The website reads the visitor's IP from the header named in `CLIENT_IP_HEADER`, which the Blueprint sets to `cf-connecting-ip`: Render runs behind Cloudflare, which sets that header and overwrites any value sent by the client. If the header is missing, the website falls back to the right-most `X-Forwarded-For` entry, which on Render may be a proxy address shared by all visitors. In that case all visitors share one limit, and the map may return `429` under load.

## Updating

Push to `main`. Render rebuilds only the services whose files changed (see `buildFilter` in `render.yaml`). When `apps/convex` changes, run step 2 again before or together with the push.
