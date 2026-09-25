"""Error responses and logs never reveal internals or secrets."""

from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit

import httpx
import pytest

from app.core.logging import JsonFormatter, redact_text
from tests.conftest import ARCGIS_ROOT, DEMO_KEY, PLACES_URL, auth

ARCGIS_HOST = urlsplit(ARCGIS_ROOT).hostname or ""


async def test_upstream_failures_do_not_leak_urls_or_bodies(client: httpx.AsyncClient, mock_router) -> None:  # type: ignore[no-untyped-def]
    mock_router.get(url__startswith=PLACES_URL).mock(
        return_value=httpx.Response(500, text=f"Traceback ... {PLACES_URL} token=SECRET /var/lib/arcgis")
    )
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code in (502, 503)
    text = response.text
    for leak in (ARCGIS_HOST, "Traceback", "SECRET", "/var/lib", "httpx", DEMO_KEY):
        assert leak not in text
    body = response.json()["error"]
    assert body["request_id"] == response.headers["X-Request-ID"]


async def test_unknown_paths_and_methods_use_the_envelope(client: httpx.AsyncClient) -> None:
    for method, path in (
        ("GET", "/admin"),
        ("GET", "/v1/../../etc/passwd"),
        ("POST", "/v1/geocode"),
        ("GET", "/debug"),
    ):
        response = await client.request(method, path, headers=auth())
        assert response.status_code in (404, 405)
        assert set(response.json()) == {"error"}
        assert "server" not in {
            k.lower() for k in response.headers if response.headers[k].startswith("uvicorn")
        }


@pytest.mark.parametrize(
    "secret",
    [
        "geo_" + "k" * 32,
        "geo_live_" + "k" * 32,
        "geo_pt_" + "k" * 40,
        "AAPTavq9f9abcdefghijklmnopqrstuvwxyz0123456789",
        "Bearer abc.def.ghi",
        "Basic dXNlcjpwYXNzd29yZA==",
        "client_secret=0123456789abcdef",  # gitleaks:allow (fake value for the redaction test)
        "password=hunter2hunter2",
        '"access_token": "eyJhbGciOi"',
        "https://svc:p4ss@arcgis.example.com/rest",
        "Cookie: __Host-convexAuthJWT=eyJ.x.y",
    ],
)
def test_log_redaction(secret: str) -> None:
    redacted = redact_text(f"upstream said: {secret} (retry)")
    for fragment in (
        "kkkk",
        "abcdefghijkl",
        "abc.def.ghi",
        "dXNlcjpw",
        "0123456789abcdef",
        "hunter2",
        "eyJhbGciOi",
        "p4ss",
        "eyJ.x.y",
    ):
        assert fragment not in redacted


def test_structured_log_fields_are_redacted() -> None:
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "request", None, None)
    record.authorization = f"Bearer {DEMO_KEY}"
    record.headers = {"Cookie": "a=b", "X-Esri-Authorization": "Bearer AAPTxyz"}
    record.attempts = [f"key {DEMO_KEY}"]
    line = JsonFormatter().format(record)
    assert DEMO_KEY not in line
    assert "AAPTxyz" not in line
    payload = json.loads(line)
    assert payload["authorization"] == "[REDACTED]"
