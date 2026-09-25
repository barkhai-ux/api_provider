"""Error model shared by every endpoint.

All non-2xx responses use one envelope::

    {"error": {"code": "INVALID_REQUEST", "message": "...", "details": {...}}}
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    # Public API codes (documented in /developers/docs/errors).
    INVALID_REQUEST = "INVALID_REQUEST"
    INVALID_API_KEY = "INVALID_API_KEY"
    API_KEY_REVOKED = "API_KEY_REVOKED"
    ENDPOINT_NOT_ALLOWED = "ENDPOINT_NOT_ALLOWED"
    NOT_FOUND = "NOT_FOUND"
    REQUEST_TIMEOUT = "REQUEST_TIMEOUT"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


class ApiError(Exception):
    """An error that maps directly to an HTTP response in the standard envelope."""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def invalid_request(message: str, field: str | None = None, **extra: Any) -> ApiError:
    details: dict[str, Any] = {"field": field} if field else {}
    details.update(extra)
    return ApiError(400, ErrorCode.INVALID_REQUEST, message, details or None)


def not_found(message: str, **details: Any) -> ApiError:
    return ApiError(404, ErrorCode.NOT_FOUND, message, details or None)


def error_body(code: ErrorCode | str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": str(code), "message": message}
    if details:
        error["details"] = details
    # The same id is in the X-Request-ID header and in the server logs, so a
    # developer can quote it when asking for support.
    request_id = request_id_var.get()
    if request_id:
        error["request_id"] = request_id
    return {"error": error}


def error_response(
    status_code: int,
    code: ErrorCode | str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(error_body(code, message, details), status_code=status_code, headers=headers)


_STATUS_DEFAULTS: dict[int, tuple[ErrorCode, str]] = {
    400: (ErrorCode.INVALID_REQUEST, "The request is invalid."),
    401: (ErrorCode.INVALID_API_KEY, "Authentication is required."),
    403: (ErrorCode.INVALID_REQUEST, "You do not have access to this resource."),
    404: (ErrorCode.NOT_FOUND, "The requested resource was not found."),
    405: (ErrorCode.INVALID_REQUEST, "This HTTP method is not allowed for this endpoint."),
    408: (ErrorCode.REQUEST_TIMEOUT, "The request timed out."),
    413: (ErrorCode.INVALID_REQUEST, "The request body is too large."),
    429: (ErrorCode.RATE_LIMIT_EXCEEDED, "Too many requests."),
    502: (ErrorCode.UPSTREAM_ERROR, "The upstream data service returned an error."),
    503: (ErrorCode.SERVICE_UNAVAILABLE, "The service is temporarily unavailable."),
}


def _describe_validation_error(error: dict[str, Any]) -> tuple[str | None, str]:
    location = [str(part) for part in error.get("loc", ()) if part not in ("query", "path", "body", "header")]
    field = ".".join(location) or None
    message = str(error.get("msg", "Invalid value"))
    # Pydantic prefixes messages from custom validators with "Value error, ".
    message = message.removeprefix("Value error, ")
    if error.get("type") == "missing":
        return field, f"The '{field}' parameter is required."
    if field:
        return (
            field,
            f"Invalid value for '{field}': {message[0].lower() + message[1:] if message else message}",
        )
    return None, message


async def _api_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = list(exc.errors())
    field, message = _describe_validation_error(errors[0]) if errors else (None, "The request is invalid.")
    details: dict[str, Any] = {}
    if field:
        details["field"] = field
    if len(errors) > 1:
        details["errors"] = [
            {"field": f, "message": m} for f, m in (_describe_validation_error(e) for e in errors)
        ]
    return error_response(400, ErrorCode.INVALID_REQUEST, message, details or None)


async def _http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code, default_message = _STATUS_DEFAULTS.get(
        exc.status_code,
        (ErrorCode.INTERNAL_ERROR, "Internal server error.")
        if exc.status_code >= 500
        else (ErrorCode.INVALID_REQUEST, "The request is invalid."),
    )
    # Starlette's default details ("Not Found") are replaced with our own wording.
    message = default_message
    return error_response(exc.status_code, code, message, headers=getattr(exc, "headers", None))


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
