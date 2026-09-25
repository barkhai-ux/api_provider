"""In-process protections that run before a credential reaches Convex.

Both structures are per process and bounded in size. They do not replace the
rate limits in Convex (which are shared by all instances); they keep floods of
bad credentials from turning into one Convex call each.
"""

from __future__ import annotations

import ipaddress
import time
from collections import OrderedDict


class FailureLimiter:
    """Counts failed authentications per client in fixed one-minute windows."""

    def __init__(self, limit_per_minute: int, *, max_clients: int = 50_000) -> None:
        self._limit = limit_per_minute
        self._max_clients = max_clients
        self._windows: OrderedDict[str, tuple[int, int]] = OrderedDict()

    @staticmethod
    def _window() -> int:
        return int(time.time() // 60)

    def blocked(self, client: str) -> int | None:
        """Seconds until the client may try again, or None when not blocked."""
        window, count = self._windows.get(client, (0, 0))
        if window == self._window() and count >= self._limit:
            return 60 - int(time.time() % 60)
        return None

    def record_failure(self, client: str) -> None:
        current = self._window()
        window, count = self._windows.pop(client, (current, 0))
        self._windows[client] = (current, count + 1 if window == current else 1)
        while len(self._windows) > self._max_clients:
            self._windows.popitem(last=False)


class TerminalStatusCache:
    """Remembers credential hashes whose status cannot change back to valid
    (unknown, revoked or expired) for a short time."""

    def __init__(self, ttl_seconds: float, *, max_entries: int = 50_000) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._entries: OrderedDict[str, tuple[float, str]] = OrderedDict()

    def get(self, credential_hash: str) -> str | None:
        entry = self._entries.get(credential_hash)
        if entry is None:
            return None
        expires, status = entry
        if expires < time.monotonic():
            del self._entries[credential_hash]
            return None
        return status

    def put(self, credential_hash: str, status: str) -> None:
        if self._ttl <= 0:
            return
        self._entries.pop(credential_hash, None)
        self._entries[credential_hash] = (time.monotonic() + self._ttl, status)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)


def visitor_bucket(value: str) -> str | None:
    """Normalizes a visitor IP for per-visitor limits: IPv4-mapped IPv6 becomes
    IPv4, zone ids are dropped, and IPv6 addresses are grouped by /64 (one
    subscriber usually controls a whole /64). None if not an IP address."""
    try:
        address = ipaddress.ip_address(value.strip().split("%", 1)[0])
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return f"{ipaddress.IPv6Network(f'{address}/64', strict=False).network_address}/64"
    return str(address)


class WindowRateLimiter:
    """Fixed one-minute windows, in process. Mirrors the Convex gateway's limiter
    so a cached key can be rate-limited locally (per instance) without a Convex
    round-trip. Returns (allowed, remaining, reset_epoch) for a bucket."""

    def __init__(self, *, max_buckets: int = 200_000) -> None:
        self._max_buckets = max_buckets
        self._counts: OrderedDict[tuple[str, int], int] = OrderedDict()

    def hit(self, bucket: str, limit: int, now: float) -> tuple[bool, int, int]:
        window = int(now // 60)
        key = (bucket, window)
        count = self._counts.pop(key, 0) + 1
        self._counts[key] = count
        while len(self._counts) > self._max_buckets:
            self._counts.popitem(last=False)
        reset = (window + 1) * 60
        return count <= limit, max(0, limit - count), reset
