"""Validation of upstream service URLs (ArcGIS, Convex).

Upstream URLs come only from configuration, never from requests. This check
still refuses configurations that would make the gateway talk to something it
should not: other schemes (file:, gopher:, ftp:), credentials embedded in the
URL, loopback/private/link-local/metadata addresses, obscure IPv4 spellings
that resolvers map to such addresses (``2130706433``, ``0x7f.1``, ``127.1``),
and plain HTTP in production (secrets and tokens travel in these requests).
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

_BLOCKED_HOSTNAMES = {"localhost", "metadata", "metadata.google.internal", "instance-data"}
_BLOCKED_SUFFIXES = (".localhost", ".internal", ".local")


def _literal_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host.strip("[]").split("%", 1)[0])
    except ValueError:
        return None


def _is_obscure_ipv4(host: str) -> bool:
    """True for spellings like "2130706433", "0x7f000001" or "127.1", which
    inet_aton (and therefore many resolvers) accept as IPv4 addresses."""
    if _literal_ip(host) is not None:
        return False
    try:
        socket.inet_aton(host)
    except OSError:
        return False
    return True


def _non_public(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return not address.is_global or address.is_multicast


def check_upstream_url(name: str, url: str, *, production: bool, allow_http: bool = False) -> list[str]:
    """Problems with an upstream URL; empty when it is acceptable."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        parts.port  # noqa: B018 - raises ValueError for an invalid port
    except ValueError:
        return [f"{name} is not a valid URL"]
    problems: list[str] = []
    if parts.scheme not in ("https", "http"):
        problems.append(f"{name} must use https")
    elif parts.scheme == "http" and production and not allow_http:
        problems.append(
            f"{name} must use https in production (or set ALLOW_HTTP_UPSTREAMS for a private network)"
        )
    if parts.username or parts.password:
        problems.append(f"{name} must not contain credentials; use the dedicated settings")
    if not host:
        problems.append(f"{name} has no host")
        return problems
    if _is_obscure_ipv4(host):
        problems.append(f"{name} uses an ambiguous numeric host; write the address in dotted form")
    if production and not allow_http:
        address = _literal_ip(host)
        if address is not None and _non_public(address):
            problems.append(f"{name} points to a private, loopback or link-local address")
        if host in _BLOCKED_HOSTNAMES or host.endswith(_BLOCKED_SUFFIXES):
            problems.append(f"{name} points to a local or metadata host name")
    return problems
