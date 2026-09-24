"""A small in-process TTL cache with LRU eviction.

Used for geocoding results only. It is per process by design: results are
cheap to recompute and short-lived, so a shared cache is not worth a network hop.
"""

from __future__ import annotations

import time
from collections import OrderedDict


class TTLCache[V]:
    def __init__(self, ttl_seconds: float, max_entries: int) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._data: OrderedDict[str, tuple[float, V]] = OrderedDict()

    @property
    def enabled(self) -> bool:
        return self._ttl > 0

    def get(self, key: str) -> V | None:
        if not self.enabled:
            return None
        item = self._data.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at < time.monotonic():
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: V) -> None:
        if not self.enabled:
            return
        self._data[key] = (time.monotonic() + self._ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)
