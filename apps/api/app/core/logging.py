"""Structured JSON logging with secret redaction.

Log lines never contain API keys, passwords, session or reset tokens. The
redaction filter scrubs both message text and structured ``extra`` fields.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "password",
    "new_password",
    "current_password",
    "token",
    "secret",
    "api_key",
    "key",
    "x-internal-secret",
    "x-esri-authorization",
    "access_token",
    "refresh_token",
    "client_secret",
    "gateway_secret",
    "api_key_pepper",
    "pepper",
}
_SECRET_PATTERNS = [
    # API keys of every format, playground tokens.
    (re.compile(r"geo_(?:(?:live|test|pt)_)?[A-Za-z0-9]{10,}"), "geo_[REDACTED]"),
    # ArcGIS API keys and OAuth access tokens (AAPT..., AAPK...).
    (re.compile(r"\bAAP[A-Z][A-Za-z0-9._~+/=-]{20,}"), "[REDACTED_ARCGIS_TOKEN]"),
    # Authorization and Cookie header values (any scheme).
    (re.compile(r"(?i)\b(bearer|basic)\s+[^\s\"',]+"), r"\1 [REDACTED]"),
    (re.compile(r"(?i)\b((?:set-)?cookie\s*[:=]\s*)[^\n\"]+"), r"\1[REDACTED]"),
    # key=value in query strings and forms.
    (
        re.compile(
            r"(?i)\b(token|access_token|refresh_token|client_secret|password|secret|api_key|code)=[^&\s\"']+"
        ),
        r"\1=[REDACTED]",
    ),
    # "key": "value" in JSON.
    (
        re.compile(
            r'(?i)("(?:token|access_token|refresh_token|client_secret|password|secret|api_key)"\s*:\s*")[^"]*"'
        ),
        r'\1[REDACTED]"',
    ),
    # Credentials inside URLs (https://user:pass@host).
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@"), r"\1[REDACTED]@"),
]
# Attributes present on every LogRecord; anything else came from ``extra=``.
_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime", "taskName"}


def redact_text(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _redact_value(key: str, value: Any) -> Any:
    if key.lower() in _SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {k: _redact_value(str(k), v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_redact_value(key, item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = _redact_value(key, value)
        if record.exc_info:
            payload["exception"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Route uvicorn's own loggers through the JSON handler. Our middleware writes
    # the access log, so uvicorn's (which includes raw query strings) is muted.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
