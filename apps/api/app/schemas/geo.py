"""Public response schemas for /v1. These models are the API contract: they are
independent of any data source (ArcGIS or otherwise)."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class TravelMode(StrEnum):
    DRIVING = "driving"
    WALKING = "walking"


class Location(BaseModel):
    latitude: float = Field(examples=[47.9184])
    longitude: float = Field(examples=[106.9177])


# --- Geocoding -------------------------------------------------------------------


class GeocodeResult(BaseModel):
    id: str = Field(description="Opaque, stable identifier of the place.", examples=["plc_123"])
    name: str = Field(examples=["Sukhbaatar Square"])
    address: str | None = Field(default=None, examples=["Ulaanbaatar, Mongolia"])
    latitude: float = Field(examples=[47.9184])
    longitude: float = Field(examples=[106.9177])
    type: str = Field(
        description="Place category, or for reverse lookups the match kind (`address`, `place`, `street`).",
        examples=["place"],
    )
    distance_meters: float | None = Field(
        default=None,
        description="Only for reverse lookups: distance in metres from the requested point to this match.",
        examples=[12.4],
    )


class GeocodeResponse(BaseModel):
    query: str = Field(
        description="The text searched, or `lat,lon` for a reverse lookup.", examples=["Sukhbaatar Square"]
    )
    results: list[GeocodeResult]
    count: int = Field(description="Number of results returned.", examples=[1])


# --- Routing -----------------------------------------------------------------------


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float]] = Field(
        description="GeoJSON positions as `[longitude, latitude]` pairs.",
        examples=[[[106.9177, 47.9184], [106.9057, 47.922]]],
    )


class Route(BaseModel):
    distance_meters: float = Field(examples=[4200.0])
    duration_seconds: float = Field(examples=[620.0])
    geometry: LineString


class Waypoint(BaseModel):
    input: Location = Field(description="The coordinate you sent.")
    location: Location = Field(description="The point on the road network the route starts or ends at.")
    snap_distance_meters: float = Field(description="Distance between `input` and `location`.")
    name: str | None = Field(default=None, description="Name of the road at the snapped location.")


class RouteResponse(BaseModel):
    route: Route
    mode: TravelMode
    waypoints: list[Waypoint] = Field(description="Snapped origin and destination, in that order.")
