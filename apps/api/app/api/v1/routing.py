from __future__ import annotations

import math
import re
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ApiKeyPrincipal, Geo
from app.core.errors import invalid_request
from app.schemas.errors import error_responses
from app.schemas.geo import RouteResponse, TravelMode
from app.services.geo.base import Coordinate

router = APIRouter()

_COORDINATE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")
COORDINATE_DESCRIPTION = "Longitude and latitude separated by a comma, in that order (GeoJSON order)."


def parse_coordinate(value: str, field: str) -> Coordinate:
    match = _COORDINATE.fullmatch(value)
    if not match:
        raise invalid_request(f"The '{field}' parameter must look like 'longitude,latitude'.", field=field)
    lon, lat = float(match.group(1)), float(match.group(2))
    if not (math.isfinite(lon) and -180 <= lon <= 180):
        raise invalid_request(f"The longitude in '{field}' must be between -180 and 180.", field=field)
    if not (math.isfinite(lat) and -90 <= lat <= 90):
        raise invalid_request(
            f"The latitude in '{field}' must be between -90 and 90. Coordinates are 'longitude,latitude'.",
            field=field,
        )
    return Coordinate(longitude=lon, latitude=lat)


@router.get(
    "/route",
    response_model=RouteResponse,
    operation_id="route",
    summary="Calculate a route between two points",
    description=(
        "Returns the fastest route for the chosen travel mode, with its distance, estimated travel time "
        "and a GeoJSON LineString. Origin and destination are snapped to the nearest road the mode can "
        "use; the snapped points are returned in `waypoints`."
    ),
    tags=["Routing"],
    responses=error_responses(400, 401, 403, 404, 408, 429, 500, 502, 503),
)
async def route(
    _: ApiKeyPrincipal,
    geo: Geo,
    origin: Annotated[
        str, Query(max_length=64, description=COORDINATE_DESCRIPTION, examples=["106.9177,47.9184"])
    ],
    destination: Annotated[
        str, Query(max_length=64, description=COORDINATE_DESCRIPTION, examples=["106.9057,47.9220"])
    ],
    mode: Annotated[TravelMode, Query(description="Travel mode.")] = TravelMode.DRIVING,
) -> RouteResponse:
    return await geo.routing.route(
        parse_coordinate(origin, "origin"), parse_coordinate(destination, "destination"), mode
    )
