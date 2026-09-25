# Container hardening

## Images

| Image | Base (runtime) | Runs as | Removed from runtime | Health check |
|---|---|---|---|---|
| `apps/api/Dockerfile` | `python:3.13-slim` (Debian 13) | `app` (uid 999) | pip, ensurepip, uv, build tools; code owned by root (read-only for the service) | `GET /health` |
| `apps/web/Dockerfile` | `node:22-trixie-slim` (Debian 13) | `node` (uid 1000) | npm, npx, corepack; server source maps; app files owned by root, only `.next/cache` writable | `GET /robots.txt` |
| `apps/convex/Dockerfile` (one-shot deploy job) | pinned `convex-backend` image | `deploy` (uid 10001) | bundled npm replaced by npm 11 | n/a |

- Multi-stage builds: dependencies are installed in build stages; runtime stages copy only the virtualenv or the Next.js standalone output.
- Secrets are never build arguments or `ENV` values. The only build arguments are the public `NEXT_PUBLIC_*` values.
- Both application images honour `PORT` at runtime (Render sets 10000).
- Scan: `trivy image --severity HIGH,CRITICAL <image>` (in CI: `.github/workflows/security.yml`). Current results are in `SECURITY_REPORT.md`; remaining findings are Debian packages without a published fix. Rebuild regularly to pick up fixes.

## Runtime settings (docker compose)

`docker-compose.yml` applies to `api` and `web` (`x-hardening`):

```yaml
read_only: true                       # root file system read-only
tmpfs: [/tmp, (web) /repo/apps/web/.next/cache]
cap_drop: [ALL]                       # no Linux capabilities
security_opt: ["no-new-privileges:true"]
pids_limit: 256
mem_limit: 768m
cpus: 1.0
ports: ["127.0.0.1:<port>:<port>"]   # reachable from this host only
```

The Convex deploy job also drops all capabilities and sets `no-new-privileges`. No service is privileged, uses host networking or mounts the Docker socket. The self-hosted Convex backend and dashboard are bound to 127.0.0.1.

Verify:

```bash
docker inspect geo-platform-api-1 --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}'
docker exec geo-platform-api-1 sh -c 'command -v pip uv gcc; touch /app/x'    # nothing found; read-only
docker exec geo-platform-web-1 sh -c 'command -v npm npx; touch /repo/x'      # nothing found; read-only
```

## Networks and ports

Only the website (3000) and the API (8000) are published, on 127.0.0.1. In production, a TLS reverse proxy is the only public listener (see [linux-hardening.md](linux-hardening.md)); never publish Convex (3210/3211), the Convex dashboard or debug ports.

## Secrets at runtime

| Platform | Mechanism |
|---|---|
| Render | Service environment variables (`sync: false` in `render.yaml`, entered in the dashboard) |
| Podman (RHEL) | `podman secret create` + `Secret=…,type=env` in the Quadlet units (`deploy/quadlet`) |
| systemd without containers | `LoadCredentialEncrypted=` (`deploy/systemd`) |
| Local Docker | root `.env` (gitignored, mode 600) |

## Rootless Podman on RHEL

`deploy/quadlet/*.container` run the same images rootless under an unprivileged user with `ReadOnly=true`, `DropCapability=ALL`, `NoNewPrivileges=true`, memory/CPU/PID limits, health checks and SELinux labels (`container_t`). They publish on 127.0.0.1:8008/8009 for nginx.
