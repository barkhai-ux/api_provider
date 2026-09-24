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
    type: str = Field(description="Place category, for example `landmark` or `district`.", examples=["place"])


class GeocodeResponse(BaseModel):
    query: str = Field(examples=["Sukhbaatar Square"])
    results: list[GeocodeResult]
    count: int = Field(description="Number of results returned.", examples=[1])


# --- Reverse geocoding -------------------------------------------------------------


class Address(BaseModel):
    formatted: str = Field(examples=["Sukhbaatar Square, Ulaanbaatar, Mongolia"])
    name: str | None = Field(default=None, description="Building, place or street name.")
    house_number: str | None = None
    street: str | None = None
    neighborhood: str | None = Field(default=None, description="Sub-district, for example a khoroo (хороо).")
    district: str | None = None
    city: str | None = None
    country: str | None = None


class ReverseGeocodeResponse(BaseModel):
    location: Location = Field(description="The coordinates that were requested.")
    address: Address
    match_type: Literal["address", "place", "street"] = Field(
        description="What kind of feature the address was derived from."
    )
    distance_meters: float = Field(
        description="Distance from the requested point to the match.", examples=[12.4]
    )


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
