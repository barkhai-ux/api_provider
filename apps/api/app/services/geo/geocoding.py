"""Geocoding service: forward (text) and reverse (coordinate) in one contract.

Both directions return the same `GeocodeResponse` (a list of `GeocodeResult`).
Reverse results carry `distance_meters` and use the match kind as their `type`.
"""

from __future__ import annotations

import hashlib
import logging

from app.schemas.geo import GeocodeResponse, GeocodeResult
from app.services.cache import TTLCache
from app.services.geo.base import AddressMatch, Coordinate, GeocodingProvider, ReverseGeocodingProvider

logger = logging.getLogger(__name__)

COORDINATE_DECIMALS = 6


def _reverse_id(match: AddressMatch) -> str:
    seed = f"{match.formatted}|{match.location.longitude:.6f},{match.location.latitude:.6f}"
    digest = hashlib.sha1(seed.encode(), usedforsecurity=False).hexdigest()[:16]
    return f"rev_{digest}"


class GeocodingService:
    def __init__(
        self,
        provider: GeocodingProvider,
        reverse_provider: ReverseGeocodingProvider,
        cache: TTLCache[GeocodeResponse] | None = None,
    ) -> None:
        self._provider = provider
        self._reverse_provider = reverse_provider
        self._cache = cache

    async def geocode(self, query: str, limit: int) -> GeocodeResponse:
        query = " ".join(query.split())
        cache_key = f"{query.casefold()}|{limit}"
        if self._cache is not None and (cached := self._cache.get(cache_key)) is not None:
            return cached
        places = await self._provider.search(query, limit)
        results = [
            GeocodeResult(
                id=place.id,
                name=place.name,
                address=place.address,
                latitude=round(place.location.latitude, COORDINATE_DECIMALS),
                longitude=round(place.location.longitude, COORDINATE_DECIMALS),
                type=place.type,
            )
            for place in places
        ]
        response = GeocodeResponse(query=query, results=results, count=len(results))
        if self._cache is not None:
            self._cache.set(cache_key, response)
        return response

    async def reverse(self, latitude: float, longitude: float) -> GeocodeResponse:
        query = f"{latitude:g},{longitude:g}"
        match = await self._reverse_provider.reverse(Coordinate(longitude=longitude, latitude=latitude))
        results = [] if match is None else [self._to_result(match)]
        return GeocodeResponse(query=query, results=results, count=len(results))

    @staticmethod
    def _to_result(match: AddressMatch) -> GeocodeResult:
        return GeocodeResult(
            id=_reverse_id(match),
            name=match.name or match.formatted,
            address=match.formatted,
            latitude=round(match.location.latitude, COORDINATE_DECIMALS),
            longitude=round(match.location.longitude, COORDINATE_DECIMALS),
            type=match.match_type,
            distance_meters=round(match.distance_meters, 1),
        )
