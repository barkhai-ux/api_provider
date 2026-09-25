"""What the gateway sends to Convex for rate limiting, and which client
addresses it trusts."""

from __future__ import annotations

import httpx
import pytest

from app.core.abuse import visitor_bucket
from tests.conftest import DEMO_KEY, PLACES_URL, SITE_KEY, ArcGISMocker, ConvexFake, auth
from tests.test_api import PLACE_FIELDS, PLACES


async def test_every_request_names_its_endpoint(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert convex.authorize_calls[-1]["endpoint"] == "geocode"


async def test_visitor_ip_is_ignored_for_regular_keys(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    headers = {**auth(DEMO_KEY), "X-Client-IP": "203.0.113.9"}
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=headers)
    assert "clientIp" not in convex.authorize_calls[-1]


async def test_site_key_visitors_are_grouped_by_network(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    for ip in ("2001:db8:1:2::1", "2001:db8:1:2:ffff::9"):
        await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(SITE_KEY), "X-Client-IP": ip})
    buckets = [call["clientIp"] for call in convex.authorize_calls]
    assert buckets == ["2001:db8:1:2::/64", "2001:db8:1:2::/64"]


async def test_site_key_without_visitor_ip_shares_one_bucket(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(SITE_KEY))
    await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(SITE_KEY), "X-Client-IP": "junk"})
    first, second = (call["clientIp"] for call in convex.authorize_calls)
    assert first == second


@pytest.mark.parametrize(
    ("value", "bucket"),
    [
        ("203.0.113.9", "203.0.113.9"),
        ("::ffff:203.0.113.9", "203.0.113.9"),
        ("fe80::1%eth0", "fe80::/64"),
        ("2001:db8::abcd", "2001:db8::/64"),
        ("not-an-ip", None),
        ("", None),
    ],
)
def test_visitor_bucket(value: str, bucket: str | None) -> None:
    assert visitor_bucket(value) == bucket
