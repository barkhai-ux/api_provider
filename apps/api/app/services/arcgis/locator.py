"""ArcGIS GeocodeServer (locator) providers.

A locator answers in its own REST dialect: ``suggest`` for partial text,
``findAddressCandidates`` for coordinates and ``reverseGeocode`` for points.
Forward geocoding calls ``suggest`` (which handles prefixes and partial words,
unlike ``findAddressCandidates``) and then resolves each suggestion to
coordinates with its ``magicKey``. Everything is normalized to the platform's
domain types; no locator structure reaches the public API.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.arcgis.client import (
    ArcGISFeatureServerClient,
    ArcGISResponseError,
)
from app.services.arcgis.providers import translate_arcgis_errors
from app.services.geo.base import AddressMatch, Coordinate, Place
from app.services.geo.geodesy import haversine_m

logger = logging.getLogger(__name__)

# ArcGIS caps suggestions at 15 per request.
MAX_SUGGESTIONS = 15
CANDIDATE_FIELDS = ",".join(
    [
        *("PlaceName", "Place_addr", "Match_addr", "LongLabel", "Addr_type", "Type"),
        *("Nbrhd", "City", "Subregion", "Region", "AddNum", "StName", "StAddr"),
    ]
)
REVERSE_NOT_FOUND = "unable to find address"
_ADDRESS_TYPES = {"PointAddress", "StreetAddress", "StreetAddressExt", "Subaddress", "BuildingName", "Parcel"}
_STREET_TYPES = {"StreetName", "StreetInt", "StreetMidBlock", "StreetBetween", "DistanceMarker"}


class _Suggestion(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    text: str
    magic_key: str = Field(alias="magicKey")
    is_collection: bool = Field(default=False, alias="isCollection")


class _Candidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location: dict[str, float]
    score: float = 0.0
    attributes: dict[str, Any] = Field(default_factory=dict)


def _text(attributes: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = attributes.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def dedupe_parts(*parts: str | None) -> list[str]:
    """Drop empty and repeated components (locators often repeat the district)."""
    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return seen


def split_label(label: str) -> list[str]:
    return [part.strip() for part in label.split(",") if part.strip()]


def place_name(label: str, attributes: dict[str, Any]) -> str:
    """Locator place names carry the area as a suffix ("Name, 6-р хороо, District").
    Strip trailing parts that repeat the area fields."""
    parts = split_label(label)
    # Area fields may themselves hold several parts ("7-р баг, Жаргалан").
    area = {
        part
        for key in ("Nbrhd", "Neighborhood", "City", "Subregion", "Region")
        for part in split_label(_text(attributes, key) or "")
    }
    while len(parts) > 1 and parts[-1] in area:
        parts.pop()
    return ", ".join(parts) if parts else label


def _match_type(addr_type: str | None) -> Literal["address", "place", "street"]:
    if addr_type in _ADDRESS_TYPES:
        return "address"
    if addr_type in _STREET_TYPES:
        return "street"
    return "place"


@dataclass(frozen=True, slots=True)
class LocatorConfig:
    url: str
    default_country: str | None
    resolve_concurrency: int = 6


class ArcGISLocatorGeocodingProvider:
    def __init__(self, client: ArcGISFeatureServerClient, config: LocatorConfig) -> None:
        self._client = client
        self._config = config

    async def search(self, text: str, limit: int) -> list[Place]:
        query = " ".join(text.split())[:200]
        async with translate_arcgis_errors():
            # Each suggestion costs one findAddressCandidates call (billable on
            # ArcGIS Online), so ask for and resolve no more than requested.
            wanted = min(MAX_SUGGESTIONS, limit)
            payload = await self._client.get_json(
                f"{self._config.url}/suggest",
                {"text": query, "maxSuggestions": str(wanted)},
            )
            suggestions = self._parse_suggestions(payload)[:wanted]
            semaphore = asyncio.Semaphore(self._config.resolve_concurrency)

            async def resolve(suggestion: _Suggestion) -> Place | None:
                async with semaphore:
                    return await self._resolve(suggestion)

            resolved = await asyncio.gather(*(resolve(s) for s in suggestions))
        places: list[Place] = []
        seen: set[tuple[str, float, float]] = set()
        for place in resolved:
            if place is None:
                continue
            key = (place.name, round(place.location.longitude, 4), round(place.location.latitude, 4))
            if key not in seen:
                seen.add(key)
                places.append(place)
        return places[:limit]

    @staticmethod
    def _parse_suggestions(payload: dict[str, Any]) -> list[_Suggestion]:
        raw = payload.get("suggestions")
        if not isinstance(raw, list):
            raise ArcGISResponseError("Suggest response has no 'suggestions' member")
        suggestions: list[_Suggestion] = []
        for item in raw:
            try:
                suggestions.append(_Suggestion.model_validate(item))
            except ValidationError:
                continue
        return suggestions

    async def _resolve(self, suggestion: _Suggestion) -> Place | None:
        payload = await self._client.get_json(
            f"{self._config.url}/findAddressCandidates",
            {
                "SingleLine": suggestion.text,
                "magicKey": suggestion.magic_key,
                "maxLocations": "1",
                "outFields": CANDIDATE_FIELDS,
                "outSR": "4326",
            },
        )
        raw = payload.get("candidates")
        if not isinstance(raw, list) or not raw:
            return None
        try:
            candidate = _Candidate.model_validate(raw[0])
        except ValidationError:
            return None
        x, y = candidate.location.get("x"), candidate.location.get("y")
        if x is None or y is None:
            return None
        attrs = candidate.attributes
        label = _text(attrs, "PlaceName", "Match_addr", "LongLabel") or suggestion.text
        name = place_name(label, attrs)
        address = ", ".join(
            dedupe_parts(
                _text(attrs, "StAddr"),
                _text(attrs, "Nbrhd"),
                _text(attrs, "City"),
                _text(attrs, "Subregion"),
                _text(attrs, "Region"),
                self._config.default_country,
            )
        )
        kind = _text(attrs, "Type")
        if kind is None or kind.lower() == "other":
            kind = _text(attrs, "Addr_type") or "place"
        digest = hashlib.sha1(f"{name}|{x:.6f}|{y:.6f}".encode(), usedforsecurity=False).hexdigest()[:16]
        return Place(
            id=f"loc_{digest}",
            name=name,
            alt_name=None,
            address=address or None,
            type=kind.lower(),
            location=Coordinate(longitude=float(x), latitude=float(y)),
            importance=candidate.score,
        )


class ArcGISLocatorReverseGeocodingProvider:
    def __init__(
        self, client: ArcGISFeatureServerClient, config: LocatorConfig, radii_m: list[float]
    ) -> None:
        self._client = client
        self._config = config
        self._radii = radii_m

    async def reverse(self, point: Coordinate) -> AddressMatch | None:
        async with translate_arcgis_errors():
            for radius in self._radii:
                try:
                    payload = await self._client.get_json(
                        f"{self._config.url}/reverseGeocode",
                        {
                            "location": f"{point.longitude},{point.latitude}",
                            "distance": f"{radius:.0f}",
                            "outSR": "4326",
                        },
                    )
                except ArcGISResponseError as exc:
                    if any(REVERSE_NOT_FOUND in detail.lower() for detail in exc.details):
                        continue
                    raise
                match = self._to_match(payload, point)
                if match is not None:
                    return match
        return None

    def _to_match(self, payload: dict[str, Any], point: Coordinate) -> AddressMatch | None:
        attrs = payload.get("address")
        location = payload.get("location")
        if not isinstance(attrs, dict) or not isinstance(location, dict):
            return None
        x, y = location.get("x"), location.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return None
        label = _text(attrs, "LongLabel", "Match_addr", "PlaceName")
        if label is None:
            return None
        neighborhood = _text(attrs, "Neighborhood", "Nbrhd")
        district = _text(attrs, "City")
        city = _text(attrs, "Subregion", "Region")
        formatted = ", ".join(dedupe_parts(*split_label(label), self._config.default_country))
        name_label = _text(attrs, "PlaceName", "Match_addr")
        return AddressMatch(
            formatted=formatted,
            match_type=_match_type(_text(attrs, "Addr_type")),
            location=Coordinate(float(x), float(y)),
            distance_meters=haversine_m(point.longitude, point.latitude, float(x), float(y)),
            name=place_name(name_label, attrs) if name_label else None,
            house_number=_text(attrs, "AddNum"),
            street=_text(attrs, "Address", "StAddr"),
            neighborhood=neighborhood,
            district=district,
            city=city,
            country=self._config.default_country,
        )
