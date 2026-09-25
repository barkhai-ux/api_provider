"""Shared fixtures.

ArcGIS FeatureServer and the Convex gateway are both mocked with respx: tests
never touch the network. ArcGIS responses are small, inline Esri-JSON payloads.
"""

from __future__ import annotations

import itertools
import json
import time
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI

from app.core.config import Environment, Settings
from app.core.security import hash_credential
from app.main import create_app

ARCGIS_ROOT = "https://gis.example.test/arcgis/rest/services"
PLACES_URL = f"{ARCGIS_ROOT}/Places/FeatureServer/0"
ADDRESSES_URL = f"{ARCGIS_ROOT}/Addresses/FeatureServer/0"
ROADS_URL = f"{ARCGIS_ROOT}/Roads/FeatureServer/0"
CONVEX_URL = "https://convex.example.test"

PEPPER = "test-pepper-0123456789abcdefghijklmnopqrstuvwxyz"
GATEWAY_SECRET = "test-gateway-secret-0123456789abcdefghijkl"
DEMO_KEY = "geo_test_" + "A" * 32
REVOKED_KEY = "geo_live_" + "R" * 32
EXPIRED_KEY = "geo_live_" + "E" * 32
LIMITED_KEY = "geo_live_" + "L" * 32
SITE_KEY = "geo_live_" + "S" * 32
PLAYGROUND_TOKEN = "geo_pt_" + "P" * 40


# --- Esri JSON builders ------------------------------------------------------------------


def layer_json(
    fields: list[str],
    *,
    oid: str = "OBJECTID",
    geometry_type: str = "esriGeometryPoint",
    max_record_count: int = 1000,
) -> dict[str, Any]:
    return {
        "name": "layer",
        "type": "Feature Layer",
        "geometryType": geometry_type,
        "objectIdField": oid,
        "maxRecordCount": max_record_count,
        "fields": [{"name": oid, "type": "esriFieldTypeOID"}]
        + [{"name": name, "type": "esriFieldTypeString"} for name in fields],
        "advancedQueryCapabilities": {"supportsPagination": True, "supportsOrderBy": True},
    }


def point(oid: int, lon: float, lat: float, **attributes: Any) -> dict[str, Any]:
    return {"attributes": {"OBJECTID": oid, **attributes}, "geometry": {"x": lon, "y": lat}}


def line(oid: int, coords: list[tuple[float, float]], **attributes: Any) -> dict[str, Any]:
    return {"attributes": {"OBJECTID": oid, **attributes}, "geometry": {"paths": [[list(c) for c in coords]]}}


def feature_set(features: list[dict[str, Any]], exceeded: bool = False) -> dict[str, Any]:
    return {"objectIdFieldName": "OBJECTID", "features": features, "exceededTransferLimit": exceeded}


# A small street grid in central Ulaanbaatar: 3 east-west x 3 north-south streets.
GRID_LONS = [106.900, 106.910, 106.920]
GRID_LATS = [47.910, 47.915, 47.920]


def grid_roads() -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    oid = 1
    for lat in GRID_LATS:
        for west, east in itertools.pairwise(GRID_LONS):
            features.append(
                line(
                    oid,
                    [(west, lat), (east, lat)],
                    name=f"East-West {lat}",
                    road_class="secondary",
                    oneway=None,
                    speed_kmh=None,
                )
            )
            oid += 1
    for lon in GRID_LONS:
        for south, north in itertools.pairwise(GRID_LATS):
            # The middle north-south street is one-way northbound (drawn south to north).
            oneway = "FT" if lon == 106.910 else None
            features.append(
                line(
                    oid,
                    [(lon, south), (lon, north)],
                    name=f"North-South {lon}",
                    road_class="residential",
                    oneway=oneway,
                    speed_kmh=None,
                )
            )
            oid += 1
    return features


# --- Convex gateway fake ------------------------------------------------------------------


