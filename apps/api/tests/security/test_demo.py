"""The discoverable demo is useful but cannot become an anonymous customer API."""

from __future__ import annotations

import httpx

from tests.conftest import PLACES_URL, ArcGISMocker, ConvexFake
from tests.test_api import PLACE_FIELDS, PLACES


async def test_demo_needs_no_secret_but_uses_its_own_distributed_limit(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker, app
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    app.state.settings.demo_requests_per_minute = 2
    first = await client.get("/demo/geocode", params={"q": "sukh", "limit": 2})
    second = await client.get(
        "/demo/geocode",
        params={"q": "sukh", "limit": 2},
        headers={"Origin": "https://forged.example", "User-Agent": "curl"},
    )
    refused = await client.get("/demo/geocode", params={"q": "sukh", "limit": 2})
    assert [first.status_code, second.status_code, refused.status_code] == [200, 200, 429]
    assert refused.headers["Retry-After"]
    assert all("hash" not in call for call in convex.demo_calls)
    assert all(call["endpoint"] == "geocode" for call in convex.demo_calls)


async def test_demo_has_stricter_result_and_query_limits(
    client: httpx.AsyncClient, convex: ConvexFake, app
) -> None:
    app.state.settings.demo_max_results = 5
    app.state.settings.demo_max_query_length = 8
    too_many = await client.get("/demo/geocode", params={"q": "sukh", "limit": 6})
    too_long = await client.get("/demo/geocode", params={"q": "x" * 9})
    assert too_many.status_code == 400
    assert too_long.status_code == 400
    # Authorization/rate limiting runs consistently before route work; the
    # upstream is never called for either invalid input.
    assert len(convex.demo_calls) == 2


async def test_demo_reverse_and_route_are_separate_namespaces(
    client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    reverse = await client.get("/demo/reverse", params={"lat": 91, "lon": 106.9})
    route = await client.get(
        "/demo/route",
        params={"origin": "181,47.9", "destination": "106.9,47.9"},
    )
    assert reverse.status_code == 400
    assert route.status_code == 400
    assert [call["cost"] for call in convex.demo_calls] == [1, 5]


async def test_customer_api_still_requires_a_key(client: httpx.AsyncClient) -> None:
    assert (await client.get("/v1/geocode", params={"q": "sukh"})).status_code == 401
