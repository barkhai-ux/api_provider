"""FastAPI application factory for the public API gateway."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from app import __version__
from app.api import health, v1
from app.core.config import Settings, get_settings
from app.core.errors import ErrorCode, error_response, register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    ApiMeteringMiddleware,
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    UnhandledErrorMiddleware,
)
from app.core.security import hash_credential
from app.services.gateway import ConvexGateway
from app.services.geo.base import (
    GeoProviderError,
    GeoProviderTimeout,
    GeoProviderUnavailable,
    GeoServiceUnavailable,
    RouteNotFound,
    RouteRequestInvalid,
)
from app.services.geo.factory import GeoServices, build_geo_services
from app.services.usage import UsageRecorder

logger = logging.getLogger(__name__)

API_DESCRIPTION = """
Geocoding, reverse geocoding and routing for Mongolia.

**Authentication.** Every `/v1` request needs an API key in the `Authorization` header:
`Authorization: Bearer YOUR_API_KEY`. Create keys in the developer console.

**Errors.** Every error uses one envelope:
`{"error": {"code": "INVALID_REQUEST", "message": "...", "details": {...}}}`.

**Rate limits.** Each key has a per-minute limit (100 by default). Every response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

**Versioning.** `/v1` never receives breaking changes. New optional fields may be added to responses.
"""


def _geo_error_handlers(app: FastAPI) -> None:
    async def timeout(_: Request, exc: Exception) -> JSONResponse:
        logger.warning("geo_provider_timeout", extra={"reason": str(exc)})
        return error_response(408, ErrorCode.REQUEST_TIMEOUT, "The data service did not respond in time.")

    async def upstream(_: Request, exc: Exception) -> JSONResponse:
        logger.error("geo_provider_error", extra={"reason": str(exc), "error_type": type(exc).__name__})
        return error_response(502, ErrorCode.UPSTREAM_ERROR, "The upstream data service returned an error.")

    async def unreachable(_: Request, exc: Exception) -> JSONResponse:
        logger.error("geo_provider_unreachable", extra={"reason": str(exc)})
        return error_response(502, ErrorCode.UPSTREAM_ERROR, "The upstream data service is unreachable.")

    async def unavailable(_: Request, exc: Exception) -> JSONResponse:
        logger.error("geo_service_unavailable", extra={"reason": str(exc)})
        return error_response(
            503,
            ErrorCode.SERVICE_UNAVAILABLE,
            "This service is temporarily unavailable.",
            {"retryable": True},
        )

    async def route_not_found(_: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RouteNotFound)
        return error_response(404, ErrorCode.NOT_FOUND, str(exc), {"reason": exc.reason})

    async def route_invalid(_: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RouteRequestInvalid)
        return error_response(
            400, ErrorCode.INVALID_REQUEST, str(exc), {"field": exc.field} if exc.field else None
        )

    # Most specific first; Starlette resolves handlers along the MRO anyway.
    app.add_exception_handler(GeoProviderTimeout, timeout)
    app.add_exception_handler(GeoProviderUnavailable, unreachable)
    app.add_exception_handler(GeoServiceUnavailable, unavailable)
    app.add_exception_handler(GeoProviderError, upstream)
    app.add_exception_handler(RouteNotFound, route_not_found)
    app.add_exception_handler(RouteRequestInvalid, route_invalid)


def _custom_openapi(app: FastAPI, settings: Settings) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=settings.app_name,
            version=__version__,
            description=API_DESCRIPTION,
            routes=app.routes,
            servers=[{"url": settings.public_api_url, "description": "Public API"}],
            tags=[
                {"name": "Geocoding", "description": "Place names and addresses to coordinates."},
                {"name": "Reverse geocoding", "description": "Coordinates to addresses."},
                {"name": "Routing", "description": "Routes, distances and travel times."},
                {"name": "Health", "description": "Service health probes."},
            ],
        )
        # FastAPI documents 422 for validation errors; this API answers 400.
        for path in schema.get("paths", {}).values():
            for operation in path.values():
                operation.get("responses", {}).pop("422", None)
        for name in ("HTTPValidationError", "ValidationError"):
            schema.get("components", {}).get("schemas", {}).pop(name, None)
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]


def create_app(
    settings: Settings | None = None,
    *,
    http_client: httpx.AsyncClient | None = None,
    geo_services: GeoServices | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    http = http_client or httpx.AsyncClient(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        follow_redirects=False,
    )
    gateway = ConvexGateway(
        http,
        settings.convex_site_url,
        settings.gateway_secret.get_secret_value(),
        settings.convex_timeout_seconds,
    )
    recorder = UsageRecorder(gateway)
    geo = geo_services or build_geo_services(settings, http)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        recorder.start()
        warm_up = asyncio.create_task(geo.routing_provider.warm_up())
        logger.info("startup", extra={"environment": settings.environment.value, "version": __version__})
        try:
            yield
        finally:
            warm_up.cancel()
            await recorder.stop()
            if http_client is None:
                await http.aclose()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.state.settings = settings
    app.state.gateway = gateway
    app.state.recorder = recorder
    app.state.geo = geo
    app.state.site_key_hash = (
        hash_credential(settings.site_api_key.get_secret_value(), settings.api_key_pepper.get_secret_value())
        if settings.site_api_key
        else None
    )

    register_exception_handlers(app)
    _geo_error_handlers(app)
    app.include_router(v1.router)
    app.include_router(health.router)
    _custom_openapi(app, settings)

    # Added innermost first: the last one added is the outermost.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(ApiMeteringMiddleware, recorder=recorder)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=[
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
            "Retry-After",
            "X-Request-ID",
        ],
        allow_credentials=False,
        max_age=600,
    )
    return app
