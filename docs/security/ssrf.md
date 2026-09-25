# SSRF protection

## Principle

No request parameter anywhere in the platform can choose where a server connects:

| Server-side caller | Destination | How it is fixed |
|---|---|---|
| Website `/api/v1/[endpoint]` | the API | `API_INTERNAL_URL` + one of three allowlisted endpoint names; parameters are validated and re-encoded; `redirect: "error"` |
| Website `/api/playground/*`, `/api/session` | Convex | `CONVEX_URL` from the environment |
| API gateway | Convex | `CONVEX_SITE_URL` + fixed `/gateway/*` paths |
| API gateway | ArcGIS | `ARCGIS_*` URLs from the environment + fixed REST operations (`suggest`, `findAddressCandidates`, `reverseGeocode`, `solve`, layer `query`) |
| Token providers | ArcGIS portal | `ARCGIS_TOKEN_URL` or derived from the configured service URL |

There is no proxy endpoint, no URL parameter, no user-supplied map style, and the playground only calls the three `/v1` operations with fixed methods and headers.

## Defence in depth for configured URLs

Even configuration is checked at start-up (`apps/api/app/core/urls.py`, used by the settings validator):

- Only `https` and `http`; `file:`, `gopher:`, `ftp:` and others are refused in every environment.
- No credentials inside URLs (`https://user:pass@host`).
- Numeric host spellings that resolvers treat as IPv4 (`2130706433`, `0x7f000001`, `127.1`, `0177.0.0.1`) are refused in every environment.
- In production: `https` only; IP literals must be public (loopback, private, link-local, unique-local, multicast, reserved and IPv4-mapped forms of those are refused, including `169.254.169.254`); `localhost`, `*.localhost`, `*.internal`, `*.local` and metadata host names are refused. `ALLOW_HTTP_UPSTREAMS=true` lifts the https/private-address rule for services on a private network you control (for example self-hosted Convex); it never lifts the scheme, credential or numeric-host checks.

## At request time

- Redirects are never followed (`httpx` client with `follow_redirects=False`, and again per request).
- Each upstream attempt has one deadline covering connect, headers and a slowly trickling body (`asyncio.timeout`), a response size cap (`ARCGIS_MAX_RESPONSE_BYTES`, default 32 MB, checked on decoded bytes so compressed bombs are caught), and a slot in a shared concurrency budget (`ARCGIS_MAX_CONCURRENCY`, 503 after `ARCGIS_QUEUE_TIMEOUT_SECONDS`).
- ArcGIS error bodies, upstream URLs and `httpx` exception text are never returned to clients.

Tests: `apps/api/tests/security/test_ssrf.py`.

## Residual risk: DNS

Host names are resolved by the operating system at connection time and are not pinned. If the DNS of a configured ArcGIS or Convex host were hijacked to an internal address, the gateway would connect there (without following redirects and only to the fixed paths). Mitigate at the network layer: restrict the API container's egress to the ArcGIS and Convex hosts on 443 (firewalld/nftables on self-hosted hosts; Render does not offer egress rules).
