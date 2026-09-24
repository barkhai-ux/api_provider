"""Client for the Convex gateway HTTP actions (convex/http.ts, /gateway/*).

Convex owns API keys, rate-limit counters and usage records. For every public
request the gateway sends the *hash* of the presented credential; the raw key
never leaves this process.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

CredentialKind = Literal["key", "playground"]
AuthorizationStatus = Literal["ok", "invalid", "expired", "revoked", "rate_limited"]


class ConvexGatewayError(Exception):
    """Convex could not be reached or answered with something unexpected."""


class RateLimitState(BaseModel):
    limit: int
    remaining: int
    reset: int  # Unix epoch seconds when the current window ends

    def headers(self) -> dict[str, str]:
        return {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(self.remaining),
            "X-RateLimit-Reset": str(self.reset),
        }


class Principal(BaseModel):
    key_id: str
    user_id: str
    is_site_key: bool = False
    via_playground: bool = False


class Authorization(BaseModel):
    status: AuthorizationStatus
    principal: Principal | None = None
    rate_limit: RateLimitState | None = None


@dataclass(frozen=True, slots=True)
class UsageRecord:
    key_id: str
    user_id: str
    endpoint: str
    method: str
    status_code: int
    response_time_ms: int
    timestamp_ms: int

    def to_json(self) -> dict[str, Any]:
        return {
            "keyId": self.key_id,
            "userId": self.user_id,
            "endpoint": self.endpoint,
            "method": self.method,
            "statusCode": self.status_code,
            "responseTimeMs": self.response_time_ms,
            "timestamp": self.timestamp_ms,
        }


class ConvexGateway:
    def __init__(self, http: httpx.AsyncClient, site_url: str, secret: str, timeout_seconds: float) -> None:
        self._http = http
        self._base = site_url.rstrip("/") + "/gateway"
        self._headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
        self._timeout = timeout_seconds

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._http.post(
                f"{self._base}/{path}", json=body, headers=self._headers, timeout=self._timeout
            )
        except httpx.HTTPError as exc:
            raise ConvexGatewayError(f"Convex request failed ({type(exc).__name__})") from exc
        if response.status_code != 200:
            raise ConvexGatewayError(f"Convex returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ConvexGatewayError("Convex returned a non-JSON response") from exc
        if not isinstance(payload, dict):
            raise ConvexGatewayError("Convex returned an unexpected JSON document")
        return payload

    async def authorize(
        self,
        *,
        kind: CredentialKind,
        credential_hash: str,
        default_limit: int,
        client_ip: str | None = None,
        per_ip_limit: int | None = None,
    ) -> Authorization:
        body: dict[str, Any] = {"kind": kind, "hash": credential_hash, "defaultLimit": default_limit}
        if client_ip is not None and per_ip_limit is not None:
            body["clientIp"] = client_ip
            body["perIpLimit"] = per_ip_limit
        payload = await self._post("authorize", body)
        try:
            return Authorization.model_validate(
                {
                    "status": payload.get("status"),
                    "principal": _principal(payload.get("principal")),
                    "rate_limit": payload.get("rateLimit"),
                }
            )
        except ValidationError as exc:
            raise ConvexGatewayError("Convex authorize response has an unexpected shape") from exc

    async def record_usage(self, records: list[UsageRecord]) -> None:
        await self._post("usage", {"entries": [record.to_json() for record in records]})

    async def ping(self) -> bool:
        try:
            response = await self._http.get(
                f"{self._base}/health", headers=self._headers, timeout=self._timeout
            )
        except httpx.HTTPError:
            return False
        return response.status_code == 200


def _principal(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    return {
        "key_id": raw.get("keyId"),
        "user_id": raw.get("userId"),
        "is_site_key": bool(raw.get("isSiteKey", False)),
        "via_playground": bool(raw.get("viaPlayground", False)),
    }
