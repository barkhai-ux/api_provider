"""Deliberately constrained anonymous demo API.

This surface is separate from ``/v1``: it accepts no customer credential,
cannot inherit customer scopes or quotas, and has independent distributed
rate limits plus a small local concurrency/deadline budget.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import Annotated

from fastapi import APIRouter, Query, Request

from app.api.deps import DemoAccess, DemoConcurrency, Geo
from app.api.v1.routing import COORDINATE_DESCRIPTION, parse_coordinate
from app.core.errors import ApiError, ErrorCode, invalid_request
from app.schemas.errors import error_responses
from app.schemas.geo import GeocodeResponse, RouteResponse, TravelMode
from app.services.arcgis.where import normalize_search_text
from app.services.cache import TTLCache

router = APIRouter(prefix="/demo", tags=["Demo"])


async def _within_demo_deadline[T](request: Request, operation: Awaitable[T]) -> T:
    try:
        async with asyncio.timeout(request.app.state.settings.demo_timeout_seconds):
            return await operation
    except TimeoutError as exc:
        raise ApiError(
            504,
            ErrorCode.REQUEST_TIMEOUT,
            "The demo request timed out.",
        ) from exc


@router.get(
    "/geocode",
    include_in_schema=False,
    response_model=GeocodeResponse,
    response_model_exclude_none=True,
    summary="Anonymous demo geocoding",
    responses=error_responses(400, 408, 429, 502, 503, 504),
)
async def demo_geocode(
    request: Request,
    _: DemoAccess,
    __: DemoConcurrency,
    geo: Geo,
    q: Annotated[str, Query(min_length=2, max_length=2048)],
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> GeocodeResponse:
    settings = request.app.state.settings
    normalized = normalize_search_text(q)
    if len(q) > settings.demo_max_query_length:
        raise invalid_request(
            f"The 'q' parameter may contain at most {settings.demo_max_query_length} characters.",
            field="q",
        )
    if len(normalized) < 2:
        raise invalid_request("The 'q' parameter must contain at least 2 letters or digits.", field="q")
    if limit > settings.demo_max_results:
        raise invalid_request(f"The demo returns at most {settings.demo_max_results} results.", field="limit")
    cache: TTLCache[GeocodeResponse] = request.app.state.demo_geocode_cache
    cache_key = f"geocode:{normalized}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    result = await _within_demo_deadline(request, geo.geocoding.geocode(q, limit))
    cache.set(cache_key, result)
    return result


@router.get(
    "/reverse",
    include_in_schema=False,
    response_model=GeocodeResponse,
    response_model_exclude_none=True,
    summary="Anonymous demo reverse geocoding",
    responses=error_responses(400, 408, 429, 502, 503, 504),
)
async def demo_reverse(
    request: Request,
    _: DemoAccess,
    __: DemoConcurrency,
    geo: Geo,
    lat: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    lon: Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)],
) -> GeocodeResponse:
    cache: TTLCache[GeocodeResponse] = request.app.state.demo_geocode_cache
    cache_key = f"reverse:{lat:.7f}:{lon:.7f}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    result = await _within_demo_deadline(request, geo.geocoding.reverse(lat, lon))
    cache.set(cache_key, result)
    return result


@router.get(
    "/route",
    include_in_schema=False,
    response_model=RouteResponse,
    summary="Anonymous demo routing",
    responses=error_responses(400, 404, 408, 429, 502, 503, 504),
)
async def demo_route(
    request: Request,
    _: DemoAccess,
    __: DemoConcurrency,
    geo: Geo,
    origin: Annotated[str, Query(max_length=64, description=COORDINATE_DESCRIPTION)],
    destination: Annotated[str, Query(max_length=64, description=COORDINATE_DESCRIPTION)],
    mode: Annotated[TravelMode, Query()] = TravelMode.DRIVING,
) -> RouteResponse:
    return await _within_demo_deadline(
        request,
        geo.routing.route(
            parse_coordinate(origin, "origin"),
            parse_coordinate(destination, "destination"),
            mode,
        ),
    )
