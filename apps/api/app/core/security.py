"""Credential helpers for the public API.

API keys are created and stored by Convex (hashed); this service only checks
their format and computes the same peppered hash to look them up.
"""

from __future__ import annotations

import hashlib
import hmac
import re

# geo_ + 32 letters/digits. Keys created before keys had a single type carry a
# geo_live_ or geo_test_ prefix and keep working.
API_KEY_PATTERN = re.compile(r"^geo_(?:(?:live|test)_)?[A-Za-z0-9]{32}$")
PLAYGROUND_TOKEN_PATTERN = re.compile(r"^geo_pt_[A-Za-z0-9]{40}$")


def hash_credential(secret: str, pepper: str) -> str:
    """HMAC-SHA256 with a server-side pepper. The same function runs in Convex
    (convex/lib/crypto.ts) when keys are created, so the hashes match."""
    return hmac.new(pepper.encode(), secret.encode(), hashlib.sha256).hexdigest()


def credential_kind(token: str) -> str | None:
    """``"key"`` for API keys, ``"playground"`` for playground tokens, else None."""
    if API_KEY_PATTERN.fullmatch(token):
        return "key"
    if PLAYGROUND_TOKEN_PATTERN.fullmatch(token):
        return "playground"
    return None
