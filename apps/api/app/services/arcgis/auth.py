"""ArcGIS token providers.

Secured ArcGIS Server / Enterprise services need a token. Three sources:

- ``OAuthClientCredentialsProvider``: an OAuth app (``ARCGIS_CLIENT_ID`` /
  ``ARCGIS_CLIENT_SECRET``), tokens from the portal's ``oauth2/token``
  endpoint with the client_credentials grant.
- ``GenerateTokenProvider``: a service account (``ARCGIS_USERNAME`` /
  ``ARCGIS_PASSWORD``), tokens from the portal's ``generateToken`` endpoint.
- ``StaticTokenProvider``: a token you issue yourself (``ARCGIS_TOKEN``).

Generated tokens are cached until shortly before they expire and renewed
when a service rejects them (codes 498/499).

Credentials and tokens are never logged or put in URLs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

import httpx

from app.services.arcgis.client import ArcGISAuthError, ArcGISUnavailableError

logger = logging.getLogger(__name__)

# Renew this long before the token expires.
RENEW_MARGIN_SECONDS = 300


class TokenProvider(Protocol):
    async def token(self) -> str | None: ...

    async def invalidate(self) -> None:
        """Drop a token the service rejected, so the next call gets a fresh one."""
        ...

    @property
    def referer(self) -> str | None: ...


class StaticTokenProvider:
    def __init__(self, token: str | None, referer: str | None = None) -> None:
        self._token = token
        self._referer = referer

    async def token(self) -> str | None:
        return self._token

    async def invalidate(self) -> None:
        return None

    @property
    def referer(self) -> str | None:
        return self._referer


def token_url_for(service_url: str, endpoint: str = "generateToken") -> str:
    """Default token endpoint for a service on ArcGIS Enterprise, e.g.
    https://host/arcgis/rest/services/... -> https://host/arcgis/sharing/rest/generateToken"""
    root = service_url.split("/rest/services", 1)[0]
    return f"{root}/sharing/rest/{endpoint}"


class _CachedTokenProvider:
    """Caching and renewal shared by the generated-token providers."""

    def __init__(self, http: httpx.AsyncClient, *, referer: str | None, timeout_seconds: float) -> None:
        self._http = http
        self._referer = referer
        self._timeout = timeout_seconds
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    @property
    def referer(self) -> str | None:
        return self._referer

    async def token(self) -> str | None:
        if self._token and time.time() < self._expires_at - RENEW_MARGIN_SECONDS:
            return self._token
        async with self._lock:
            if self._token and time.time() < self._expires_at - RENEW_MARGIN_SECONDS:
                return self._token
            self._token, self._expires_at = await self._generate()
            logger.info("arcgis_token_issued", extra={"expires_in_s": round(self._expires_at - time.time())})
            return self._token

    async def invalidate(self) -> None:
        self._token = None
        self._expires_at = 0.0

    async def _generate(self) -> tuple[str, float]:
        raise NotImplementedError

    async def _post(self, url: str, form: dict[str, str]) -> dict[str, object]:
        headers = {"Referer": self._referer} if self._referer else {}
        try:
            response = await self._http.post(url, data=form, headers=headers, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise ArcGISUnavailableError(f"Could not reach the token service ({type(exc).__name__})") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise ArcGISAuthError("The token service returned a non-JSON response") from exc
        if not isinstance(payload, dict):
            raise ArcGISAuthError("The token service returned an unexpected response")
        return payload


def _refused(payload: dict[str, object]) -> ArcGISAuthError:
    error = payload.get("error")
    code = error.get("code") if isinstance(error, dict) else None
    return ArcGISAuthError(
        f"The token service refused the credentials (code {code})", code if isinstance(code, int) else None
    )


class OAuthClientCredentialsProvider(_CachedTokenProvider):
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        token_url: str,
        client_id: str,
        client_secret: str,
        referer: str | None,
        expiration_minutes: int,
        timeout_seconds: float,
    ) -> None:
        super().__init__(http, referer=referer, timeout_seconds=timeout_seconds)
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._expiration_minutes = expiration_minutes

    async def _generate(self) -> tuple[str, float]:
        payload = await self._post(
            self._token_url,
            {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "client_credentials",
                "expiration": str(self._expiration_minutes),
                "f": "json",
            },
        )
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise _refused(payload)
        expires_in = payload.get("expires_in")
        ttl = float(expires_in) if isinstance(expires_in, (int, float)) else self._expiration_minutes * 60
        return token, time.time() + ttl


class GenerateTokenProvider(_CachedTokenProvider):
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        token_url: str,
        username: str,
        password: str,
        referer: str | None,
        expiration_minutes: int,
        timeout_seconds: float,
    ) -> None:
        super().__init__(http, referer=referer, timeout_seconds=timeout_seconds)
        self._token_url = token_url
        self._username = username
        self._password = password
        self._expiration_minutes = expiration_minutes

    async def _generate(self) -> tuple[str, float]:
        form = {
            "username": self._username,
            "password": self._password,
            "expiration": str(self._expiration_minutes),
            "f": "json",
        }
        # The token is bound to either the Referer we send or our IP address.
        if self._referer:
            form.update({"client": "referer", "referer": self._referer})
        else:
            form["client"] = "requestip"
        payload = await self._post(self._token_url, form)
        token = payload.get("token")
        if not isinstance(token, str) or not token:
            raise _refused(payload)
        expires_ms = payload.get("expires")
        expires_at = (
            float(expires_ms) / 1000
            if isinstance(expires_ms, (int, float))
            else time.time() + self._expiration_minutes * 60
        )
        return token, expires_at
