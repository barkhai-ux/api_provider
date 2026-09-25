"""Pure ASGI middleware (no BaseHTTPMiddleware, so streaming and exceptions
behave predictably).

Order, outermost first (see ``create_app``):
CORS -> RequestContext -> RequestLimits -> SecurityHeaders -> BodySizeLimit -> ApiMetering
-> UnhandledError -> app
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any
from urllib.parse import parse_qsl

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


class RequestLimitsMiddleware:
    """Rejects oversized or ambiguous requests before any other work.

    - Headers: at most ``max_header_count`` headers and ``max_header_bytes`` in
      total (431). Uvicorn itself does not bound them.
    - Query string: at most ``max_query_bytes`` (414) and, under /v1,
      ``max_query_params`` parameters, each at most once (400). FastAPI's
      parameter parsing is quadratic in the number of parameters, and a
      repeated parameter is ambiguous (which value applies?).
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_query_bytes: int,
        max_query_params: int,
        max_header_bytes: int,
        max_header_count: int,
    ) -> None:
        self.app = app
        self.max_query_bytes = max_query_bytes
        self.max_query_params = max_query_params
        self.max_header_bytes = max_header_bytes
        self.max_header_count = max_header_count

    def _problem(self, scope: Scope) -> tuple[int, str, dict[str, Any] | None] | None:
        headers = scope["headers"]
        header_bytes = sum(len(name) + len(value) for name, value in headers)
        if len(headers) > self.max_header_count or header_bytes > self.max_header_bytes:
            return 431, "The request headers are too large.", None
        query: bytes = scope.get("query_string", b"")
        if len(query) > self.max_query_bytes:
            return 414, "The query string is too long.", None
        if scope["path"].startswith(PUBLIC_API_PREFIX) and query:
            try:
                pairs = parse_qsl(
                    query.decode("latin-1"), keep_blank_values=True, max_num_fields=self.max_query_params
                )
            except ValueError:
                return 400, f"Too many query parameters (at most {self.max_query_params}).", None
            seen: set[str] = set()
            for name, _ in pairs:
                if name in seen:
                    return 400, f"Parameter '{name[:40]}' must appear only once.", {"field": name[:40]}
                seen.add(name)
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        problem = self._problem(scope)
        if problem is None:
            await self.app(scope, receive, send)
            return
        status, message, details = problem
        response = error_response(status, ErrorCode.INVALID_REQUEST, message, details)
        await response(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool = False) -> None:
        self.app = app
        self.hsts = hsts

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
                if self.hsts:
                    headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
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
