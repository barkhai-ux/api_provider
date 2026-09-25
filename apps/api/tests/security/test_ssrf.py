"""Upstream destinations come only from configuration, and even configured
URLs cannot point the gateway at internal targets or follow redirects there."""

from __future__ import annotations

import gzip
import json

import httpx
import pytest

from app.core.config import Settings
from app.core.urls import check_upstream_url
from app.services.arcgis.client import (
    ArcGISFeatureServerClient,
    ArcGISResponseError,
    ArcGISTimeoutError,
    ArcGISUnavailableError,
)
from tests.test_security_and_config import PRODUCTION


@pytest.mark.parametrize(
    "url",
    [
        "http://arcgis.example.com/arcgis/rest/services/x/GeocodeServer",  # plain HTTP
        "file:///etc/passwd",
        "gopher://127.0.0.1:6379/_INFO",
        "ftp://arcgis.example.com/x",
        "https://user:secret@arcgis.example.com/x",
        "https://127.0.0.1/x",
        "https://localhost/x",
        "https://sub.localhost/x",
        "https://10.0.0.5/x",
        "https://192.168.1.1/x",
        "https://169.254.169.254/latest/meta-data/",
        "https://metadata.google.internal/computeMetadata/v1/",
        "https://[::1]/x",
        "https://[fe80::1%25eth0]/x",
        "https://[::ffff:127.0.0.1]/x",
        "https://2130706433/x",  # 127.0.0.1 as a decimal number
        "https://0x7f000001/x",  # hexadecimal
        "https://127.1/x",  # shortened dotted form
        "https://0177.0.0.1/x",  # octal
        "https://convex-backend.internal/x",
    ],
)
def test_production_refuses_internal_or_insecure_upstreams(url: str) -> None:
    assert check_upstream_url("ARCGIS_GEOCODE_SERVER", url, production=True) != []
    with pytest.raises(ValueError):
        Settings(_env_file=None, **{**PRODUCTION, "arcgis_geocode_server": url})  # type: ignore[call-arg, arg-type]


def test_production_accepts_public_https_upstreams() -> None:
    url = "https://arcgis.ubhub.mn/arcgis/rest/services/locator/MN_OrtsGarts_POI/GeocodeServer"
    assert check_upstream_url("ARCGIS_GEOCODE_SERVER", url, production=True) == []


def test_non_http_schemes_and_credentials_are_refused_everywhere() -> None:
    for url in ("file:///etc/passwd", "https://u:p@host.example/x", "https://2130706433/x"):
        assert check_upstream_url("X", url, production=False) != []


def _client(handler, **kwargs) -> tuple[httpx.AsyncClient, ArcGISFeatureServerClient]:  # type: ignore[no-untyped-def]
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return http, ArcGISFeatureServerClient(http, max_retries=0, **kwargs)


async def test_redirects_are_not_followed() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data/"})

    http, client = _client(handler)
    async with http:
        with pytest.raises(ArcGISResponseError):
            await client.get_json("https://arcgis.example.com/x", {})
    assert calls == ["https://arcgis.example.com/x?f=json"]


async def test_response_size_is_capped_including_compressed_bodies() -> None:
    bomb = gzip.compress(json.dumps({"pad": "x" * 2_000_000}).encode())

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Encoding": "gzip"}, content=bomb)

    http, client = _client(handler, max_response_bytes=100_000)
    async with http:
        with pytest.raises(ArcGISResponseError, match="too large"):
            await client.get_json("https://arcgis.example.com/x", {})


async def test_compressed_responses_still_decode() -> None:
    body = gzip.compress(json.dumps({"ok": True}).encode())

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Encoding": "gzip"}, content=body)

    http, client = _client(handler)
    async with http:
        assert await client.get_json("https://arcgis.example.com/x", {}) == {"ok": True}


async def test_slow_trickling_upstream_hits_the_attempt_deadline() -> None:
    import asyncio

    class Trickle(httpx.AsyncByteStream):
        async def __aiter__(self):  # type: ignore[no-untyped-def]
            for _ in range(100):
                await asyncio.sleep(0.05)
                yield b" "

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=Trickle())

    http, client = _client(handler, timeout_seconds=0.3)
    async with http:
        with pytest.raises(ArcGISTimeoutError):
            await client.get_json("https://arcgis.example.com/x", {})


async def test_upstream_concurrency_is_bounded() -> None:
    import asyncio

    release = asyncio.Event()

    async def handler(_: httpx.Request) -> httpx.Response:
        await release.wait()
        return httpx.Response(200, json={"ok": True})

    http, client = _client(handler, max_concurrency=2, queue_timeout_seconds=0.1, timeout_seconds=5)
    async with http:
        first = [asyncio.create_task(client.get_json("https://arcgis.example.com/x", {})) for _ in range(2)]
        await asyncio.sleep(0.05)
        with pytest.raises(ArcGISUnavailableError, match="concurrent"):
            await client.get_json("https://arcgis.example.com/x", {})
        release.set()
        assert [await task for task in first] == [{"ok": True}, {"ok": True}]
