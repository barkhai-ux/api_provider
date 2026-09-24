"""Routing service (provider-agnostic)."""

from __future__ import annotations

from app.schemas.geo import LineString, Location, Route, RouteResponse, TravelMode, Waypoint
from app.services.geo.base import Coordinate, RouteRequestInvalid, RoutingProvider, SnappedPoint
from app.services.geo.geodesy import haversine_m


class RoutingService:
    def __init__(self, provider: RoutingProvider, max_distance_km: float) -> None:
        self._provider = provider
        self._max_distance_m = max_distance_km * 1000

    async def route(self, origin: Coordinate, destination: Coordinate, mode: TravelMode) -> RouteResponse:
        straight_line = haversine_m(
            origin.longitude, origin.latitude, destination.longitude, destination.latitude
        )
        if straight_line > self._max_distance_m:
            raise RouteRequestInvalid(
                f"Origin and destination are {straight_line / 1000:.1f} km apart; "
                f"the maximum is {self._max_distance_m / 1000:.0f} km.",
                field="destination",
            )
        result = await self._provider.route(origin, destination, mode.value)
        return RouteResponse(
            route=Route(
                distance_meters=round(result.distance_meters, 1),
                duration_seconds=round(result.duration_seconds, 1),
                geometry=LineString(coordinates=result.coordinates),
            ),
            mode=mode,
            waypoints=[_waypoint(result.origin), _waypoint(result.destination)],
        )


def _waypoint(point: SnappedPoint) -> Waypoint:
    return Waypoint(
        input=Location(latitude=point.input.latitude, longitude=point.input.longitude),
        location=Location(latitude=point.location.latitude, longitude=point.location.longitude),
        snap_distance_meters=point.snap_distance_meters,
        name=point.road_name,
    )
