"""Hostile parameter values are refused with 400 before any upstream call."""

from __future__ import annotations

import httpx
import pytest

from tests.conftest import ConvexFake, auth


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/v1/reverse-geocode", {"lat": "nan", "lon": "106.9"}),
        ("/v1/reverse-geocode", {"lat": "inf", "lon": "106.9"}),
        ("/v1/reverse-geocode", {"lat": "-Infinity", "lon": "106.9"}),
        ("/v1/reverse-geocode", {"lat": "1e309", "lon": "106.9"}),
        ("/v1/reverse-geocode", {"lat": "90.0001", "lon": "106.9"}),
        ("/v1/reverse-geocode", {"lat": "47.9", "lon": "-180.5"}),
        ("/v1/geocode", {"q": "a"}),
        ("/v1/geocode", {"q": "x" * 201}),
        ("/v1/geocode", {"q": "sukh", "limit": "0"}),
        ("/v1/geocode", {"q": "sukh", "limit": "21"}),
        ("/v1/geocode", {"q": "sukh", "limit": "99999999999999999999"}),
        ("/v1/route", {"origin": "NaN,47.9", "destination": "106.9,47.9"}),
        ("/v1/route", {"origin": "106.9,47.9,1", "destination": "106.9,47.9"}),
        ("/v1/route", {"origin": "١٠٦.٩,٤٧.٩", "destination": "106.9,47.9"}),  # Arabic-Indic digits
        ("/v1/route", {"origin": "106.9,47.9 ", "destination": "106.9,47.9"}),  # EM SPACE
        ("/v1/route", {"origin": "106.9,47.9", "destination": "106.9,47.9", "mode": "flying"}),
    ],
)
async def test_invalid_values(client: httpx.AsyncClient, path: str, params: dict[str, str]) -> None:
    response = await client.get(path, params=params, headers=auth())
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


async def test_duplicated_parameters_are_ambiguous_and_refused(
    client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    response = await client.get("/v1/geocode?q=sukh&q=zzzz", headers=auth())
    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"field": "q"}
    assert convex.authorize_calls == []


async def test_parameter_floods_are_refused_cheaply(client: httpx.AsyncClient, convex: ConvexFake) -> None:
    many = "&".join(f"p{i}=1" for i in range(200))
    response = await client.get(f"/v1/geocode?q=sukh&{many}", headers=auth())
    assert response.status_code in (400, 414)
    long_query = "q=" + "x" * 5000
    assert (await client.get(f"/v1/geocode?{long_query}", headers=auth())).status_code == 414
    assert convex.authorize_calls == []


async def test_oversized_headers_are_refused(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={**auth(), "X-Big": "x" * 20_000}
    )
    assert response.status_code == 431
    many = {f"X-H{i}": "1" for i in range(80)}
    assert (
        await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(), **many})
    ).status_code == 431


async def test_request_bodies_are_limited(client: httpx.AsyncClient) -> None:
    response = await client.request("GET", "/v1/geocode?q=sukh", headers=auth(), content=b"x" * 100_000)
    assert response.status_code == 413
