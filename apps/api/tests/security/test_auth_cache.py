"""Only the website's site key may use the local authorization cache.

Customer keys always reach Convex so paid-plan quotas are enforced there.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from tests.conftest import (
    LIMITED_KEY,
    PLACES_URL,
    SITE_KEY,
    ArcGISMocker,
    ConvexFake,
    auth,
)
from tests.test_api import PLACE_FIELDS, PLACES


@pytest.fixture
def cached_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={
        "auth_cache_ttl_seconds": 60.0,
        "arcgis_client_id": None,
        "arcgis_client_secret": None,
        "arcgis_username": None,
        "arcgis_password": None,
        "arcgis_token": None,
        "arcgis_geocode_server": None,
    })


@pytest.fixture
def cached_app(cached_settings: Settings, mock_router):  # type: ignore[no-untyped-def]
    from fastapi import FastAPI

    app: FastAPI = create_app(cached_settings, http_client=httpx.AsyncClient())
    return app


@pytest.fixture
async def cached_client(cached_app):  # type: ignore[no-untyped-def]
    transport = httpx.ASGITransport(app=cached_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as http:
        yield http


async def test_customer_requests_reach_convex(
    cached_client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    for _ in range(5):
        assert (
            await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
        ).status_code == 200
    assert convex.describe_calls == []
    assert len(convex.authorize_calls) == 5


async def test_customer_rate_limit_is_enforced_in_convex(
    cached_client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    codes = [
        (await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(LIMITED_KEY))).status_code
        for _ in range(4)
    ]
    # LIMITED_KEY is 2/min; Convex counts every attempt.
    assert codes == [200, 200, 429, 429]
    assert len(convex.authorize_calls) == 4


async def test_revoked_key_is_honoured_and_cached(
    cached_client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    key = "geo_" + "N" * 32
    convex.add_key(key, status="revoked")
    for _ in range(3):
        assert (
            await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(key))
        ).status_code == 403
    # Revoked is terminal: Convex is called once, then known-bad cache applies.
    assert len(convex.authorize_calls) == 1
    assert convex.describe_calls == []


async def test_unpaid_key_is_paused_then_resumes_after_payment(
    cached_client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    key = "geo_" + "P" * 32
    convex.add_key(key, status="payment_required")
    response = await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(key))
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "PAYMENT_REQUIRED"
    convex.add_key(key)
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    assert (await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(key))).status_code == 200
    assert len(convex.authorize_calls) == 2


async def test_endpoint_scope_enforced_locally(cached_client: httpx.AsyncClient, convex: ConvexFake) -> None:
    key = "geo_" + "G" * 32
    convex.add_key(key, endpoints=["geocode"])
    response = await cached_client.get(
        "/v1/route", params={"origin": "106.9,47.9", "destination": "106.92,47.92"}, headers=auth(key)
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ENDPOINT_NOT_ALLOWED"


async def test_site_key_limited_per_visitor_locally(
    cached_client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    # site_key_per_ip_per_minute is 3 in the test settings.
    headers = {**auth(SITE_KEY), "X-Client-IP": "203.0.113.9"}
    codes = [
        (await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=headers)).status_code
        for _ in range(4)
    ]
    assert codes == [200, 200, 200, 429]
    other = await cached_client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={**auth(SITE_KEY), "X-Client-IP": "198.51.100.1"}
    )
    assert other.status_code == 200


async def test_backend_unavailable_on_cache_miss_is_503(
    cached_client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    convex.down = True
    response = await cached_client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 503
