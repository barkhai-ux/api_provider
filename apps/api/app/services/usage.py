"""Batched, asynchronous usage recording.

The metering middleware queues one record per authenticated /v1 request. A
background task sends them to Convex in batches, so recording adds no network
round trip to the request path. If Convex is briefly unreachable, records are
kept (up to a bound) and retried on the next flush.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque

from app.services.gateway import ConvexGateway, ConvexGatewayError, UsageRecord

logger = logging.getLogger(__name__)


class UsageRecorder:
    def __init__(
        self,
        gateway: ConvexGateway,
        *,
        flush_interval_seconds: float = 1.0,
        batch_size: int = 200,
        max_pending: int = 50_000,
    ) -> None:
        self._gateway = gateway
        self._interval = flush_interval_seconds
        self._batch_size = batch_size
        self._pending: deque[UsageRecord] = deque(maxlen=max_pending)
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    @property
    def pending(self) -> int:
        return len(self._pending)

    def record(self, record: UsageRecord) -> None:
        if len(self._pending) == self._pending.maxlen:
            logger.warning("usage_buffer_full_dropping_oldest")
        self._pending.append(record)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="usage-recorder")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        with contextlib.suppress(ConvexGatewayError):
            await self.flush()

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            try:
                await self.flush()
            except ConvexGatewayError as exc:
                logger.warning("usage_flush_failed", extra={"reason": str(exc), "pending": self.pending})
            except Exception:
                logger.exception("usage_flush_failed")

    async def flush(self) -> int:
        """Send everything pending. Returns the number of records written."""
        written = 0
        async with self._lock:
            while self._pending:
                batch = [self._pending.popleft() for _ in range(min(self._batch_size, len(self._pending)))]
                try:
                    await self._gateway.record_usage(batch)
                except ConvexGatewayError:
                    # Put the batch back at the front, in order, and retry later.
                    self._pending.extendleft(reversed(batch))
                    raise
                written += len(batch)
        return written
