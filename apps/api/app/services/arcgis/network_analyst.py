"""ArcGIS Network Analyst (NAServer route layer) routing provider.

The service computes routes itself; this provider:
1. reads the layer description once (travel modes, cost attributes, units);
2. picks a travel mode for the requested public mode (driving -> AUTOMOBILE,
   walking -> WALK; names can be overridden in configuration);
3. calls ``solve`` with two stops in WGS84 and true-shape output;
4. converts the result to the platform's RouteResult.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Any

from app.services.arcgis.client import ArcGISFeatureServerClient, ArcGISResponseError
from app.services.arcgis.providers import translate_arcgis_errors
from app.services.geo.base import (
    Coordinate,
    GeoProviderError,
    RouteNotFound,
    RouteRequestInvalid,
    RouteResult,
    SnappedPoint,
)
from app.services.geo.geodesy import haversine_m

logger = logging.getLogger(__name__)

TIME_UNITS_SECONDS = {
    "esriNAUSeconds": 1.0,
    "esriNAUMinutes": 60.0,
    "esriNAUHours": 3600.0,
    "esriNAUDays": 86400.0,
}
LENGTH_UNITS_METERS = {
    "esriNAUMeters": 1.0,
    "esriNAUKilometers": 1000.0,
    "esriNAUMiles": 1609.344,
    "esriNAUFeet": 0.3048,
    "esriNAUYards": 0.9144,
    "esriNAUNauticalMiles": 1852.0,
    "esriNAUInches": 0.0254,
    "esriNAUCentimeters": 0.01,
    "esriNAUMillimeters": 0.001,
    "esriNAUDecimeters": 0.1,
}
TRAVEL_MODE_TYPES = {"driving": "AUTOMOBILE", "walking": "WALK"}
UNLOCATED_HINTS = ("unlocated", "not located", "could not be located")
NO_SOLUTION_HINTS = ("no solution", "need at least 2 valid stops", "no route")


@dataclass(frozen=True, slots=True)
class NetworkAnalystConfig:
    url: str
    # Optional travel-mode names per public mode, e.g. {"driving": "Driving Time"}.
    travel_mode_names: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _Description:
    travel_modes: list[dict[str, Any]]
    attribute_units: dict[str, str]
    impedance: str | None


class ArcGISNetworkAnalystRoutingProvider:
    def __init__(self, client: ArcGISFeatureServerClient, config: NetworkAnalystConfig) -> None:
        self._client = client
        self._config = config
        self._description: _Description | None = None
        self._lock = asyncio.Lock()

    async def warm_up(self) -> None:
        try:
            async with translate_arcgis_errors():
                await self._describe()
        except Exception as exc:  # best effort; requests retry lazily
            logger.warning("route_service_warmup_failed", extra={"reason": str(exc)})

    async def _describe(self) -> _Description:
        if self._description is not None:
            return self._description
        async with self._lock:
            if self._description is None:
                payload = await self._client.get_json(self._config.url, {})
                network = (
                    payload.get("networkDataset") if isinstance(payload.get("networkDataset"), dict) else {}
                )
                attributes = network.get("networkAttributes") if isinstance(network, dict) else None
                units = {
                    str(a.get("name")): str(a.get("units"))
                    for a in (attributes if isinstance(attributes, list) else [])
                    if isinstance(a, dict) and a.get("name")
                }
                modes = payload.get("supportedTravelModes")
                self._description = _Description(
                    travel_modes=[m for m in modes if isinstance(m, dict)] if isinstance(modes, list) else [],
                    attribute_units=units,
                    impedance=payload.get("impedance") if isinstance(payload.get("impedance"), str) else None,
                )
            return self._description

    def _travel_mode(self, description: _Description, mode: str) -> dict[str, Any] | None:
        name = self._config.travel_mode_names.get(mode)
        if name:
            for travel_mode in description.travel_modes:
                if str(travel_mode.get("name", "")).lower() == name.lower():
                    return travel_mode
            raise GeoProviderError(f"Travel mode {name!r} is not offered by the route service")
        wanted = TRAVEL_MODE_TYPES.get(mode)
        matches = [m for m in description.travel_modes if m.get("type") == wanted]
        # Prefer time-based modes ("Driving Time") over distance-based ones.
        matches.sort(key=lambda m: "time" not in str(m.get("name", "")).lower())
        return matches[0] if matches else None

    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult:
        async with translate_arcgis_errors():
            description = await self._describe()
            travel_mode = self._travel_mode(description, mode)
            if travel_mode is None and (description.travel_modes or mode != "driving"):
                raise RouteRequestInvalid(f"{mode.capitalize()} routes are not available.", field="mode")

            time_attr = travel_mode.get("timeAttributeName") if travel_mode else None
            distance_attr = travel_mode.get("distanceAttributeName") if travel_mode else None
            params = {
                "stops": json.dumps(
                    {
                        "type": "features",
                        "features": [
                            {
                                "geometry": {"x": origin.longitude, "y": origin.latitude},
                                "attributes": {"Name": "origin"},
                            },
                            {
                                "geometry": {"x": destination.longitude, "y": destination.latitude},
                                "attributes": {"Name": "destination"},
                            },
                        ],
                        "spatialReference": {"wkid": 4326},
                    }
                ),
                "returnRoutes": "true",
                "returnStops": "true",
                "returnDirections": "false",
                "returnBarriers": "false",
                "returnPolygonBarriers": "false",
                "returnPolylineBarriers": "false",
                "outSR": "4326",
                "outputLines": "esriNAOutputLineTrueShape",
                "findBestSequence": "false",
                "preserveFirstStop": "true",
                "preserveLastStop": "true",
            }
            if travel_mode is not None:
                params["travelMode"] = json.dumps(travel_mode)
            accumulate = [a for a in (time_attr, distance_attr) if isinstance(a, str) and a]
            if accumulate:
                params["accumulateAttributeNames"] = ",".join(accumulate)
            try:
                payload = await self._client.post_json(f"{self._config.url}/solve", params)
            except ArcGISResponseError as exc:
                not_found = _route_not_found(exc)
                if not_found is None:
                    raise
                raise not_found from exc
        return self._to_result(payload, origin, destination, description, time_attr, distance_attr)

    def _to_result(
        self,
        payload: dict[str, Any],
        origin: Coordinate,
        destination: Coordinate,
        description: _Description,
        time_attr: str | None,
        distance_attr: str | None,
    ) -> RouteResult:
        routes = payload.get("routes")
        features = routes.get("features") if isinstance(routes, dict) else None
        if not isinstance(features, list) or not features:
            raise RouteNotFound("No route connects the origin and the destination.", reason="no_path")
        route = features[0]
        attributes = route.get("attributes") or {}
        paths = (route.get("geometry") or {}).get("paths") or []
        coordinates: list[tuple[float, float]] = [
            (round(float(p[0]), 7), round(float(p[1]), 7)) for path in paths for p in path if len(p) >= 2
        ]
        if len(coordinates) < 2:
            raise GeoProviderError("The route service returned a route without geometry")

        duration = _total(attributes, description, time_attr, TIME_UNITS_SECONDS)
        distance = _total(attributes, description, distance_attr, LENGTH_UNITS_METERS)
        if distance is None:
            distance = sum(haversine_m(*a, *b) for a, b in pairwise(coordinates))
        if duration is None:
            raise GeoProviderError("The route service returned no travel time")

        snap_distances = _stop_snap_distances(payload)
        return RouteResult(
            distance_meters=distance,
            duration_seconds=duration,
            coordinates=_dedupe(coordinates),
            origin=_snapped(origin, coordinates[0], snap_distances[0]),
            destination=_snapped(destination, coordinates[-1], snap_distances[1]),
        )


def _total(
    attributes: dict[str, Any], description: _Description, name: str | None, factors: dict[str, float]
) -> float | None:
    """Total_<attribute> converted to seconds or meters using the attribute's units."""
    candidates = [name] if name else []
    # Fall back to any accumulated attribute whose units are of the right kind.
    candidates += [
        a for a, unit in description.attribute_units.items() if unit in factors and a not in candidates
    ]
    for attribute in candidates:
        value = attributes.get(f"Total_{attribute}")
        unit = description.attribute_units.get(attribute)
        if isinstance(value, (int, float)) and unit in factors:
            return float(value) * factors[unit]
    return None


