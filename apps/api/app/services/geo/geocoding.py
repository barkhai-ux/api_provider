"""Forward and reverse geocoding services (provider-agnostic)."""

from __future__ import annotations

import logging

from app.schemas.geo import Address, GeocodeResponse, GeocodeResult, Location, ReverseGeocodeResponse
from app.services.cache import TTLCache
from app.services.geo.base import Coordinate, GeocodingProvider, ReverseGeocodingProvider

logger = logging.getLogger(__name__)

COORDINATE_DECIMALS = 6


class GeocodingService:
    def __init__(self, provider: GeocodingProvider, cache: TTLCache[GeocodeResponse] | None = None) -> None:
        self._provider = provider
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


class ReverseGeocodingService:
    def __init__(self, provider: ReverseGeocodingProvider) -> None:
        self._provider = provider

    async def reverse_geocode(self, latitude: float, longitude: float) -> ReverseGeocodeResponse | None:
        match = await self._provider.reverse(Coordinate(longitude=longitude, latitude=latitude))
        if match is None:
            return None
        return ReverseGeocodeResponse(
            location=Location(latitude=latitude, longitude=longitude),
            address=Address(
                formatted=match.formatted,
                name=match.name,
                house_number=match.house_number,
                street=match.street,
                neighborhood=match.neighborhood,
                district=match.district,
                city=match.city,
                country=match.country,
            ),
            match_type=match.match_type,
            distance_meters=round(match.distance_meters, 1),
        )
