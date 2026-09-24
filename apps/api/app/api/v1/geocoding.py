from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ApiKeyPrincipal, Geo
from app.core.errors import invalid_request, not_found
from app.schemas.errors import error_responses
from app.schemas.geo import GeocodeResponse, ReverseGeocodeResponse
from app.services.arcgis.where import normalize_search_text

router = APIRouter()

MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 200


@router.get(
    "/geocode",
    response_model=GeocodeResponse,
    operation_id="geocode",
    summary="Geocode a place name or address",
    description=(
        "Turns a place name or address into coordinates. Results are ranked: exact name matches first, then "
        "names that start with the query, then names containing every word of the query. "
        "An empty `results` array means nothing matched; it is not an error."
    ),
    tags=["Geocoding"],
    responses=error_responses(400, 401, 403, 408, 429, 500, 502, 503),
)
async def geocode(
    _: ApiKeyPrincipal,
    geo: Geo,
    q: Annotated[
        str,
        Query(
            min_length=MIN_QUERY_LENGTH,
            max_length=MAX_QUERY_LENGTH,
            description="Place name or address to search for. Latin and Cyrillic are both supported.",
            examples=["Sukhbaatar Square"],
        ),
    ],
    limit: Annotated[int, Query(ge=1, le=20, description="Maximum number of results.")] = 5,
) -> GeocodeResponse:
    if len(normalize_search_text(q)) < MIN_QUERY_LENGTH:
        raise invalid_request(
            f"The 'q' parameter must contain at least {MIN_QUERY_LENGTH} letters or digits.", field="q"
        )
    return await geo.geocoding.geocode(q, limit)


@router.get(
    "/reverse-geocode",
    response_model=ReverseGeocodeResponse,
    operation_id="reverseGeocode",
    summary="Find the address at a coordinate",
    description=(
        "Turns a latitude/longitude into the nearest meaningful location: an address if one is close, "
        "otherwise a named place, otherwise the nearest named street (`match_type` tells you which). "
        "Returns 404 when nothing is found within 2 km."
    ),
    tags=["Reverse geocoding"],
    responses=error_responses(400, 401, 403, 404, 408, 429, 500, 502, 503),
)
async def reverse_geocode(
    _: ApiKeyPrincipal,
    geo: Geo,
    lat: Annotated[
        float,
        Query(
            ge=-90,
            le=90,
            allow_inf_nan=False,
            description="Latitude in decimal degrees (WGS84).",
            examples=[47.9184],
        ),
    ],
    lon: Annotated[
        float,
        Query(
            ge=-180,
            le=180,
            allow_inf_nan=False,
            description="Longitude in decimal degrees (WGS84).",
            examples=[106.9177],
        ),
    ],
) -> ReverseGeocodeResponse:
    result = await geo.reverse_geocoding.reverse_geocode(lat, lon)
    if result is None:
        raise not_found("No address or place was found near this location.")
    return result
