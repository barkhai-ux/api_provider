"""Pure ASGI middleware (no BaseHTTPMiddleware, so streaming and exceptions
behave predictably).

Order, outermost first (see ``create_app``):
CORS -> RequestContext -> SecurityHeaders -> BodySizeLimit -> ApiMetering -> UnhandledError -> app
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import ErrorCode, error_response
from app.core.logging import request_id_var
from app.services.gateway import Principal, RateLimitState, UsageRecord
from app.services.usage import UsageRecorder

logger = logging.getLogger("app.access")

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
PUBLIC_API_PREFIX = "/v1/"
DOCS_PATHS = ("/docs", "/redoc")


def _state(scope: Scope) -> dict[str, Any]:
    state: dict[str, Any] = scope.setdefault("state", {})
    return state


class RequestContextMiddleware:
    """Assigns a request id, times the request and writes one structured access
    log line. Query strings are never logged."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message).append("X-Request-ID", request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            principal = _state(scope).get("principal")
            logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "endpoint": scope["path"],
                    "status": status_code,
                    "response_time_ms": round((time.perf_counter() - started) * 1000, 1),
                    "api_key_id": principal.key_id if isinstance(principal, Principal) else None,
                },
            )
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_docs = scope["path"].startswith(DOCS_PATHS)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault("X-Frame-Options", "DENY")
                if not is_docs:
                    # JSON responses never need to load or embed anything.
                    headers.setdefault(
                        "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
                    )
                if scope["path"].startswith(PUBLIC_API_PREFIX):
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Rejects bodies above the limit, whether declared by Content-Length or streamed."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, receive, send)
            return
        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, send_wrapper)
        except _BodyTooLarge:
            if not response_started:
                await self._reject(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = error_response(413, ErrorCode.INVALID_REQUEST, "The request body is too large.")
        await response(scope, receive, send)


class ApiMeteringMiddleware:
    """For /v1 requests: adds X-RateLimit-* headers to every response (including
    errors) and queues a usage record once the response is sent."""

    def __init__(self, app: ASGIApp, recorder: UsageRecorder) -> None:
        self.app = app
        self.recorder = recorder

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(PUBLIC_API_PREFIX):
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status_code = 500
        state = _state(scope)

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                rate_limit = state.get("rate_limit")
                if isinstance(rate_limit, RateLimitState):
                    headers = MutableHeaders(scope=message)
                    for name, value in rate_limit.headers().items():
                        headers[name] = value
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            principal = state.get("principal")
            if isinstance(principal, Principal):
                self.recorder.record(
                    UsageRecord(
                        key_id=principal.key_id,
                        user_id=principal.user_id,
                        endpoint=scope["path"],
                        method=scope["method"],
                        status_code=status_code,
                        response_time_ms=round((time.perf_counter() - started) * 1000),
                        timestamp_ms=int(time.time() * 1000),
                    )
                )


class UnhandledErrorMiddleware:
    """Turns unexpected exceptions into the standard 500 envelope *inside* the
    middleware stack, so CORS, metering and access logging still apply."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except _BodyTooLarge:
            raise
        except Exception:
            logger.exception("unhandled_exception", extra={"endpoint": scope["path"]})
            if response_started:
                raise
            response = error_response(500, ErrorCode.INTERNAL_ERROR, "Internal server error.")
            await response(scope, receive, send)
