# Linux host hardening (RHEL, Rocky, Alma)

This applies when you run the platform on your own server. On Render the host is managed by Render; only the container and application controls apply there.

The example files are in [`deploy/`](../../deploy):

| File | Installs to | Purpose |
|---|---|---|
| `deploy/nginx/geo-platform.conf`, `geo-platform-proxy.inc` | `/etc/nginx/conf.d/` | TLS, HTTP→HTTPS, unknown-host refusal, header overwriting, request limits |
| `deploy/quadlet/*.container`, `*.network` | `~geo/.config/containers/systemd/` | Rootless Podman containers managed by systemd (recommended) |
| `deploy/systemd/geo-api.service`, `geo-web.service` | `/etc/systemd/system/` | Alternative without containers, sandboxed by systemd |
| `deploy/linux/sshd-hardening.conf` | `/etc/ssh/sshd_config.d/10-geo-hardening.conf` | Key-only SSH for an admin group |
| `deploy/linux/sysctl-geo.conf` | `/etc/sysctl.d/90-geo-platform.conf` | Network and kernel hardening |
| `deploy/linux/audit-geo.rules` | `/etc/audit/rules.d/60-geo-platform.rules` | Audit trail for configuration, secrets and privilege use |
| `deploy/linux/firewalld.sh` | run once | HTTPS/HTTP open, SSH only from the admin network |

What was checked here: the nginx configuration passes `nginx -t` with nginx 1.20 (the RHEL 9 default) and 1.26; the Quadlet files generate the expected `podman run` commands (`quadlet -dryrun`, Podman 4.9); the systemd units score 1.1 ("OK") in `systemd-analyze security`; the SSH drop-in passes `sshd -t` on Rocky Linux 9. They were not run on a production RHEL host; test them on a staging host first.

## Target layout

```text
Internet ──► firewalld (80, 443; 22 from ADMIN_CIDR only)
          ──► nginx (TLS, limits, sets X-Forwarded-For / X-Real-IP)
                ├──► 127.0.0.1:8008  geo-web  (rootless Podman, read-only)
                └──► 127.0.0.1:8009  geo-api  (rootless Podman, read-only)
geo-web ──► geo-api over the private Podman network
geo-api ──► Convex Cloud, ArcGIS (HTTPS, outbound only)
```

Nothing else listens on a public interface. Check with:

```bash
ss -tulpn          # expect :22, :80, :443 public; 8008/8009 on 127.0.0.1 only
firewall-cmd --list-all
```

## SELinux

Keep SELinux enforcing. Do not fix permission problems by disabling it.

```bash
getenforce                     # Enforcing
sestatus
```

nginx runs as `httpd_t`. The containers are published on 127.0.0.1:8008 (website) and 127.0.0.1:8009 (API) because those ports already carry the `http_port_t` label, which nginx may connect to when `httpd_can_network_relay` is on. On Rocky Linux 9 the default ports 3000 and 8000 are labelled `ntop_port_t` and `soundd_port_t`, which would need the much broader `httpd_can_network_connect` (connect to any port). Verified with `sesearch` against the RHEL 9 targeted policy.

```bash
semanage port -l | grep http_port_t      # 80, 81, 443, 488, 8008, 8009, 8443, 9000
setsebool -P httpd_can_network_relay on
getsebool httpd_can_network_connect      # keep off
```

Rootless Podman containers run as `container_t` with a unique MCS label. Mount host directories only with `:Z` (private label) or not at all; the platform needs no host mounts.

Denials: `ausearch -m avc -ts recent`, and `sealert -a /var/log/audit/audit.log` for explanations.

## Users and permissions

- A dedicated unprivileged user runs the containers: `useradd --system --create-home geo` and `loginctl enable-linger geo` (so its user services start at boot). Nobody logs in as this user; administrators use `sudo -iu geo`.
- Settings in `~geo/.config/geo-platform/*.env` are mode `0600`. Secrets are Podman secrets (`podman secret create`), injected at runtime; they never appear in images or unit files.
- Administrators are members of `sshadmins` (SSH) and `wheel` (sudo). Require a password for sudo; do not use `NOPASSWD`.

## SSH

Install `deploy/linux/sshd-hardening.conf`, then `sshd -t` and `systemctl reload sshd` while keeping a second session open. It enforces key-only login, no root login, members of `sshadmins` only, three authentication attempts, and no forwarding. firewalld allows SSH only from `ADMIN_CIDR`.

## firewalld

`ADMIN_CIDR=203.0.113.0/24 deploy/linux/firewalld.sh` opens HTTPS and HTTP (HTTP only redirects), removes the default SSH and Cockpit services, and allows SSH from the admin network. Never open 8008, 8009, 3000, 8000, 3210/3211 (self-hosted Convex), 5432 or 6379.

## systemd

With Podman Quadlet (recommended), hardening is applied to the container: read-only root file system, all capabilities dropped, `no-new-privileges`, memory, CPU and process limits (see `deploy/quadlet`). Do not add `NoNewPrivileges=` or `ProtectSystem=` to the Quadlet service itself: rootless Podman needs the setuid `newuidmap` helper and write access to its storage.

Without containers, `deploy/systemd/*.service` use the full systemd sandbox (`ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices`, empty capability set, `RestrictAddressFamilies`, a system-call filter and resource limits). The web unit omits `MemoryDenyWriteExecute`, which breaks Node.js's JIT compiler. Secrets are systemd credentials:

```bash
systemd-creds encrypt --name=gateway_secret gateway.txt /etc/geo-platform/credentials/gateway_secret.cred
```

Check a unit's exposure with `systemd-analyze security geo-api.service`.

## Kernel and network settings

`deploy/linux/sysctl-geo.conf` disables ICMP redirects and source routing, enables reverse-path filtering and SYN cookies, and restricts kernel pointers, `dmesg`, `ptrace` and unprivileged BPF. Apply with `sysctl --system`.

## Logging, auditing and time

- `systemctl enable --now auditd`, then install `deploy/linux/audit-geo.rules` and run `augenrules --load`. Search with `ausearch -k geo_config`.
- journald keeps the application logs (JSON lines from the API). Make it persistent (`Storage=persistent` in `/etc/systemd/journald.conf`) and ship logs off the host if you can.
- `systemctl enable --now chronyd`. Correct time matters for TLS, API key expiry, playground token expiry and log correlation.

## Updates

- `dnf install dnf-automatic` and enable `dnf-automatic-install.timer` for security updates, or patch on a fixed schedule.
- Rebuild and redeploy the container images when their base images get security fixes (see [docker-hardening.md](docker-hardening.md)).
- Remove services you do not use: `systemctl list-unit-files --state=enabled`.

## TLS

- Certificates from an ACME client (for example `certbot` with the nginx plugin); renewal runs from a systemd timer. Check with `certbot renew --dry-run`.
- The nginx configuration allows TLS 1.2 and 1.3 only, redirects HTTP to HTTPS, and sends `Strict-Transport-Security` for two years.
- Test with `testssl.sh app.example.com` or an equivalent scanner after deployment.
