"""Nominatim and OSRM adapters for the provider-neutral geo contracts."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.geo.base import (
    AddressMatch,
    Coordinate,
    GeoProviderError,
    GeoProviderTimeout,
    GeoProviderUnavailable,
    Place,
    RouteNotFound,
    RouteResult,
    SnappedPoint,
)

logger = logging.getLogger(__name__)


def _coordinate(value: Any) -> Coordinate | None:
    try:
        return Coordinate(longitude=float(value[0]), latitude=float(value[1]))
    except (IndexError, TypeError, ValueError):
        return None


def _address_text(parts: Any) -> str | None:
    if not isinstance(parts, dict):
        return None
    return ", ".join(str(value).strip() for value in parts.values() if value)


class NominatimProvider:
    def __init__(self, http: httpx.AsyncClient, base_url: str, timeout_seconds: float = 5.0) -> None:
        self._http = http
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    async def _get(self, path: str, params: dict[str, object]) -> Any:
        try:
            response = await self._http.get(
                f"{self._base_url}{path}",
                params=params,
                timeout=self._timeout,
                headers={"User-Agent": "GeoPlatform/1.0 (self-hosted test)"},
            )
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException as exc:
            raise GeoProviderTimeout("Nominatim timed out") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise GeoProviderUnavailable("Nominatim is unavailable") from exc
            raise GeoProviderError("Nominatim rejected the request") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise GeoProviderUnavailable("Nominatim is unavailable") from exc

    async def search(self, text: str, limit: int) -> list[Place]:
        rows = await self._get(
            "/search",
            {
                "q": text,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": min(limit, 10),
                "countrycodes": "mn",
                "accept-language": "mn,en",
            },
        )
        if not isinstance(rows, list):
            raise GeoProviderError("Nominatim returned an invalid response")
        places: list[Place] = []
        for row in rows:
            point = _coordinate((row.get("lon"), row.get("lat")))
            if point is None:
                continue
            name = str(row.get("name") or row.get("display_name") or "Place")
            feature_id = row.get("osm_id", row.get("place_id", "unknown"))
            places.append(
                Place(
                    id=f"osm_{row.get('osm_type', 'place')}_{feature_id}",
                    name=name,
                    alt_name=None,
                    address=str(row.get("display_name") or _address_text(row.get("address")) or name),
                    type=str(row.get("type") or row.get("class") or "place"),
                    location=point,
                    importance=float(row.get("importance") or 0.0),
                )
            )
        return places

    async def reverse(self, point: Coordinate) -> AddressMatch | None:
        row = await self._get(
            "/reverse",
            {
                "lat": point.latitude,
                "lon": point.longitude,
                "format": "jsonv2",
                "addressdetails": 1,
                "zoom": 18,
                "accept-language": "mn,en",
            },
        )
        if not isinstance(row, dict) or not row.get("display_name"):
            return None
        location = _coordinate((row.get("lon"), row.get("lat"))) or point
        address = row.get("address") if isinstance(row.get("address"), dict) else {}
        name = row.get("name") or address.get("amenity") or address.get("road")
        return AddressMatch(
            formatted=str(row["display_name"]),
            match_type="address"
            if address.get("house_number")
            else "street"
            if address.get("road")
            else "place",
            location=location,
            distance_meters=0.0,
            name=str(name) if name else None,
            house_number=str(address.get("house_number")) if address.get("house_number") else None,
            street=str(address.get("road")) if address.get("road") else None,
            neighborhood=str(address.get("suburb") or address.get("neighbourhood"))
            if (address.get("suburb") or address.get("neighbourhood"))
            else None,
            district=str(address.get("city_district") or address.get("district"))
            if (address.get("city_district") or address.get("district"))
            else None,
            city=str(address.get("city") or address.get("town") or address.get("village"))
            if (address.get("city") or address.get("town") or address.get("village"))
            else None,
            country=str(address.get("country")) if address.get("country") else None,
        )


class OSRMProvider:
    def __init__(
        self,
        http: httpx.AsyncClient,
        driving_url: str,
        walking_url: str,
        timeout_seconds: float = 8.0,
    ) -> None:
        self._http = http
        self._urls = {"driving": driving_url.rstrip("/"), "walking": walking_url.rstrip("/")}
        self._timeout = timeout_seconds

    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult:
        base_url = self._urls.get(mode)
        if base_url is None:
            raise RouteNotFound("That travel mode is unavailable.", "MODE_UNAVAILABLE")
        coordinates = f"{origin.longitude},{origin.latitude};{destination.longitude},{destination.latitude}"
        try:
            response = await self._http.get(
                f"{base_url}/route/v1/driving/{coordinates}",
                params={"overview": "full", "geometries": "geojson", "steps": "false"},
                timeout=self._timeout,
            )
            response.raise_for_status()
            body = response.json()
        except httpx.TimeoutException as exc:
            raise GeoProviderTimeout("OSRM timed out") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise GeoProviderUnavailable("OSRM is unavailable") from exc
            raise GeoProviderError("OSRM rejected the request") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise GeoProviderUnavailable("OSRM is unavailable") from exc
        if body.get("code") == "NoRoute":
            raise RouteNotFound("No route was found between these points.", "NO_ROUTE")
        routes = body.get("routes") or []
        waypoints = body.get("waypoints") or []
        if not routes or len(waypoints) < 2:
            raise RouteNotFound("No route was found between these points.", "NO_ROUTE")
        route = routes[0]
        route_points = route.get("geometry", {}).get("coordinates", [])
        origin_snap = _coordinate(waypoints[0].get("location"))
        destination_snap = _coordinate(waypoints[1].get("location"))
        if origin_snap is None or destination_snap is None or not route_points:
            raise GeoProviderError("OSRM returned an invalid route")
        return RouteResult(
            distance_meters=float(route.get("distance", 0)),
            duration_seconds=float(route.get("duration", 0)),
            coordinates=[(float(p[0]), float(p[1])) for p in route_points],
            origin=SnappedPoint(
                origin, origin_snap, float(waypoints[0].get("distance", 0)), waypoints[0].get("name")
            ),
            destination=SnappedPoint(
                destination,
                destination_snap,
                float(waypoints[1].get("distance", 0)),
                waypoints[1].get("name"),
            ),
        )

    async def warm_up(self) -> None:
        return None
