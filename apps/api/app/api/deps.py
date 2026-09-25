"""Request dependencies for the public API."""

from __future__ import annotations

import hmac
import ipaddress
import logging
import time
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.abuse import FailureLimiter, TerminalStatusCache, visitor_bucket
from app.core.config import Settings
from app.core.errors import ApiError, ErrorCode
from app.core.security import credential_kind, hash_credential
from app.services.gateway import ConvexGateway, ConvexGatewayError, Principal
from app.services.geo.factory import GeoServices

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="ApiKey",
    bearerFormat="geo_…",
    description="Send your API key in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`.",
)


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_geo_services(request: Request) -> GeoServices:
    services: GeoServices = request.app.state.geo
    return services


def client_address(request: Request, settings: Settings) -> str | None:
    """The address of whoever sent this request: the trusted edge header when
    CLIENT_IP_HEADER is configured, otherwise the connection's peer (after
    Uvicorn's --proxy-headers handling, which trusts only local proxies).
    None when it cannot be determined."""
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "").strip()
        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            return None
    return request.client.host if request.client else None


def _visitor_ip(request: Request, settings: Settings) -> str:
    """The end-user IP forwarded by the website's server in X-Client-IP (only
    trusted for the site key, whose secret only that server holds), grouped
    for rate limiting. Without it, the website's own address: all anonymous map
    traffic then shares one limit (fail closed)."""
    bucket = visitor_bucket(request.headers.get("x-client-ip", ""))
    return bucket or visitor_bucket(client_address(request, settings) or "") or "unknown"


def _endpoint(request: Request) -> str:
    """The endpoint a key must be allowed to call: the /v1 path without the
    prefix, e.g. "reverse-geocode" (the names used when a key is created)."""
    return request.url.path.removeprefix("/v1/").strip("/")


def _missing_key() -> ApiError:
    return ApiError(
        401,
        ErrorCode.INVALID_API_KEY,
        "Missing API key. Send it in the Authorization header: 'Authorization: Bearer YOUR_API_KEY'.",
    )


def _too_many_failures(retry_after: int) -> ApiError:
    return ApiError(
        429,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many failed authentication attempts. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


def _refusal(status: str, kind: str) -> ApiError:
    if status == "revoked":
        return ApiError(403, ErrorCode.API_KEY_REVOKED, "This API key has been revoked.")
    if status == "expired":
        message = (
            "The playground token has expired. Reload the playground."
            if kind == "playground"
            else "This API key has expired."
        )
        return ApiError(401, ErrorCode.INVALID_API_KEY, message, {"reason": "expired"})
    return ApiError(401, ErrorCode.INVALID_API_KEY, "The API key is missing or invalid.")


# Statuses that cannot turn back into "ok" for the same credential.
TERMINAL_STATUSES = ("invalid", "revoked", "expired")


async def require_api_key(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Principal:
    if len(request.headers.getlist("authorization")) > 1:
        raise ApiError(401, ErrorCode.INVALID_API_KEY, "Send exactly one Authorization header.")
    settings: Settings = request.app.state.settings
    limiter: FailureLimiter = request.app.state.failed_auth
    known_bad: TerminalStatusCache = request.app.state.known_bad_credentials
    # Without a known address the failure limit is skipped: a bucket shared by
    # every client would let one attacker lock out all of them.
    client = client_address(request, settings)
    if credentials is None or not credentials.credentials:
        raise _missing_key()
    blocked_for = limiter.blocked(client) if client else None
    if blocked_for is not None:
        raise _too_many_failures(blocked_for)
    token = credentials.credentials.strip()
    kind = credential_kind(token)
    if kind is None:
        if client:
            limiter.record_failure(client)
        raise ApiError(401, ErrorCode.INVALID_API_KEY, "The API key is missing or invalid.")

    gateway: ConvexGateway = request.app.state.gateway
    credential_hash = hash_credential(token, settings.api_key_pepper.get_secret_value())
    cached = known_bad.get(credential_hash)
    if cached is not None:
        if client:
            limiter.record_failure(client)
        raise _refusal(cached, kind)
    site_key_hash: str | None = request.app.state.site_key_hash
    is_site_key = (
        kind == "key" and site_key_hash is not None and hmac.compare_digest(credential_hash, site_key_hash)
    )

    try:
        result = await gateway.authorize(
            kind="playground" if kind == "playground" else "key",
            credential_hash=credential_hash,
            endpoint=_endpoint(request),
            default_limit=settings.rate_limit_per_minute,
            client_ip=_visitor_ip(request, settings) if is_site_key else None,
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
    if result.status == "endpoint_not_allowed":
        raise ApiError(
            403,
            ErrorCode.ENDPOINT_NOT_ALLOWED,
            "This API key is not allowed to call this endpoint. Create a key that includes it.",
            {"allowed_endpoints": result.allowed_endpoints or []},
        )
    if result.status in TERMINAL_STATUSES:
        known_bad.put(credential_hash, result.status)
        if client:
            limiter.record_failure(client)
    raise _refusal(result.status, kind)


ApiKeyPrincipal = Annotated[Principal, Depends(require_api_key)]
Geo = Annotated[GeoServices, Depends(get_geo_services)]
