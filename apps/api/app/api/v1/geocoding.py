from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ApiKeyPrincipal, Geo
from app.core.errors import invalid_request
from app.schemas.errors import error_responses
from app.schemas.geo import GeocodeResponse
from app.services.arcgis.where import normalize_search_text

router = APIRouter()

MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 200


@router.get(
    "/geocode",
    response_model=GeocodeResponse,
    response_model_exclude_none=True,
    operation_id="geocode",
    summary="Geocode a place, address or coordinate",
    description=(
        "One geocoding endpoint in two directions:\n\n"
        "- **Forward** — pass `q` (a place name or address). Results are ranked: exact name matches "
        "first, then names starting with the query, then names containing every word.\n"
        "- **Reverse** — pass `lat` and `lon`. The single nearest meaningful location is returned, "
        "with `type` set to the match kind (`address`, `place`, `street`) and `distance_meters` set.\n\n"
        "Both directions return the same shape: a `results` array (empty when nothing matched, which is "
        "not an error). Send either `q` or both `lat` and `lon`, not both and not neither."
    ),
    tags=["Geocoding"],
    responses=error_responses(400, 401, 403, 408, 429, 500, 502, 503),
)
async def geocode(
    _: ApiKeyPrincipal,
    geo: Geo,
    q: Annotated[
        str | None,
        Query(
            min_length=MIN_QUERY_LENGTH,
            max_length=MAX_QUERY_LENGTH,
            description="Forward geocoding: place name or address. Latin and Cyrillic are both supported.",
            examples=["Sukhbaatar Square"],
        ),
    ] = None,
    lat: Annotated[
        float | None,
        Query(
            ge=-90,
            le=90,
            allow_inf_nan=False,
            description="Reverse geocoding: latitude (WGS84).",
            examples=[47.9184],
        ),
    ] = None,
    lon: Annotated[
        float | None,
        Query(
            ge=-180,
            le=180,
            allow_inf_nan=False,
            description="Reverse geocoding: longitude (WGS84).",
            examples=[106.9177],
        ),
    ] = None,
    limit: Annotated[
        int, Query(ge=1, le=20, description="Forward geocoding: maximum number of results.")
    ] = 5,
) -> GeocodeResponse:
    forward = q is not None
    reverse = lat is not None or lon is not None
    if forward and reverse:
        raise invalid_request(
            "Provide either 'q' (forward) or 'lat' and 'lon' (reverse), not both.", field="q"
        )
    if not forward and not reverse:
        raise invalid_request("Provide 'q' to search, or 'lat' and 'lon' to reverse geocode.", field="q")
    if reverse:
        if lat is None:
            raise invalid_request("The 'lat' parameter is required for a reverse lookup.", field="lat")
        if lon is None:
            raise invalid_request("The 'lon' parameter is required for a reverse lookup.", field="lon")
        return await geo.geocoding.reverse(lat, lon)
    assert q is not None
    if len(normalize_search_text(q)) < MIN_QUERY_LENGTH:
        raise invalid_request(
            f"The 'q' parameter must contain at least {MIN_QUERY_LENGTH} letters or digits.", field="q"
        )
    return await geo.geocoding.geocode(q, limit)
