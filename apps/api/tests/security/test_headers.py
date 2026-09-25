"""Security headers, CORS and exposed endpoints."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from app.core.config import Environment, Settings
from app.main import create_app
from tests.conftest import auth
from tests.test_security_and_config import PRODUCTION


async def test_security_headers_on_api_responses(client: httpx.AsyncClient) -> None:
    for path in ("/v1/geocode?q=a", "/health", "/does-not-exist"):
        response = await client.get(path, headers=auth())
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "default-src 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Request-ID"]
    assert (await client.get("/v1/geocode?q=a", headers=auth())).headers["Cache-Control"] == "no-store"


async def test_no_redirect_that_echoes_the_host_header(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/v1/geocode/", params={"q": "sukh"}, headers={**auth(), "Host": "evil.example"}
    )
    assert response.status_code == 404
    assert "location" not in response.headers


async def test_request_id_is_validated(client: httpx.AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "bad\r\nSet-Cookie: x=1"})
    assert "Set-Cookie" not in response.headers
    assert response.headers["X-Request-ID"] != "bad"


def _production_app(**overrides: object) -> FastAPI:
    settings = Settings(_env_file=None, **{**PRODUCTION, **overrides})  # type: ignore[call-arg, arg-type]
    return create_app(settings, http_client=httpx.AsyncClient())


async def _get(app: FastAPI, path: str, headers: dict[str, str] | None = None) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://api.test") as http:
        return await http.get(path, headers=headers or {})


async def test_production_sends_hsts_and_hides_interactive_docs() -> None:
    app = _production_app()
    health = await _get(app, "/health")
    assert health.headers["Strict-Transport-Security"].startswith("max-age=")
    assert (await _get(app, "/docs")).status_code == 404
    assert (await _get(app, "/redoc")).status_code == 404
    # The public contract stays available.
    assert (await _get(app, "/openapi.json")).status_code == 200


async def test_cors_allows_only_listed_origins_without_credentials() -> None:
    app = _production_app()
    allowed = await _get(app, "/health", {"Origin": "https://app.example.com"})
    assert allowed.headers["access-control-allow-origin"] == "https://app.example.com"
    assert "access-control-allow-credentials" not in allowed.headers
    evil = await _get(app, "/health", {"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers


@pytest.mark.parametrize("origins", ["*", "http://app.example.com"])
def test_production_refuses_open_or_insecure_cors(origins: str) -> None:
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings(_env_file=None, **{**PRODUCTION, "cors_origins": origins})  # type: ignore[call-arg, arg-type]


def test_development_keeps_docs() -> None:
    settings = Settings(_env_file=None, environment=Environment.DEVELOPMENT)  # type: ignore[call-arg]
    assert settings.docs_enabled
