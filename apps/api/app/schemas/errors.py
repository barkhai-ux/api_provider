"""Error envelope schema, used to document every error response in OpenAPI."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

PublicErrorCode = Literal[
    "INVALID_REQUEST",
    "INVALID_API_KEY",
    "API_KEY_REVOKED",
    "ENDPOINT_NOT_ALLOWED",
    "NOT_FOUND",
    "REQUEST_TIMEOUT",
    "RATE_LIMIT_EXCEEDED",
    "INTERNAL_ERROR",
    "UPSTREAM_ERROR",
    "SERVICE_UNAVAILABLE",
]


class ErrorDetail(BaseModel):
    code: PublicErrorCode = Field(description="Stable, machine-readable error code.")
    message: str = Field(description="Human-readable explanation. Wording may change; do not parse it.")
    details: dict[str, Any] | None = Field(
        default=None, description="Optional structured context, for example the offending `field`."
    )
    request_id: str | None = Field(
        default=None,
        description="Identifies this request in the server logs (same as the `X-Request-ID` header). "
        "Quote it when you contact support.",
    )


class ErrorResponse(BaseModel):
    error: ErrorDetail


def _example(
    status: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    *,
    also: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details:
        body["details"] = details
    return {
        "model": ErrorResponse,
        "description": f"{status} {code}" + (f" or {also}" if also else ""),
        "content": {"application/json": {"example": {"error": body}}},
    }


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries for the given error statuses."""
    catalog: dict[int, dict[str, Any]] = {
        400: _example(
            400, "INVALID_REQUEST", "Invalid value for 'lat': must be between -90 and 90.", {"field": "lat"}
        ),
        401: _example(401, "INVALID_API_KEY", "The API key is missing or invalid."),
        403: _example(403, "API_KEY_REVOKED", "This API key has been revoked.", also="ENDPOINT_NOT_ALLOWED"),
        404: _example(404, "NOT_FOUND", "No result was found for this request."),
        408: _example(408, "REQUEST_TIMEOUT", "The data service did not respond in time."),
        429: _example(429, "RATE_LIMIT_EXCEEDED", "Too many requests."),
        500: _example(500, "INTERNAL_ERROR", "Internal server error."),
        502: _example(502, "UPSTREAM_ERROR", "The upstream data service returned an error."),
        503: _example(503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable."),
    }
    return {status: catalog[status] for status in statuses}
