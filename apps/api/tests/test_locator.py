"""GeocodeServer (locator) providers, with inline ArcGIS-format responses."""

from __future__ import annotations

import httpx
import pytest
import respx

from app.core.config import Settings
from app.main import create_app
from tests.conftest import auth

LOCATOR = "https://gis.example.test/arcgis/rest/services/locator/POI/GeocodeServer"

SUGGESTIONS = {
    "suggestions": [
        {"text": "Sukhbaatar District, 7-р хороо, Сүхбаатар", "magicKey": "k1", "isCollection": True},
        {
            "text": "Sukh-Od Grocery Store, 37-р хороо, Баянзүрх, Баянзүрх",
            "magicKey": "k2",
            "isCollection": False,
        },
        {
            "text": "Сүхбаатар баптист сүм, 7-р баг, Жаргалан, Баруун-Урт",
            "magicKey": "k3",
            "isCollection": False,
        },
    ]
}
CANDIDATES = {
    "k1": {
        "x": 106.929681,
        "y": 47.92662,
        "PlaceName": "Sukhbaatar District, 7-р хороо, Сүхбаатар",
        "Nbrhd": "7-р хороо",
        "City": "Сүхбаатар",
    },
    "k2": {
        "x": 106.974899,
        "y": 47.909957,
        "PlaceName": "Sukh-Od Grocery Store, 37-р хороо, Баянзүрх",
        "Nbrhd": "37-р хороо",
        "City": "Баянзүрх",
    },
    "k3": {
        "x": 113.286745,
        "y": 46.680935,
        "PlaceName": "Сүхбаатар баптист сүм, 7-р баг, Жаргалан, Баруун-Урт",
        "Nbrhd": "7-р баг, Жаргалан",
        "City": "Баруун-Урт",
    },
}


def candidates(request: httpx.Request) -> httpx.Response:
    params = request.url.params
    assert params["outSR"] == "4326" and params["maxLocations"] == "1"
    c = CANDIDATES[params["magicKey"]]
    return httpx.Response(
        200,
        json={
            "spatialReference": {"wkid": 4326},
            "candidates": [
                {
                    "address": c["PlaceName"],
                    "location": {"x": c["x"], "y": c["y"]},
                    "score": 100,
                    "attributes": {
                        "PlaceName": c["PlaceName"],
                        "Addr_type": "POI",
                        "Type": "Other",
                        "Nbrhd": c["Nbrhd"],
                        "City": c["City"],
                        "Subregion": "",
                        "Region": "",
                    },
                }
            ],
        },
    )


@pytest.fixture
def locator_settings(settings: Settings) -> Settings:
    settings.arcgis_geocode_server = LOCATOR
    return settings


@pytest.fixture
async def locator_client(locator_settings: Settings, mock_router: respx.MockRouter):
    mock_router.get(f"{LOCATOR}/suggest").mock(return_value=httpx.Response(200, json=SUGGESTIONS))
    mock_router.get(f"{LOCATOR}/findAddressCandidates").mock(side_effect=candidates)
    app = create_app(locator_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        yield http


async def test_geocode_uses_suggest_then_resolves_coordinates(locator_client, mock_router) -> None:
    response = await locator_client.get("/v1/geocode", params={"q": "sukh", "limit": 3}, headers=auth())
    assert response.status_code == 200, response.text
    body = response.json()
    assert [r["name"] for r in body["results"]] == [
        "Sukhbaatar District",
        "Sukh-Od Grocery Store",
        "Сүхбаатар баптист сүм",
    ]
    first = body["results"][0]
    assert first["address"] == "7-р хороо, Сүхбаатар, Mongolia"
    assert first["type"] == "poi"
    assert (first["latitude"], first["longitude"]) == (47.92662, 106.929681)
    assert first["id"].startswith("loc_")
    suggest_call = next(c for c in mock_router.calls if c.request.url.path.endswith("/suggest"))
    assert suggest_call.request.url.params["text"] == "sukh"
    assert "magicKey" not in response.text and "GeocodeServer" not in response.text


async def test_geocode_respects_limit(locator_client) -> None:
    body = (await locator_client.get("/v1/geocode", params={"q": "sukh", "limit": 1}, headers=auth())).json()
    assert body["count"] == 1


async def test_reverse_geocode_uses_the_locator(locator_settings, mock_router) -> None:
    mock_router.get(f"{LOCATOR}/reverseGeocode").mock(
        return_value=httpx.Response(
            200,
            json={
                "address": {
                    "Match_addr": "Сүхбаатарын талбай, 6-р хороо, Сүхбаатар",
                    "LongLabel": "Сүхбаатарын талбай, 6-р хороо, Сүхбаатар, Сүхбаатар",
                    "PlaceName": "Сүхбаатарын талбай, 6-р хороо, Сүхбаатар",
                    "Addr_type": "POI",
                    "Neighborhood": "6-р хороо",
                    "City": "Сүхбаатар",
                    "CntryName": "USA",
                },
                "location": {"x": 106.9176125, "y": 47.9188375, "spatialReference": {"wkid": 4326}},
            },
        )
    )
    app = create_app(locator_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        response = await http.get(
            "/v1/geocode", params={"lat": 47.9184, "lon": 106.9177}, headers=auth()
        )
    result = response.json()["results"][0]
    assert result["address"] == "Сүхбаатарын талбай, 6-р хороо, Сүхбаатар, Mongolia"
    assert result["name"] == "Сүхбаатарын талбай"
    assert result["type"] == "place"
    assert 40 < result["distance_meters"] < 60


async def test_reverse_geocode_miss_widens_then_returns_empty(locator_settings, mock_router) -> None:
    route = mock_router.get(f"{LOCATOR}/reverseGeocode").mock(
        return_value=httpx.Response(
            200,
            json={
                "error": {
                    "code": 400,
                    "message": "Cannot perform query. Invalid query parameters.",
                    "details": ["Unable to find address for the specified location."],
                },
            },
        )
    )
    locator_settings.arcgis_reverse_geocoding_feature_server = None
    locator_settings.arcgis_geocoding_feature_server = None
    locator_settings.arcgis_routing_feature_server = None
    app = create_app(locator_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        response = await http.get("/v1/geocode", params={"lat": 44.0, "lon": 100.0}, headers=auth())
    assert response.status_code == 200
    assert response.json()["results"] == []
    assert [c.request.url.params["distance"] for c in route.calls] == ["100", "500", "2000"]


async def test_other_locator_errors_are_upstream_errors(locator_settings, mock_router) -> None:
    mock_router.get(f"{LOCATOR}/suggest").mock(
        return_value=httpx.Response(
            200,
            json={
                "error": {"code": 400, "message": "Invalid parameters", "details": ["'text' is required"]},
            },
        )
    )
    app = create_app(locator_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        response = await http.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "UPSTREAM_ERROR"


async def test_readiness_checks_the_locator(locator_settings, mock_router, arcgis) -> None:
    from tests.conftest import ROADS_URL

    mock_router.get(LOCATOR).mock(return_value=httpx.Response(200, json={"capabilities": "Suggest"}))
    arcgis(ROADS_URL, ["name"], [], geometry_type="esriGeometryPolyline")
    app = create_app(locator_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        ready = (await http.get("/health/ready")).json()
    assert ready["checks"]["geocoding_data"] == "ok"
    assert ready["checks"]["reverse_geocoding_data"] == "ok"
