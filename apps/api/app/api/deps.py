"""Request dependencies for the public API."""

from __future__ import annotations

import hmac
import ipaddress
import logging
import time
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings
from app.core.errors import ApiError, ErrorCode
from app.core.security import credential_kind, hash_credential
from app.services.gateway import ConvexGateway, ConvexGatewayError, Principal
from app.services.geo.factory import GeoServices

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="ApiKey",
    bearerFormat="geo_live_…",
    description="Send your API key in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`.",
)


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_geo_services(request: Request) -> GeoServices:
    services: GeoServices = request.app.state.geo
    return services


def _client_ip(request: Request) -> str:
    """The end-user IP forwarded by the website's server (only trusted for the
    site key, whose secret only that server holds)."""
    forwarded = request.headers.get("x-client-ip", "").strip()
    try:
        return str(ipaddress.ip_address(forwarded))
    except ValueError:
        return request.client.host if request.client else "unknown"


def _missing_key() -> ApiError:
    return ApiError(
        401,
        ErrorCode.INVALID_API_KEY,
        "Missing API key. Send it in the Authorization header: 'Authorization: Bearer YOUR_API_KEY'.",
    )


async def require_api_key(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Principal:
    if credentials is None or not credentials.credentials:
        raise _missing_key()
    token = credentials.credentials.strip()
    kind = credential_kind(token)
    if kind is None:
        raise ApiError(401, ErrorCode.INVALID_API_KEY, "The API key is missing or invalid.")

    settings: Settings = request.app.state.settings
    gateway: ConvexGateway = request.app.state.gateway
    credential_hash = hash_credential(token, settings.api_key_pepper.get_secret_value())
    site_key_hash: str | None = request.app.state.site_key_hash
    is_site_key = (
        kind == "key" and site_key_hash is not None and hmac.compare_digest(credential_hash, site_key_hash)
    )

    try:
        result = await gateway.authorize(
            kind="playground" if kind == "playground" else "key",
            credential_hash=credential_hash,
            default_limit=settings.rate_limit_per_minute,
            client_ip=_client_ip(request) if is_site_key else None,
            per_ip_limit=settings.site_key_per_ip_per_minute if is_site_key else None,
        )
    except ConvexGatewayError as exc:
        logger.error("authorization_backend_unavailable", extra={"reason": str(exc)})
        raise ApiError(
            503,
            ErrorCode.SERVICE_UNAVAILABLE,
            "Authentication is temporarily unavailable. Try again shortly.",
        ) from exc

    if result.rate_limit is not None:
        request.state.rate_limit = result.rate_limit
    if result.principal is not None:
        request.state.principal = result.principal

    if result.status == "ok" and result.principal is not None:
        return result.principal
    if result.status == "rate_limited":
        retry_after = "60"
        if result.rate_limit is not None:
            retry_after = str(max(1, result.rate_limit.reset - int(time.time())))
        raise ApiError(
            429,
            ErrorCode.RATE_LIMIT_EXCEEDED,
            "Too many requests.",
            {"limit": result.rate_limit.limit} if result.rate_limit else None,
            headers={"Retry-After": retry_after},
        )
    if result.status == "revoked":
        raise ApiError(403, ErrorCode.API_KEY_REVOKED, "This API key has been revoked.")
    if result.status == "expired":
        message = (
            "The playground token has expired. Reload the playground."
            if kind == "playground"
            else "This API key has expired."
        )
        raise ApiError(401, ErrorCode.INVALID_API_KEY, message, {"reason": "expired"})
    raise ApiError(401, ErrorCode.INVALID_API_KEY, "The API key is missing or invalid.")


ApiKeyPrincipal = Annotated[Principal, Depends(require_api_key)]
Geo = Annotated[GeoServices, Depends(get_geo_services)]
