"""End-to-end tests of the public API through the full middleware stack, with
ArcGIS FeatureServer and the Convex gateway mocked."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx

from tests.conftest import (
    ADDRESSES_URL,
    DEMO_KEY,
    EXPIRED_KEY,
    LIMITED_KEY,
    PLACES_URL,
    PLAYGROUND_TOKEN,
    REVOKED_KEY,
    ROADS_URL,
    SITE_KEY,
    ArcGISMocker,
    ConvexFake,
    auth,
    grid_roads,
    point,
)

PLACE_FIELDS = ["name", "alt_name", "address", "type", "importance"]
ADDRESS_FIELDS = ["address", "name", "street", "house_number", "district", "city", "country"]
ROAD_FIELDS = ["name", "road_class", "oneway", "speed_kmh"]

PLACES = [
    point(
        1,
        106.9176,
        47.9189,
        name="Sukhbaatar Square",
        alt_name="Сүхбаатарын талбай",
        address=None,
        type="landmark",
        importance=1.0,
    ),
    point(
        2,
        106.92,
        47.93,
        name="Sukhbaatar District",
        alt_name="Сүхбаатар дүүрэг",
        address="Ulaanbaatar, Mongolia",
        type="district",
        importance=0.6,
    ),
    point(
        3, 106.91, 47.92, name="Square Tower", alt_name=None, address=None, type="building", importance=0.2
    ),
]


def error_of(response: httpx.Response) -> dict:
    body = response.json()
    assert set(body) == {"error"}, body
    assert {"code", "message"} <= set(body["error"])
    return body["error"]


# --- Authentication -------------------------------------------------------------------------


async def test_missing_key(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh"})
    assert response.status_code == 401
    assert error_of(response)["code"] == "INVALID_API_KEY"
    assert "Authorization" in error_of(response)["message"]


async def test_malformed_key_is_rejected_without_a_lookup(
    client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth("not-a-key"))
    assert response.status_code == 401
    assert convex.authorize_calls == []


async def test_unknown_key(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth("geo_live_" + "Q" * 32))
    assert response.status_code == 401
    assert error_of(response)["code"] == "INVALID_API_KEY"


async def test_revoked_key(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(REVOKED_KEY))
    assert response.status_code == 403
    assert error_of(response)["code"] == "API_KEY_REVOKED"


async def test_expired_key(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(EXPIRED_KEY))
    assert response.status_code == 401
    assert error_of(response)["details"] == {"reason": "expired"}


async def test_single_type_key_is_accepted(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    key = "geo_" + "N" * 32
    convex.add_key(key)
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(key))
    assert response.status_code == 200


async def test_endpoint_is_sent_to_convex(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    await client.get("/v1/reverse-geocode", params={"lat": 47.9, "lon": 106.9}, headers=auth())
    assert [call["endpoint"] for call in convex.authorize_calls] == ["geocode", "reverse-geocode"]


async def test_key_limited_to_other_endpoints_is_refused(
    app, client: httpx.AsyncClient, convex: ConvexFake
) -> None:
    key = "geo_" + "G" * 32
    convex.add_key(key, endpoints=["geocode"])
    response = await client.get(
        "/v1/route", params={"origin": "106.91,47.91", "destination": "106.92,47.92"}, headers=auth(key)
    )
    assert response.status_code == 403
    error = error_of(response)
    assert error["code"] == "ENDPOINT_NOT_ALLOWED"
    assert error["details"] == {"allowed_endpoints": ["geocode"]}
    # The refusal is attributable, so it shows up in the developer's usage.
    await app.state.recorder.flush()
    assert [(u["endpoint"], u["statusCode"]) for u in convex.usage] == [("/v1/route", 403)]


async def test_only_the_hash_is_sent_to_convex(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    call = convex.authorize_calls[0]
    assert DEMO_KEY not in json.dumps(call)
    assert len(call["hash"]) == 64
    assert call["kind"] == "key"


async def test_playground_tokens_are_accepted(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(PLAYGROUND_TOKEN))
    assert response.status_code == 200
    assert convex.authorize_calls[0]["kind"] == "playground"


async def test_accounts_backend_down_fails_closed(client: httpx.AsyncClient, convex: ConvexFake) -> None:
    convex.down = True
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 503
    assert error_of(response)["code"] == "SERVICE_UNAVAILABLE"


# --- Rate limiting ---------------------------------------------------------------------------


async def test_rate_limit_headers_and_429(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    first = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(LIMITED_KEY))
    assert first.headers["X-RateLimit-Limit"] == "2"
    assert first.headers["X-RateLimit-Remaining"] == "1"
    assert int(first.headers["X-RateLimit-Reset"]) > 0
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(LIMITED_KEY))
    third = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth(LIMITED_KEY))
    assert third.status_code == 429
    assert error_of(third) == {
        "code": "RATE_LIMIT_EXCEEDED",
        "message": "Too many requests.",
        "details": {"limit": 2},
    }
    assert third.headers["X-RateLimit-Remaining"] == "0"
    assert 1 <= int(third.headers["Retry-After"]) <= 60


async def test_site_key_is_limited_per_visitor_ip(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    headers = {**auth(SITE_KEY), "X-Client-IP": "203.0.113.7"}
    statuses = [
        (await client.get("/v1/geocode", params={"q": "sukh"}, headers=headers)).status_code for _ in range(4)
    ]
    assert statuses == [200, 200, 200, 429]  # site_key_per_ip_per_minute = 3
    other = await client.get(
        "/v1/geocode", params={"q": "sukh"}, headers={**auth(SITE_KEY), "X-Client-IP": "198.51.100.1"}
    )
    assert other.status_code == 200
    assert convex.authorize_calls[0]["clientIp"] == "203.0.113.7"


async def test_client_ip_is_ignored_for_regular_keys(
    client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers={**auth(), "X-Client-IP": "203.0.113.7"})
    assert "clientIp" not in convex.authorize_calls[0]


# --- Geocoding -------------------------------------------------------------------------------


async def test_geocode_returns_normalized_ranked_results(
    client: httpx.AsyncClient, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    response = await client.get("/v1/geocode", params={"q": "Sukhbaatar Square", "limit": 5}, headers=auth())
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "Sukhbaatar Square"
    assert body["count"] == len(body["results"])
    first = body["results"][0]
    assert first == {
        "id": "plc_1",
        "name": "Sukhbaatar Square",
        "address": "Ulaanbaatar, Mongolia",
        "latitude": 47.9189,
        "longitude": 106.9176,
        "type": "landmark",
    }
    assert "attributes" not in response.text and "OBJECTID" not in response.text


async def test_geocode_queries_are_case_insensitive_and_escaped(
    client: httpx.AsyncClient, arcgis: ArcGISMocker, mock_router: respx.MockRouter
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "o'sukh"}, headers=auth())
    wheres = [
        call.request.url.params["where"] for call in mock_router.calls if "/query" in str(call.request.url)
    ]
    assert any("UPPER(name) LIKE 'O''SUKH%'" in where for where in wheres)


async def test_geocode_limit(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    response = await client.get("/v1/geocode", params={"q": "sukh", "limit": 1}, headers=auth())
    assert response.json()["count"] == 1


async def test_geocode_no_results_is_not_an_error(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, [])
    response = await client.get("/v1/geocode", params={"q": "nowhere"}, headers=auth())
    assert response.status_code == 200
    assert response.json() == {"query": "nowhere", "results": [], "count": 0}


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"q": "a"}, "q"),
        ({}, "q"),
        ({"q": "sukh", "limit": 0}, "limit"),
        ({"q": "sukh", "limit": 21}, "limit"),
        ({"q": "%%"}, "q"),
        ({"q": "x" * 201}, "q"),
    ],
)
async def test_geocode_validation(client: httpx.AsyncClient, params: dict, field: str) -> None:
    response = await client.get("/v1/geocode", params=params, headers=auth())
    assert response.status_code == 400
    error = error_of(response)
    assert error["code"] == "INVALID_REQUEST"
    assert error["details"]["field"] == field


# --- Reverse geocoding ----------------------------------------------------------------------


async def test_reverse_geocode_prefers_addresses(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(
        ADDRESSES_URL,
        ADDRESS_FIELDS,
        [
            point(
                1,
                106.9178,
                47.9192,
                address=None,
                name="Government Palace",
                street="Chingis Avenue",
                house_number="1",
                district="Sukhbaatar District",
                city="Ulaanbaatar",
                country="Mongolia",
            ),
        ],
    )
    response = await client.get(
        "/v1/reverse-geocode", params={"lat": 47.9191, "lon": 106.9177}, headers=auth()
    )
    assert response.status_code == 200
    body = response.json()
    assert body["location"] == {"latitude": 47.9191, "longitude": 106.9177}
    assert (
        body["address"]["formatted"]
        == "Government Palace, 1 Chingis Avenue, Sukhbaatar District, Ulaanbaatar, Mongolia"
    )
    assert body["match_type"] == "address"
    assert body["distance_meters"] < 50


async def test_reverse_geocode_falls_back_to_places_then_streets(
    client: httpx.AsyncClient, arcgis: ArcGISMocker
) -> None:
    arcgis(ADDRESSES_URL, ADDRESS_FIELDS, [])
    arcgis(PLACES_URL, PLACE_FIELDS, [])
    arcgis(ROADS_URL, ROAD_FIELDS, grid_roads(), geometry_type="esriGeometryPolyline")
    response = await client.get(
        "/v1/reverse-geocode", params={"lat": 47.9151, "lon": 106.905}, headers=auth()
    )
    body = response.json()
    assert body["match_type"] == "street"
    assert body["address"]["street"] == "East-West 47.915"


async def test_reverse_geocode_not_found(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    for url, fields in (
        (ADDRESSES_URL, ADDRESS_FIELDS),
        (PLACES_URL, PLACE_FIELDS),
        (ROADS_URL, ROAD_FIELDS),
    ):
        arcgis(url, fields, [])
    response = await client.get("/v1/reverse-geocode", params={"lat": 47.0, "lon": 100.0}, headers=auth())
    assert response.status_code == 404
    assert error_of(response)["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"lat": 91, "lon": 106}, "lat"),
        ({"lat": 47, "lon": -181}, "lon"),
        ({"lat": "abc", "lon": 106}, "lat"),
        ({"lon": 106}, "lat"),
        ({"lat": "nan", "lon": 106}, "lat"),
    ],
)
async def test_reverse_geocode_validation(client: httpx.AsyncClient, params: dict, field: str) -> None:
    response = await client.get("/v1/reverse-geocode", params=params, headers=auth())
    assert response.status_code == 400
    assert error_of(response)["details"]["field"] == field


# --- Routing ----------------------------------------------------------------------------------


async def test_route_returns_geojson_distance_and_duration(
    client: httpx.AsyncClient, arcgis: ArcGISMocker
) -> None:
    arcgis(ROADS_URL, ROAD_FIELDS, grid_roads(), geometry_type="esriGeometryPolyline")
    response = await client.get(
        "/v1/route",
        params={"origin": "106.900,47.910", "destination": "106.920,47.920", "mode": "driving"},
        headers=auth(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    route = body["route"]
    assert route["geometry"]["type"] == "LineString"
    assert route["geometry"]["coordinates"][0] == [106.9, 47.91]
    assert route["geometry"]["coordinates"][-1] == [106.92, 47.92]
    assert 2000 < route["distance_meters"] < 2800
    assert route["duration_seconds"] > 0
    assert body["mode"] == "driving"
    assert [w["name"] for w in body["waypoints"]] != []


async def test_route_respects_oneway_for_driving_only(
    client: httpx.AsyncClient, arcgis: ArcGISMocker
) -> None:
    arcgis(ROADS_URL, ROAD_FIELDS, grid_roads(), geometry_type="esriGeometryPolyline")
    params = {
        "origin": "106.910,47.920",
        "destination": "106.910,47.910",
    }  # southbound on a northbound one-way
    driving = (await client.get("/v1/route", params={**params, "mode": "driving"}, headers=auth())).json()
    walking = (await client.get("/v1/route", params={**params, "mode": "walking"}, headers=auth())).json()
    assert walking["route"]["distance_meters"] == pytest.approx(1112, rel=0.02)
    assert driving["route"]["distance_meters"] > walking["route"]["distance_meters"] + 1000


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"origin": "abc", "destination": "106.9,47.9"}, "origin"),
        ({"origin": "106.9,47.9", "destination": "47.9"}, "destination"),
        ({"origin": "106.9,95", "destination": "106.9,47.9"}, "origin"),
        ({"origin": "106.9,47.9", "destination": "106.9,47.9", "mode": "flying"}, "mode"),
        ({"origin": "106.9,47.9", "destination": "96.0,47.9"}, "destination"),  # > 100 km apart
    ],
)
async def test_route_validation(client: httpx.AsyncClient, params: dict, field: str) -> None:
    response = await client.get("/v1/route", params=params, headers=auth())
    assert response.status_code == 400
    assert error_of(response)["details"]["field"] == field


async def test_route_point_far_from_roads(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(ROADS_URL, ROAD_FIELDS, grid_roads(), geometry_type="esriGeometryPolyline")
    response = await client.get(
        "/v1/route", params={"origin": "106.90,47.91", "destination": "106.95,47.95"}, headers=auth()
    )
    assert response.status_code == 404
    assert error_of(response)["details"]["reason"] == "destination_not_on_network"


async def test_route_network_too_large(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    arcgis(ROADS_URL, ROAD_FIELDS, grid_roads(), geometry_type="esriGeometryPolyline", count=10_000_000)
    response = await client.get(
        "/v1/route", params={"origin": "106.90,47.91", "destination": "106.92,47.92"}, headers=auth()
    )
    assert response.status_code == 503
    assert error_of(response)["code"] == "SERVICE_UNAVAILABLE"


# --- Upstream failures --------------------------------------------------------------------------


async def test_upstream_error_body_maps_to_502_without_leaking(
    client: httpx.AsyncClient, arcgis: ArcGISMocker
) -> None:
    arcgis(
        PLACES_URL,
        PLACE_FIELDS,
        query=lambda request: httpx.Response(
            200, json={"error": {"code": 400, "message": "Invalid field: name", "details": []}}
        ),
    )
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 502
    assert error_of(response)["code"] == "UPSTREAM_ERROR"
    assert "gis.example.test" not in response.text and "arcgis" not in response.text.lower()


async def test_upstream_timeout_maps_to_408(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    arcgis(PLACES_URL, PLACE_FIELDS, query=slow)
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 408
    assert error_of(response)["code"] == "REQUEST_TIMEOUT"


async def test_upstream_unreachable_maps_to_502(
    client: httpx.AsyncClient, mock_router: respx.MockRouter
) -> None:
    mock_router.route(url__startswith=PLACES_URL).mock(side_effect=httpx.ConnectError("refused"))
    response = await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 502
    assert error_of(response)["code"] == "UPSTREAM_ERROR"


async def test_unconfigured_data_source_maps_to_503(settings, mock_router: respx.MockRouter) -> None:
    from app.main import create_app

    settings.arcgis_geocoding_feature_server = None
    app = create_app(settings, http_client=httpx.AsyncClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as http:
        response = await http.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    assert response.status_code == 503


# --- Usage tracking ------------------------------------------------------------------------------


async def test_requests_are_recorded_in_batches(
    app, client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    await client.get("/v1/geocode", params={"q": "a"}, headers=auth())
    await client.get("/v1/geocode", params={"q": "sukh"})  # unauthenticated: not attributable
    assert convex.usage == []  # nothing sent on the request path
    written = await app.state.recorder.flush()
    assert written == 2
    assert [(u["endpoint"], u["method"], u["statusCode"]) for u in convex.usage] == [
        ("/v1/geocode", "GET", 200),
        ("/v1/geocode", "GET", 400),
    ]
    assert all(u["keyId"] == "key_AAAA" and u["responseTimeMs"] >= 0 for u in convex.usage)
    assert "q=" not in json.dumps(convex.usage)


async def test_usage_is_kept_when_convex_is_down(
    app, client: httpx.AsyncClient, convex: ConvexFake, arcgis: ArcGISMocker
) -> None:
    from app.services.gateway import ConvexGatewayError

    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    await client.get("/v1/geocode", params={"q": "sukh"}, headers=auth())
    convex.down = True
    with pytest.raises(ConvexGatewayError):
        await app.state.recorder.flush()
    assert app.state.recorder.pending == 1
    convex.down = False
    assert await app.state.recorder.flush() == 1


# --- HTTP behavior -------------------------------------------------------------------------------


async def test_unknown_paths_and_methods_use_the_envelope(client: httpx.AsyncClient) -> None:
    missing = await client.get("/v1/nope")
    assert missing.status_code == 404 and error_of(missing)["code"] == "NOT_FOUND"
    wrong_method = await client.post("/v1/geocode", headers=auth())
    assert wrong_method.status_code == 405 and error_of(wrong_method)["code"] == "INVALID_REQUEST"


async def test_cors_headers_on_errors(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/geocode", params={"q": "x"}, headers={"Origin": "https://app.example"})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "*"
    assert "X-RateLimit-Remaining" in response.headers["access-control-expose-headers"]


async def test_preflight(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/v1/geocode",
        headers={
            "Origin": "https://app.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


async def test_security_headers_and_request_id(client: httpx.AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "trace-12345678"})
    assert response.headers["X-Request-ID"] == "trace-12345678"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'none'" in response.headers["Content-Security-Policy"]


async def test_health(client: httpx.AsyncClient, arcgis: ArcGISMocker) -> None:
    assert (await client.get("/health")).json() == {"status": "ok"}
    arcgis(PLACES_URL, PLACE_FIELDS, PLACES)
    arcgis(ADDRESSES_URL, ADDRESS_FIELDS, [])
    arcgis(ROADS_URL, ROAD_FIELDS, [], geometry_type="esriGeometryPolyline")
    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ok",
        "checks": {
            "accounts": "ok",
            "geocoding_data": "ok",
            "reverse_geocoding_data": "ok",
            "routing_data": "ok",
        },
    }


async def test_readiness_fails_when_accounts_backend_is_down(
    client: httpx.AsyncClient, arcgis: ArcGISMocker, mock_router: respx.MockRouter
) -> None:
    for url, fields in (
        (ADDRESSES_URL, ADDRESS_FIELDS),
        (PLACES_URL, PLACE_FIELDS),
        (ROADS_URL, ROAD_FIELDS),
    ):
        arcgis(url, fields, [])
    mock_router.get("https://convex.example.test/gateway/health").mock(side_effect=httpx.ConnectError("down"))
    ready = await client.get("/health/ready")
    assert ready.status_code == 503
    assert ready.json()["status"] == "unavailable"
    assert "example.test" not in ready.text


# --- OpenAPI ------------------------------------------------------------------------------------


async def test_openapi_describes_only_the_public_api(client: httpx.AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()
    assert set(schema["paths"]) == {
        "/v1/geocode",
        "/v1/reverse-geocode",
        "/v1/route",
        "/health",
        "/health/ready",
    }
    geocode = schema["paths"]["/v1/geocode"]["get"]
    assert geocode["security"] == [{"ApiKey": []}]
    assert "422" not in geocode["responses"]
    assert {"400", "401", "403", "429", "502"} <= set(geocode["responses"])
    assert "arcgis" not in json.dumps(schema).lower()
    assert (await client.get("/docs")).status_code == 200
    assert (await client.get("/redoc")).status_code == 200


def test_committed_openapi_schema_is_up_to_date(settings) -> None:
    """packages/types/openapi.json must match the code (run `npm run generate:types`)."""
    from app.core.config import Settings
    from app.main import create_app

    committed = Path(__file__).resolve().parents[3] / "packages" / "types" / "openapi.json"
    live = create_app(Settings(environment="development", public_api_url="https://api.YOUR_DOMAIN")).openapi()
    assert json.loads(committed.read_text()) == json.loads(json.dumps(live)), (
        "OpenAPI schema drifted; run `npm run generate:types`"
    )
