"""API key handling at the gateway: every malformed or manipulated credential
is refused locally (no Convex lookup), and repeated failures are throttled."""

from __future__ import annotations

import httpx
import pytest

from tests.conftest import DEMO_KEY, PLACES_URL, REVOKED_KEY, ArcGISMocker, ConvexFake, auth
from tests.test_api import PLACE_FIELDS, PLACES


@pytest.mark.parametrize(
    "header",
    [
        "Bearer " + DEMO_KEY[:-1],  # truncated
        "Bearer " + DEMO_KEY + "A",  # too long
        "Bearer " + DEMO_KEY.replace("A", "А"),  # Cyrillic homoglyph
        "Bearer " + DEMO_KEY[:10] + "​" + DEMO_KEY[10:],  # zero-width space
        "Bearer " + "geo_" + "A" * 100_000,  # huge
        "Basic " + DEMO_KEY,
        DEMO_KEY,
    ],
)
async def test_manipulated_keys_are_refused_without_a_lookup(
    client: httpx.AsyncClient, convex: ConvexFake, header: str
) -> None:
    # Sent as raw UTF-8 bytes, as a client could; httpx refuses non-ASCII str.
    response = await client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={"Authorization": header.encode()}
    )
    # 431: the header is too large to even parse (the 100 KB key).
    assert response.status_code in (401, 431)
    assert response.json()["error"]["code"] in ("INVALID_API_KEY", "INVALID_REQUEST")
    assert convex.authorize_calls == []


async def test_key_in_the_query_string_is_not_accepted(client: httpx.AsyncClient, convex: ConvexFake) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh", "api_key": DEMO_KEY})
    assert response.status_code == 401
    assert convex.authorize_calls == []


async def test_two_authorization_headers_are_refused(client: httpx.AsyncClient, convex: ConvexFake) -> None:
    headers = [("Authorization", f"Bearer {DEMO_KEY}"), ("Authorization", f"Bearer {REVOKED_KEY}")]
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=headers)
    assert response.status_code == 401
    assert "exactly one" in response.json()["error"]["message"]
    assert convex.authorize_calls == []


async def test_case_and_whitespace_of_the_scheme(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    response = await client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={"Authorization": f"bearer   {DEMO_KEY}"}
    )
    assert response.status_code == 200


async def test_a_known_bad_key_is_not_looked_up_again(client: httpx.AsyncClient, convex: ConvexFake) -> None:
    unknown = "geo_" + "Z" * 32
    for _ in range(3):
        assert (
            await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(unknown))
        ).status_code == 401
    assert len(convex.authorize_calls) == 1
    for _ in range(3):
        assert (
            await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(REVOKED_KEY))
        ).status_code == 403
    assert len(convex.authorize_calls) == 2


async def test_repeated_failures_from_one_client_are_throttled(
    client: httpx.AsyncClient, convex: ConvexFake, app
) -> None:
    app.state.failed_auth._limit = 5
    statuses = []
    for i in range(8):
        key = f"geo_{i:032d}".replace("0", "Q")[:36]
        response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(key))
        statuses.append(response.status_code)
    assert statuses[:5] == [401] * 5
    assert statuses[5:] == [429] * 3
    # Throttled requests never reach Convex.
    assert len(convex.authorize_calls) == 5
    blocked = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["Retry-After"]) <= 60


async def test_without_a_trusted_address_one_client_cannot_lock_out_everyone(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker, app
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    # CLIENT_IP_HEADER is configured but the edge did not send it.
    app.state.settings.client_ip_header = "cf-connecting-ip"
    app.state.failed_auth._limit = 2
    for i in range(5):
        bad = "geo_" + str(i) * 32
        assert (await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(bad))).status_code == 401
    assert (await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())).status_code == 200
    # With the header present, the failing client alone is throttled.
    attacker = {"cf-connecting-ip": "203.0.113.66"}
    for i in range(3):
        bad = "geo_" + "Y" * 31 + str(i)
        await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(bad), **attacker})
    blocked = await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(), **attacker})
    assert blocked.status_code == 429
    other = await client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={**auth(), "cf-connecting-ip": "198.51.100.1"}
    )
    assert other.status_code == 200
