# developers.ubhub.mn deployment

Push to `main`. GitHub Actions runs CI and Security; the server checks once a
minute and builds/deploys the exact main commit only after both succeed.
Failed checks leave the current release running. Builds happen before restarting
services. A deployment failure is recorded in the systemd journal and retried;
a failed runtime update needs operator attention (no automatic database rollback).

## Server layout

- Website: https://developers.ubhub.mn
- Public API: https://developers.ubhub.mn/v1/
- Convex browser HTTPS/WebSocket endpoint: https://developers.ubhub.mn/convex
- Private secrets: `/etc/api-provider/production.env` (root, mode 0600)
- Production Compose override: `/etc/api-provider/compose.yml`
- Immutable release directories: `/opt/api-provider/releases/<commit>`
- Last healthy commit: `/opt/api-provider/deployed-sha`
- Persistent database: Docker volume `developers_convex-data`
- Local ports: website 8008, API 8009, Convex 3210/3211

`api-provider-deploy.timer` polls GitHub's public API, so normal deployment needs
no GitHub token, inbound webhook, or SSH access from GitHub Actions. The dedicated
SSH deploy key is only for maintaining this repository from the server.
Only grant trusted maintainers write access to main: releases execute on the host.

## Administration

```sh
systemctl status api-provider-deploy.timer
journalctl -u api-provider-deploy.service -n 100
systemctl start api-provider-deploy.service
cat /opt/api-provider/deployed-sha
docker ps --filter name=developers-
```

To install/update the host configuration, as root from the repository:

```sh
install -m 755 deploy/production/deploy.py /usr/local/libexec/api-provider-deploy
install -m 644 deploy/production/compose.yml /etc/api-provider/compose.yml
install -m 644 deploy/production/api-provider-deploy.service /etc/systemd/system/
install -m 644 deploy/production/api-provider-deploy.timer /etc/systemd/system/
install -m 644 deploy/production/proxy.inc /etc/nginx/conf.d/developers-proxy.inc
install -m 644 deploy/production/nginx.conf /etc/nginx/conf.d/developers.conf
nginx -t && systemctl reload nginx
systemctl daemon-reload
systemctl enable --now api-provider-deploy.timer
```

The certificate is managed by Certbot's existing renewal timer; its deploy hook
reloads Nginx. The secrets and database must be backed up separately; never commit
them. Monitor disk space and remove obsolete release directories/build cache under
operator supervision. The server also hosts ubhub.mn, so avoid global Docker cleanup.

Configure real ArcGIS upstream URLs and any required credentials in the production
environment before relying on geocoding/routing. Password reset requires
`RESEND_API_KEY` and a verified `EMAIL_FROM`; no email-provider credential is stored
in Git. Production never seeds demo users.
