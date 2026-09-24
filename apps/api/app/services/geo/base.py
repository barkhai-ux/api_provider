"""Provider interfaces and domain types for geospatial services.

The public API talks to *services*; services talk to *providers* through the
protocols below. ArcGIS is one provider implementation. Replacing it (or adding
a Network Analyst routing provider) means writing another class that satisfies
these protocols; endpoints and response schemas stay unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

# --- Domain types ----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Coordinate:
    longitude: float
    latitude: float


@dataclass(frozen=True, slots=True)
class Place:
    id: str
    name: str
    alt_name: str | None
    address: str | None
    type: str
    location: Coordinate
    importance: float = 0.0


@dataclass(frozen=True, slots=True)
class AddressMatch:
    formatted: str
    match_type: Literal["address", "place", "street"]
    location: Coordinate
    distance_meters: float
    name: str | None = None
    house_number: str | None = None
    street: str | None = None
    neighborhood: str | None = None
    district: str | None = None
    city: str | None = None
    country: str | None = None


@dataclass(frozen=True, slots=True)
class SnappedPoint:
    input: Coordinate
    location: Coordinate
    snap_distance_meters: float
    road_name: str | None


@dataclass(frozen=True, slots=True)
class RouteResult:
    distance_meters: float
    duration_seconds: float
    coordinates: list[tuple[float, float]]
    origin: SnappedPoint
    destination: SnappedPoint
    extras: dict[str, object] = field(default_factory=dict)


# --- Provider errors ---------------------------------------------------------------
# Providers translate their own failures into these. The API layer maps them to
# the public error codes, so no data-source detail reaches clients.


class GeoProviderError(Exception):
    """The data source returned something unusable."""


class GeoProviderTimeout(GeoProviderError):
    """The data source did not answer within the time limit."""


class GeoProviderUnavailable(GeoProviderError):
    """The data source cannot be reached (connection failures, 5xx after retries)."""


class GeoServiceUnavailable(GeoProviderError):
    """The service cannot answer right now: not configured, or over capacity."""


class RouteNotFound(Exception):
    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


class RouteRequestInvalid(Exception):
    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


# --- Provider protocols --------------------------------------------------------------


class GeocodingProvider(Protocol):
    async def search(self, text: str, limit: int) -> list[Place]: ...


class ReverseGeocodingProvider(Protocol):
    async def reverse(self, point: Coordinate) -> AddressMatch | None: ...


class RoutingProvider(Protocol):
    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult: ...

    async def warm_up(self) -> None: ...