@dataclass
class ConvexFake:
    """In-memory stand-in for the Convex /gateway HTTP actions."""

    keys: dict[str, dict[str, Any]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    usage: list[dict[str, Any]] = field(default_factory=list)
    authorize_calls: list[dict[str, Any]] = field(default_factory=list)
    describe_calls: list[dict[str, Any]] = field(default_factory=list)
    down: bool = False

    def add_key(
        self,
        secret: str,
        *,
        status: str = "ok",
        limit: int | None = None,
        site: bool = False,
        kind: str = "key",
        endpoints: list[str] | None = None,
    ) -> None:
        self.keys[hash_credential(secret, PEPPER)] = {
            "status": status,
            "limit": limit,
            "site": site,
            "kind": kind,
            "endpoints": endpoints,
            "keyId": f"key_{secret[-4:]}",
            "userId": "user_1",
        }

    def authorize(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("convex down")
        if request.headers.get("Authorization") != f"Bearer {GATEWAY_SECRET}":
            return httpx.Response(401, json={"error": "unauthorized"})
        data = json.loads(request.content)
        self.authorize_calls.append(data)
        key = self.keys.get(data["hash"])
        if key is None or key["kind"] != data["kind"]:
            return httpx.Response(200, json={"status": "invalid"})
        if key["status"] in ("revoked", "expired"):
            return httpx.Response(200, json={"status": key["status"]})
        principal = {
            "keyId": key["keyId"],
            "userId": key["userId"],
            "isSiteKey": key["site"],
            "viaPlayground": data["kind"] == "playground",
        }
        if key["endpoints"] is not None and data.get("endpoint") not in key["endpoints"]:
            return httpx.Response(
                200,
                json={
                    "status": "endpoint_not_allowed",
                    "principal": principal,
                    "allowedEndpoints": key["endpoints"],
                },
            )
        if key["site"] and "clientIp" in data:
            bucket, limit = f"ip:{data['clientIp']}", data["perIpLimit"]
        else:
            bucket, limit = f"key:{key['keyId']}", key["limit"] or data["defaultLimit"]
        self.counts[bucket] = self.counts.get(bucket, 0) + 1
        count = self.counts[bucket]
        reset = (int(time.time()) // 60 + 1) * 60
        return httpx.Response(
            200,
            json={
                "status": "ok" if count <= limit else "rate_limited",
                "principal": principal,
                "rateLimit": {"limit": limit, "remaining": max(0, limit - count), "reset": reset},
            },
        )

    def describe(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("convex down")
        if request.headers.get("Authorization") != f"Bearer {GATEWAY_SECRET}":
            return httpx.Response(401, json={"error": "unauthorized"})
        data = json.loads(request.content)
        self.describe_calls.append(data)
        key = self.keys.get(data["hash"])
        if key is None or key["kind"] != "key":
            return httpx.Response(200, json={"status": "invalid"})
        if key["status"] in ("revoked", "expired"):
            return httpx.Response(200, json={"status": key["status"]})
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "keyId": key["keyId"],
                "userId": key["userId"],
                "isSiteKey": key["site"],
                "rateLimitPerMinute": key["limit"],
                "accountLimit": 300,
                "routeLimit": 30,
                "endpoints": key["endpoints"],
            },
        )

    def record_usage(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("convex down")
        self.usage.extend(json.loads(request.content)["entries"])
        return httpx.Response(200, json={"written": len(self.usage)})


# --- Fixtures ----------------------------------------------------------------------------------


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment=Environment.TEST,
        convex_site_url=CONVEX_URL,
        gateway_secret=GATEWAY_SECRET,
        api_key_pepper=PEPPER,
        site_api_key=SITE_KEY,
        arcgis_geocoding_feature_server=PLACES_URL,
        arcgis_reverse_geocoding_feature_server=ADDRESSES_URL,
        arcgis_routing_feature_server=ROADS_URL,
        arcgis_timeout_seconds=1.0,
        arcgis_max_retries=2,
        rate_limit_per_minute=100,
        site_key_per_ip_per_minute=3,
        auth_cache_ttl_seconds=0,
        cache_geocode_ttl_seconds=0,
    )


@pytest.fixture
def convex() -> ConvexFake:
    fake = ConvexFake()
    fake.add_key(DEMO_KEY)
    fake.add_key(REVOKED_KEY, status="revoked")
    fake.add_key(EXPIRED_KEY, status="expired")
    fake.add_key(LIMITED_KEY, limit=2)
    fake.add_key(SITE_KEY, site=True, limit=10_000)
    fake.add_key(PLAYGROUND_TOKEN, kind="playground")
    return fake


@pytest.fixture
def mock_router(convex: ConvexFake) -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        router.post(f"{CONVEX_URL}/gateway/authorize").mock(side_effect=convex.authorize)
        router.post(f"{CONVEX_URL}/gateway/describe").mock(side_effect=convex.describe)
        router.post(f"{CONVEX_URL}/gateway/usage").mock(side_effect=convex.record_usage)
        router.get(f"{CONVEX_URL}/gateway/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        yield router


ArcGISMocker = Callable[..., None]


@pytest.fixture
def arcgis(mock_router: respx.MockRouter) -> ArcGISMocker:
    """Registers layer metadata and query responses for a mocked FeatureServer layer."""

    def register(
        url: str,
        fields: list[str],
        features: list[dict[str, Any]] | None = None,
        *,
        geometry_type: str = "esriGeometryPoint",
        query: Any = None,
        count: int | None = None,
    ) -> None:
        mock_router.get(url).mock(
            return_value=httpx.Response(200, json=layer_json(fields, geometry_type=geometry_type))
        )

        def respond(request: httpx.Request) -> httpx.Response:
            params = dict(request.url.params)
            if request.method == "POST":
                params.update(dict(httpx.QueryParams(request.content.decode())))
            if params.get("returnCountOnly") == "true":
                return httpx.Response(
                    200, json={"count": count if count is not None else len(features or [])}
                )
            where = params.get("where", "")
            items = features or []
            if " > " in where:
                last = int(where.rsplit(" > ", 1)[1])
                items = [f for f in items if f["attributes"]["OBJECTID"] > last]
            return httpx.Response(200, json=feature_set(items))

        route = mock_router.route(url__startswith=f"{url}/query")
        route.mock(side_effect=query or respond)

    return register


@pytest.fixture
def app(settings: Settings, mock_router: respx.MockRouter) -> FastAPI:
    return create_app(settings, http_client=httpx.AsyncClient())


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as http:
        yield http


def auth(key: str = DEMO_KEY) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}
