"""Liveness and readiness probes.

``/health`` only says the process is up. ``/health/ready`` checks dependencies:
it returns 503 when the accounts backend (Convex) is unreachable, because no
request can be authenticated then; data-source problems only mark the service
as degraded. Bodies say ok/fail per dependency and never include URLs.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.arcgis.client import ArcGISError
from app.services.gateway import ConvexGateway
from app.services.geo.factory import GeoServices

router = APIRouter(tags=["Health"])

CheckStatus = Literal["ok", "fail", "not_configured"]
READY_TIMEOUT_SECONDS = 3.0


class HealthResponse(BaseModel):
    status: Literal["ok"]


class ReadinessResponse(BaseModel):
    status: Literal["ok", "degraded", "unavailable"]
    checks: dict[str, CheckStatus]


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


async def _check_source(geo: GeoServices, name: str) -> CheckStatus:
    source = geo.data_sources.get(name)
    if source is None:
        return "not_configured"
    kind, url = source
    try:
        if kind in ("locator", "service"):
            await asyncio.wait_for(geo.arcgis_client.get_json(url, {}), READY_TIMEOUT_SECONDS)
        else:
            await asyncio.wait_for(geo.arcgis_client.layer_info(url), READY_TIMEOUT_SECONDS)
    except (ArcGISError, TimeoutError):
        return "fail"
    return "ok"


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    responses={503: {"model": ReadinessResponse, "description": "A required dependency is unavailable."}},
)
async def ready(request: Request) -> JSONResponse:
    gateway: ConvexGateway = request.app.state.gateway
    geo: GeoServices = request.app.state.geo
    accounts_ok, geocoding, reverse, routing = await asyncio.gather(
        gateway.ping(),
        _check_source(geo, "geocoding"),
        _check_source(geo, "reverse_geocoding"),
        _check_source(geo, "routing"),
    )
    checks: dict[str, CheckStatus] = {
        "accounts": "ok" if accounts_ok else "fail",
        "geocoding_data": geocoding,
        "reverse_geocoding_data": reverse,
        "routing_data": routing,
    }
    if not accounts_ok:
        status: Literal["ok", "degraded", "unavailable"] = "unavailable"
    elif any(value != "ok" for value in checks.values()):
        status = "degraded"
    else:
        status = "ok"
    body = ReadinessResponse(status=status, checks=checks)
    return JSONResponse(body.model_dump(), status_code=503 if status == "unavailable" else 200)
