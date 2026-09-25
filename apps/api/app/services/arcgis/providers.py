"""ArcGIS FeatureServer implementations of the geo provider protocols.

Field names come from configuration (see ``Settings.arcgis_*_field``), so the
real layers can be connected without code changes. Every ArcGIS failure is
translated into a provider error from ``app.services.geo.base``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from typing import Any

import anyio

from app.services.arcgis.client import (
    ArcGISError,
    ArcGISFeatureServerClient,
    ArcGISTimeoutError,
    ArcGISUnavailableError,
    EsriFeature,
    PointFilter,
)
from app.services.arcgis.geometry import polyline_paths, representative_point
from app.services.arcgis.where import contains_all_tokens_clause, normalize_search_text, prefix_clause
from app.services.geo.base import (
    AddressMatch,
    Coordinate,
    GeoProviderError,
    GeoProviderTimeout,
    GeoProviderUnavailable,
    GeoServiceUnavailable,
    Place,
    RouteNotFound,
    RouteResult,
    SnappedPoint,
)
from app.services.geo.geodesy import distance_to_polyline_m, haversine_m
from app.services.geo.road_graph import Direction, NoPathError, RoadGraph, RoadSegment, TravelProfile

logger = logging.getLogger(__name__)

MAX_SEARCH_TOKENS = 8


@contextlib.asynccontextmanager
async def translate_arcgis_errors() -> AsyncIterator[None]:
    try:
        yield
    except ArcGISTimeoutError as exc:
        raise GeoProviderTimeout(str(exc)) from exc
    except ArcGISUnavailableError as exc:
        raise GeoProviderUnavailable(str(exc)) from exc
    except ArcGISError as exc:
        raise GeoProviderError(str(exc)) from exc


def _text(attributes: dict[str, Any], field: str | None) -> str | None:
    if not field:
        return None
    value = attributes.get(field)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(attributes: dict[str, Any], field: str | None) -> float | None:
    if not field:
        return None
    value = attributes.get(field)
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _fields(*names: str | None) -> list[str]:
    return list(dict.fromkeys(name for name in names if name))


# --- Forward geocoding ---------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PlacesFieldMap:
    name: str
    alt_name: str | None
    address: str | None
    type: str | None
    importance: str | None


class ArcGISGeocodingProvider:
    def __init__(
        self,
        client: ArcGISFeatureServerClient,
        layer_url: str,
        fields: PlacesFieldMap,
        *,
        candidate_limit: int,
        default_address: str | None,
    ) -> None:
        self._client = client
        self._layer_url = layer_url
        self._fields = fields
        self._candidate_limit = candidate_limit
        self._default_address = default_address

    async def search(self, text: str, limit: int) -> list[Place]:
        normalized = normalize_search_text(text)
        if not normalized:
            return []
        search_fields = _fields(self._fields.name, self._fields.alt_name)
        # Each token becomes a leading-wildcard LIKE per field: keep the clause
        # small (unique tokens, at most MAX_SEARCH_TOKENS).
        tokens = list(dict.fromkeys(normalized.split(" ")))[:MAX_SEARCH_TOKENS]
        out_fields = _fields(
            self._fields.name,
            self._fields.alt_name,
            self._fields.address,
            self._fields.type,
            self._fields.importance,
        )
        async with translate_arcgis_errors():
            info = await self._client.layer_info(self._layer_url)
            out_fields.append(info.object_id_field)
            # Exact/prefix matches first: a capped "contains" page alone could
            # miss the exact match in a large layer.
            prefix_page, contains_page = await asyncio.gather(
                self._client.query(
                    self._layer_url,
                    where=prefix_clause(search_fields, normalized),
                    out_fields=out_fields,
                    record_count=self._candidate_limit,
                ),
                self._client.query(
                    self._layer_url,
                    where=contains_all_tokens_clause(search_fields, tokens),
                    out_fields=out_fields,
                    record_count=self._candidate_limit,
                ),
            )
            places: dict[str, Place] = {}
            for feature in [*prefix_page.features, *contains_page.features]:
                place = self._to_place(feature, info.object_id_field)
                if place is not None:
                    places.setdefault(place.id, place)
        ranked = sorted(places.values(), key=lambda p: _rank(p, normalized.upper(), tokens))
        return ranked[:limit]

    def _to_place(self, feature: EsriFeature, oid_field: str) -> Place | None:
        attributes = feature.attributes
        name = _text(attributes, self._fields.name) or _text(attributes, self._fields.alt_name)
        point = representative_point(feature.geometry)
        oid = attributes.get(oid_field)
        if name is None or point is None or oid is None:
            return None
        return Place(
            id=f"plc_{oid}",
            name=name,
            alt_name=_text(attributes, self._fields.alt_name),
            address=_text(attributes, self._fields.address) or self._default_address,
            type=(_text(attributes, self._fields.type) or "place").lower(),
            location=Coordinate(longitude=point[0], latitude=point[1]),
            importance=_number(attributes, self._fields.importance) or 0.0,
        )


def _rank(place: Place, query: str, tokens: list[str]) -> tuple[int, float, int, str]:
    names = [n.upper() for n in (place.name, place.alt_name) if n]

    def level(name: str) -> int:
        if name == query:
            return 0
        if name.startswith(query):
            return 1
        words = name.replace(",", " ").split()
        if all(any(word.startswith(token.upper()) for word in words) for token in tokens):
            return 2
        return 3

    best = min(level(name) for name in names)
    return best, -place.importance, len(place.name), place.name


# --- Reverse geocoding ----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AddressFieldMap:
    formatted: str | None
    name: str | None
    street: str | None
    house_number: str | None
    district: str | None
    city: str | None
    country: str | None


@dataclass(frozen=True, slots=True)
class ReverseLayers:
    addresses_url: str | None
    places_url: str | None
    roads_url: str | None


class ArcGISReverseGeocodingProvider:
    """Nearest address; falls back to the nearest place, then the nearest named
    road, searching outward with increasing radii."""

    def __init__(
        self,
        client: ArcGISFeatureServerClient,
        layers: ReverseLayers,
        address_fields: AddressFieldMap,
        places_fields: PlacesFieldMap,
        road_name_field: str | None,
        *,
        radii_m: list[float],
        default_city: str | None,
        default_country: str | None,
    ) -> None:
        self._client = client
        self._layers = layers
        self._address_fields = address_fields
        self._places_fields = places_fields
        self._road_name_field = road_name_field
        self._radii = radii_m
        self._default_city = default_city
        self._default_country = default_country

    async def reverse(self, point: Coordinate) -> AddressMatch | None:
        async with translate_arcgis_errors():
            for radius in self._radii:
                for finder in (self._nearest_address, self._nearest_place, self._nearest_road):
                    match = await finder(point, radius)
                    if match is not None:
                        return match
        return None

    async def _nearby(
        self, url: str, point: Coordinate, radius: float, fields: list[str]
    ) -> list[EsriFeature]:
        page = await self._client.query(
            url,
            out_fields=fields or ["*"],
            geometry=PointFilter(point.longitude, point.latitude, radius),
            record_count=200,
        )
        return page.features

    def _compose(self, *parts: str | None) -> str:
        seen: list[str] = []
        for part in parts:
            if part and part not in seen:
                seen.append(part)
        return ", ".join(seen)

    async def _nearest_address(self, point: Coordinate, radius: float) -> AddressMatch | None:
        if not self._layers.addresses_url:
            return None
        f = self._address_fields
        features = await self._nearby(
            self._layers.addresses_url,
            point,
            radius,
            _fields(f.formatted, f.name, f.street, f.house_number, f.district, f.city, f.country),
        )
        best = _closest_point_feature(features, point)
        if best is None:
            return None
        feature, (lon, lat), distance = best
        a = feature.attributes
        street, house = _text(a, f.street), _text(a, f.house_number)
        district = _text(a, f.district)
        city = _text(a, f.city) or self._default_city
        country = _text(a, f.country) or self._default_country
        name = _text(a, f.name)
        street_line = " ".join(p for p in (house, street) if p) or None
        formatted = _text(a, f.formatted)
        if formatted is None:
            formatted = self._compose(name, street_line, district, city, country)
        elif country and country not in formatted:
            formatted = self._compose(formatted, city, country)
        if not formatted:
            return None
        return AddressMatch(
            formatted=formatted,
            match_type="address",
            location=Coordinate(lon, lat),
            distance_meters=distance,
            name=name,
            house_number=house,
            street=street,
            district=district,
            city=city,
            country=country,
        )

    async def _nearest_place(self, point: Coordinate, radius: float) -> AddressMatch | None:
        if not self._layers.places_url:
            return None
        f = self._places_fields
        features = await self._nearby(
            self._layers.places_url, point, radius, _fields(f.name, f.alt_name, f.address)
        )
        best = _closest_point_feature(features, point)
        if best is None:
            return None
        feature, (lon, lat), distance = best
        name = _text(feature.attributes, f.name) or _text(feature.attributes, f.alt_name)
        if not name:
            return None
        address = _text(feature.attributes, f.address)
        return AddressMatch(
            formatted=self._compose(name, address, self._default_city, self._default_country),
            match_type="place",
            location=Coordinate(lon, lat),
            distance_meters=distance,
            name=name,
            city=self._default_city,
            country=self._default_country,
        )

    async def _nearest_road(self, point: Coordinate, radius: float) -> AddressMatch | None:
        if not self._layers.roads_url or not self._road_name_field:
            return None
        features = await self._nearby(self._layers.roads_url, point, radius, [self._road_name_field])
        best: tuple[str, float] | None = None
        for feature in features:
            name = _text(feature.attributes, self._road_name_field)
            if not name:
                continue
            for path in polyline_paths(feature.geometry):
                distance = distance_to_polyline_m(point.longitude, point.latitude, path)
                if best is None or distance < best[1]:
                    best = (name, distance)
        if best is None:
            return None
        name, distance = best
        return AddressMatch(
            formatted=self._compose(name, self._default_city, self._default_country),
            match_type="street",
            location=point,
            distance_meters=distance,
            name=name,
            street=name,
            city=self._default_city,
            country=self._default_country,
        )


def _closest_point_feature(
    features: Iterable[EsriFeature], point: Coordinate
) -> tuple[EsriFeature, tuple[float, float], float] | None:
    best: tuple[EsriFeature, tuple[float, float], float] | None = None
    for feature in features:
        location = representative_point(feature.geometry)
        if location is None:
            continue
        distance = haversine_m(point.longitude, point.latitude, location[0], location[1])
        if best is None or distance < best[2]:
            best = (feature, location, distance)
    return best


# --- Routing ----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RoadsFieldMap:
    name: str | None
    road_class: str | None
    oneway: str | None
    speed: str | None
    oneway_forward: frozenset[str]
    oneway_reverse: frozenset[str]


@dataclass(frozen=True, slots=True)
class RoutingLimits:
    max_features: int
    max_snap_m: float
    max_expansions: int
    graph_ttl_s: float


class GraphTooLargeError(GeoServiceUnavailable):
    pass


class ArcGISRoadNetworkRoutingProvider:
    """Routes over a road polyline layer. The whole layer is loaded once into an
    in-memory graph, refreshed in the background after ``graph_ttl_s``."""

    def __init__(
        self,
        client: ArcGISFeatureServerClient,
        layer_url: str,
        fields: RoadsFieldMap,
        profiles: dict[str, TravelProfile],
        limits: RoutingLimits,
    ) -> None:
        self._client = client
        self._layer_url = layer_url
        self._fields = fields
        self._profiles = profiles
        self._limits = limits
        self._graph: RoadGraph | None = None
        self._built_at = 0.0
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task[None] | None = None
        # CPU-bound graph work runs in threads; cap how many run at once.
        self._cpu_limiter = anyio.CapacityLimiter(4)

    @property
    def graph(self) -> RoadGraph | None:
        return self._graph

    async def warm_up(self) -> None:
        try:
            await self._get_graph()
        except Exception as exc:  # warm-up is best effort; requests retry lazily
            logger.warning("routing_graph_warmup_failed", extra={"reason": str(exc)})

    async def _get_graph(self) -> RoadGraph:
        graph = self._graph
        if graph is not None:
            stale = time.monotonic() - self._built_at > self._limits.graph_ttl_s
            if stale and (self._refresh_task is None or self._refresh_task.done()):
                self._refresh_task = asyncio.create_task(self._refresh())
            return graph
        async with self._lock:
            if self._graph is None:
                await self._rebuild()
            assert self._graph is not None
            return self._graph

    async def _refresh(self) -> None:
        try:
            async with self._lock:
                await self._rebuild()
        except Exception as exc:
            logger.warning("routing_graph_refresh_failed", extra={"reason": str(exc)})

    async def _rebuild(self) -> None:
        started = time.monotonic()
        f = self._fields
        async with translate_arcgis_errors():
            count = await self._client.count(self._layer_url)
            if count > self._limits.max_features:
                raise GraphTooLargeError(
                    f"Road layer has {count} features; ROUTING_MAX_FEATURES is {self._limits.max_features}"
                )
            features = await self._client.query_all(
                self._layer_url,
                out_fields=_fields(f.name, f.road_class, f.oneway, f.speed) or ["*"],
                max_records=self._limits.max_features,
            )
            segments = [segment for feature in features for segment in self._segments(feature)]
        graph = await anyio.to_thread.run_sync(
            RoadGraph.build, segments, list(self._profiles.values()), limiter=self._cpu_limiter
        )
        self._graph = graph
        self._built_at = time.monotonic()
        logger.info(
            "routing_graph_built",
            extra={
                "features": len(features),
                "nodes": graph.node_count,
                "links": graph.link_count,
                "build_ms": round((time.monotonic() - started) * 1000),
            },
        )

    def _segments(self, feature: EsriFeature) -> list[RoadSegment]:
        f = self._fields
        a = feature.attributes
        direction: Direction = "both"
        oneway = _text(a, f.oneway)
        if oneway is not None:
            if oneway in f.oneway_forward or oneway.lower() in f.oneway_forward:
                direction = "forward"
            elif oneway in f.oneway_reverse or oneway.lower() in f.oneway_reverse:
                direction = "reverse"
        road_class = _text(a, f.road_class)
        return [
            RoadSegment(
                coordinates=path,
                road_class=road_class.lower() if road_class else None,
                direction=direction,
                speed_kmh=_number(a, f.speed),
                name=_text(a, f.name),
            )
            for path in polyline_paths(feature.geometry)
        ]

    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult:
        graph = await self._get_graph()
        return await anyio.to_thread.run_sync(
            self._route_sync, graph, origin, destination, mode, limiter=self._cpu_limiter
        )

    def _route_sync(
        self, graph: RoadGraph, origin: Coordinate, destination: Coordinate, mode: str
    ) -> RouteResult:
        snaps = []
        for label, point in (("origin", origin), ("destination", destination)):
            snap = graph.snap(mode, point.longitude, point.latitude, self._limits.max_snap_m)
            if snap is None:
                raise RouteNotFound(
                    f"No road usable for {mode} within {self._limits.max_snap_m:.0f} m of the {label}.",
                    reason=f"{label}_not_on_network",
                )
            snaps.append(snap)
        origin_snap, destination_snap = snaps
        try:
            path = graph.shortest_path(mode, origin_snap, destination_snap, self._limits.max_expansions)
        except NoPathError as exc:
            message = (
                "The route search exceeded its limit."
                if exc.reason == "search_limit"
                else f"No {mode} route connects the origin and the destination."
            )
            raise RouteNotFound(message, reason=exc.reason) from exc

        def snapped(point: Coordinate, snap: Any) -> SnappedPoint:
            return SnappedPoint(
                input=point,
                location=Coordinate(round(snap.longitude, 7), round(snap.latitude, 7)),
                snap_distance_meters=round(snap.distance_m, 1),
                road_name=graph.link_name_of(snap.link),
            )

        return RouteResult(
            distance_meters=path.distance_m,
            duration_seconds=path.duration_s,
            coordinates=path.coordinates,
            origin=snapped(origin, origin_snap),
            destination=snapped(destination, destination_snap),
        )


def build_travel_profiles(
    *,
    driving_speeds: dict[str, float],
    driving_default_speed: float,
    driving_max_speed: float,
    driving_excluded: Iterable[str],
    walking_speed: float,
    walking_excluded: Iterable[str],
    use_data_speed: bool,
) -> dict[str, TravelProfile]:
    """The mode registry. Adding a mode (for example ``cycling``) means adding a
    profile here and a value to ``TravelMode``."""
    driving = TravelProfile(
        mode="driving",
        excluded_classes=frozenset(c.lower() for c in driving_excluded),
        respects_oneway=True,
        default_speed_kmh=driving_default_speed,
        max_speed_kmh=max(driving_max_speed, *driving_speeds.values(), driving_default_speed),
        class_speeds_kmh={k.lower(): v for k, v in driving_speeds.items()},
        use_data_speed=use_data_speed,
    )
    walking = TravelProfile(
        mode="walking",
        excluded_classes=frozenset(c.lower() for c in walking_excluded),
        respects_oneway=False,
        default_speed_kmh=walking_speed,
        max_speed_kmh=walking_speed,
    )
    return {"driving": driving, "walking": walking}