def _stop_snap_distances(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    stops = payload.get("stops")
    features = stops.get("features") if isinstance(stops, dict) else None
    values: list[float | None] = []
    for feature in features if isinstance(features, list) else []:
        value = (feature.get("attributes") or {}).get("DistanceToNetworkInMeters")
        values.append(float(value) if isinstance(value, (int, float)) else None)
    values += [None, None]
    return values[0], values[1]


def _snapped(point: Coordinate, first: tuple[float, float], reported: float | None) -> SnappedPoint:
    return SnappedPoint(
        input=point,
        location=Coordinate(first[0], first[1]),
        snap_distance_meters=round(
            reported if reported is not None else haversine_m(point.longitude, point.latitude, *first), 1
        ),
        road_name=None,
    )


def _dedupe(coordinates: list[tuple[float, float]]) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for point in coordinates:
        if not result or result[-1] != point:
            result.append(point)
    return result


def _route_not_found(exc: ArcGISResponseError) -> RouteNotFound | None:
    """Solve failures that mean "no route" rather than a service problem."""
    text = " ".join(exc.details).lower()
    if any(hint in text for hint in UNLOCATED_HINTS):
        which = "origin" if "origin" in text or "location 1" in text else "destination"
        return RouteNotFound(
            f"The {which} is too far from any road the route service can use.",
            reason=f"{which}_not_on_network",
        )
    if any(hint in text for hint in NO_SOLUTION_HINTS):
        return RouteNotFound("No route connects the origin and the destination.", reason="no_path")
    return None
