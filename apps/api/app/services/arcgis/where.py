"""Safe construction of ArcGIS ``where`` clauses from user input.

User text is reduced to an allowlist of characters (letters of any script,
digits, spaces and a little punctuation). SQL wildcards and backslashes are
removed rather than escaped, because ESCAPE support varies between ArcGIS
backends and they carry no meaning in place names. Single quotes are doubled.
"""

from __future__ import annotations

import re

from app.services.arcgis.client import validate_field_name

_DISALLOWED = re.compile(r"[^\w\s\-.,'&/#№()]|_", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")


def normalize_search_text(text: str) -> str:
    cleaned = _DISALLOWED.sub(" ", text)
    return _WHITESPACE.sub(" ", cleaned).strip()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def upper_like(field: str, pattern: str) -> str:
    """``UPPER(field) LIKE '<pattern>'``; ``pattern`` must already be normalized
    and may contain only the ``%`` wildcards added by this module."""
    return f"UPPER({validate_field_name(field)}) LIKE {sql_literal(pattern.upper())}"


def any_field_like(fields: list[str], pattern: str) -> str:
    return "(" + " OR ".join(upper_like(field, pattern) for field in fields) + ")"


def prefix_clause(fields: list[str], text: str) -> str:
    return any_field_like(fields, f"{text}%")


def contains_all_tokens_clause(fields: list[str], tokens: list[str]) -> str:
    return " AND ".join(any_field_like(fields, f"%{token}%") for token in tokens)
