"""Network Analyst (NAServer) routing and ArcGIS token handling, with inline
ArcGIS-format responses."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app
from tests.conftest import auth

ROUTE = "https://gis.example.test/arcgis/rest/services/NA/NetworkAnalysis/NAServer/Route"
TOKEN_URL = "https://gis.example.test/arcgis/sharing/rest/generateToken"

DESCRIPTION = {
    "layerName": "Route",
    "layerType": "esriNAServerRouteLayer",
    "impedance": "TravelTime",
    "networkDataset": {
        "networkAttributes": [
            {"name": "TravelTime", "units": "esriNAUMinutes", "usageType": "esriNAUTCost"},
            {"name": "WalkTime", "units": "esriNAUMinutes", "usageType": "esriNAUTCost"},
            {"name": "Kilometers", "units": "esriNAUKilometers", "usageType": "esriNAUTCost"},
        ]
    },
    "supportedTravelModes": [
        {
            "name": "Driving Distance",
            "type": "AUTOMOBILE",
            "impedanceAttributeName": "Kilometers",
            "timeAttributeName": "TravelTime",
            "distanceAttributeName": "Kilometers",
            "id": "dd",
        },
        {
            "name": "Driving Time",
            "type": "AUTOMOBILE",
            "impedanceAttributeName": "TravelTime",
            "timeAttributeName": "TravelTime",
            "distanceAttributeName": "Kilometers",
            "id": "dt",
        },
        {
            "name": "Walking Time",
            "type": "WALK",
            "impedanceAttributeName": "WalkTime",
            "timeAttributeName": "WalkTime",
            "distanceAttributeName": "Kilometers",
            "id": "wt",
        },
    ],
}

SOLVED = {
    "routes": {
        "spatialReference": {"wkid": 4326},
        "features": [
            {
                "attributes": {
                    "Name": "origin - destination",
                    "Total_TravelTime": 10.5,
                    "Total_WalkTime": 50.4,
                    "Total_Kilometers": 4.2,
                },
                "geometry": {"paths": [[[106.9177, 47.9186, 0], [106.91, 47.92, 0], [106.9057, 47.922, 0]]]},
            }
        ],
    },
    "stops": {
        "features": [
            {"attributes": {"Name": "origin", "DistanceToNetworkInMeters": 22.3}},
            {"attributes": {"Name": "destination", "DistanceToNetworkInMeters": 5.0}},
        ]
    },
}

PARAMS = {"origin": "106.9177,47.9184", "destination": "106.9057,47.9220"}


def solve_form(request: httpx.Request) -> dict[str, str]:
    return dict(httpx.QueryParams(request.content.decode()))


@pytest.fixture
def na_settings(settings: Settings) -> Settings:
    settings.arcgis_route_service = ROUTE
    return settings


async def call(settings: Settings, params: dict[str, str]) -> httpx.Response:
    app = create_app(settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        return await http.get("/v1/route", params=params, headers=auth())


async def test_driving_route_uses_the_time_based_travel_mode(
    na_settings, mock_router: respx.MockRouter
) -> None:
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    solve = mock_router.post(f"{ROUTE}/solve").mock(return_value=httpx.Response(200, json=SOLVED))
    response = await call(na_settings, {**PARAMS, "mode": "driving"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["route"]["distance_meters"] == 4200.0
    assert body["route"]["duration_seconds"] == 630.0  # 10.5 minutes
    assert body["route"]["geometry"]["coordinates"] == [
        [106.9177, 47.9186],
        [106.91, 47.92],
        [106.9057, 47.922],
    ]
    assert body["waypoints"][0]["snap_distance_meters"] == 22.3
    assert body["waypoints"][1]["location"] == {"latitude": 47.922, "longitude": 106.9057}

    form = solve_form(solve.calls[0].request)
    assert json.loads(form["travelMode"])["name"] == "Driving Time"
    stops = json.loads(form["stops"])
    assert stops["spatialReference"] == {"wkid": 4326}
    assert stops["features"][0]["geometry"] == {"x": 106.9177, "y": 47.9184}
    assert form["outSR"] == "4326" and form["returnDirections"] == "false"
    assert form["accumulateAttributeNames"] == "TravelTime,Kilometers"
    assert "NAServer" not in response.text


async def test_walking_route_uses_the_walk_travel_mode(na_settings, mock_router: respx.MockRouter) -> None:
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    solve = mock_router.post(f"{ROUTE}/solve").mock(return_value=httpx.Response(200, json=SOLVED))
    body = (await call(na_settings, {**PARAMS, "mode": "walking"})).json()
    assert body["mode"] == "walking"
    assert body["route"]["duration_seconds"] == 3024.0  # 50.4 minutes of WalkTime
    assert json.loads(solve_form(solve.calls[0].request)["travelMode"])["name"] == "Walking Time"


async def test_travel_mode_names_can_be_configured(na_settings, mock_router: respx.MockRouter) -> None:
    na_settings.routing_na_driving_travel_mode = "driving distance"
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    solve = mock_router.post(f"{ROUTE}/solve").mock(return_value=httpx.Response(200, json=SOLVED))
    await call(na_settings, PARAMS)
    assert json.loads(solve_form(solve.calls[0].request)["travelMode"])["name"] == "Driving Distance"


async def test_walking_unavailable_is_a_clear_400(na_settings, mock_router: respx.MockRouter) -> None:
    description = {**DESCRIPTION, "supportedTravelModes": DESCRIPTION["supportedTravelModes"][:2]}
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=description))
    response = await call(na_settings, {**PARAMS, "mode": "walking"})
    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"field": "mode"}


@pytest.mark.parametrize(
    ("details", "reason"),
    [
        (
            ['Location "origin" in "Stops" is unlocated.', "Need at least 2 valid stops."],
            "origin_not_on_network",
        ),
        (["No solution found."], "no_path"),
    ],
)
async def test_solve_failures_map_to_404(na_settings, mock_router: respx.MockRouter, details, reason) -> None:
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    mock_router.post(f"{ROUTE}/solve").mock(
        return_value=httpx.Response(
            200, json={"error": {"code": 400, "message": "Unable to complete operation.", "details": details}}
        )
    )
    response = await call(na_settings, PARAMS)
    assert response.status_code == 404
    assert response.json()["error"]["details"]["reason"] == reason


async def test_other_solve_errors_are_upstream_errors(na_settings, mock_router: respx.MockRouter) -> None:
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    mock_router.post(f"{ROUTE}/solve").mock(
        return_value=httpx.Response(
            200,
            json={
                "error": {
                    "code": 400,
                    "message": "Invalid parameters",
                    "details": ["Invalid value for 'stops'."],
                }
            },
        )
    )
    response = await call(na_settings, PARAMS)
    assert response.status_code == 502


async def test_generated_tokens_are_sent_and_renewed(na_settings, mock_router: respx.MockRouter) -> None:
    na_settings.arcgis_username = "svc-routing"
    na_settings.arcgis_password = SecretStr("s3cret-password")
    tokens = iter(["token-1", "token-2"])

    def issue(request: httpx.Request) -> httpx.Response:
        form = solve_form(request)
        assert form["username"] == "svc-routing" and form["client"] == "requestip"
        return httpx.Response(200, json={"token": next(tokens), "expires": 9_999_999_999_000, "ssl": True})

    token_route = mock_router.post(TOKEN_URL).mock(side_effect=issue)
    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    seen: list[str] = []

    def solve(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["X-Esri-Authorization"])
        if len(seen) == 1:  # the first token was revoked on the server
            return httpx.Response(200, json={"error": {"code": 498, "message": "Invalid token."}})
        return httpx.Response(200, json=SOLVED)

    mock_router.post(f"{ROUTE}/solve").mock(side_effect=solve)
    response = await call(na_settings, PARAMS)
    assert response.status_code == 200
    assert seen == ["Bearer token-1", "Bearer token-2"]
    assert token_route.call_count == 2
    assert "token=" not in str(mock_router.calls[-1].request.url)


async def test_bad_credentials_are_an_upstream_error(na_settings, mock_router: respx.MockRouter) -> None:
    na_settings.arcgis_username = "svc-routing"
    na_settings.arcgis_password = SecretStr("wrong")
    mock_router.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "error": {
                    "code": 400,
                    "message": "Unable to generate token.",
                    "details": ["Invalid username or password."],
                }
            },
        )
    )
    response = await call(na_settings, PARAMS)
    assert response.status_code == 502
    assert "svc-routing" not in response.text and "wrong" not in response.text


async def test_readiness_checks_the_route_service(na_settings, mock_router: respx.MockRouter, arcgis) -> None:
    from tests.conftest import ADDRESSES_URL, PLACES_URL

    mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    arcgis(PLACES_URL, ["name"], [])
    arcgis(ADDRESSES_URL, ["address"], [])
    app = create_app(na_settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        ready = (await http.get("/health/ready")).json()
    assert ready["checks"]["routing_data"] == "ok"


async def test_oauth_app_credentials_with_referer(na_settings, mock_router: respx.MockRouter) -> None:
    na_settings.arcgis_client_id = "app-id"
    na_settings.arcgis_client_secret = SecretStr("app-secret")
    na_settings.arcgis_token_referer = "http://localhost:3000"
    oauth = "https://gis.example.test/arcgis/sharing/rest/oauth2/token"

    def issue(request: httpx.Request) -> httpx.Response:
        form = solve_form(request)
        assert form["grant_type"] == "client_credentials"
        assert (form["client_id"], form["client_secret"]) == ("app-id", "app-secret")
        return httpx.Response(200, json={"access_token": "app-token", "expires_in": 7200})

    token_route = mock_router.post(oauth).mock(side_effect=issue)
    description = mock_router.get(ROUTE).mock(return_value=httpx.Response(200, json=DESCRIPTION))
    solve = mock_router.post(f"{ROUTE}/solve").mock(return_value=httpx.Response(200, json=SOLVED))
    response = await call(na_settings, PARAMS)
    assert response.status_code == 200
    assert token_route.call_count == 1  # cached for the second request
    for route in (description, solve):
        request = route.calls[0].request
        assert request.headers["X-Esri-Authorization"] == "Bearer app-token"
        assert request.headers["Referer"] == "http://localhost:3000"


async def test_service_permission_errors_are_upstream_errors(
    na_settings, mock_router: respx.MockRouter
) -> None:
    mock_router.get(ROUTE).mock(
        return_value=httpx.Response(
            200,
            json={
                "error": {
                    "code": 403,
                    "subcode": 2,
                    "message": "User does not have permissions to access 'x.mapserver'.",
                }
            },
        )
    )
    response = await call(na_settings, PARAMS)
    assert response.status_code == 502
    assert "mapserver" not in response.text
