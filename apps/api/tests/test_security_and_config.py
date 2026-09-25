import pytest
from pydantic import ValidationError

from app.core.config import DEV_API_KEY_PEPPER, Environment, Settings
from app.core.security import credential_kind, hash_credential

STRONG = "x" * 48


def test_hash_matches_hmac_sha256_hex() -> None:
    # Must equal convex/lib/crypto.ts hmacSha256Hex(pepper, key).
    digest = hash_credential("geo_live_" + "a" * 32, "pepper")
    assert len(digest) == 64
    assert digest == hash_credential("geo_live_" + "a" * 32, "pepper")
    assert digest != hash_credential("geo_live_" + "a" * 32, "other-pepper")


@pytest.mark.parametrize(
    ("token", "kind"),
    [
        ("geo_" + "a" * 32, "key"),
        ("geo_live_" + "a" * 32, "key"),
        ("geo_test_" + "Z9" * 16, "key"),
        ("geo_pt_" + "b" * 40, "playground"),
        ("geo_live_" + "a" * 31, None),
        ("geo_prod_" + "a" * 32, None),
        ("geo_live_" + "a" * 31 + "!", None),
        ("Bearer something", None),
        ("", None),
    ],
)
def test_credential_kind(token: str, kind: str | None) -> None:
    assert credential_kind(token) == kind


def test_missing_environment_means_production_and_rejects_dev_secrets() -> None:
    with pytest.raises(ValidationError, match="API_KEY_PEPPER still uses a development default"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_production_rejects_short_secrets() -> None:
    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(
            _env_file=None, environment=Environment.PRODUCTION, api_key_pepper="short", gateway_secret=STRONG
        )  # type: ignore[call-arg]


PRODUCTION = {
    "environment": Environment.PRODUCTION,
    "api_key_pepper": STRONG,
    "gateway_secret": STRONG + "y",
    "convex_site_url": "https://example-123.convex.site",
    "public_api_url": "https://api.example.com",
    "cors_origins": "https://app.example.com",
}


def test_production_accepts_strong_secrets() -> None:
    settings = Settings(_env_file=None, **PRODUCTION)  # type: ignore[call-arg, arg-type]
    assert settings.is_production
    assert not settings.docs_enabled


def test_development_allows_defaults() -> None:
    settings = Settings(_env_file=None, environment=Environment.DEVELOPMENT)  # type: ignore[call-arg]
    assert settings.api_key_pepper.get_secret_value() == DEV_API_KEY_PEPPER


def test_comma_lists_and_empty_urls() -> None:
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        environment=Environment.DEVELOPMENT,
        cors_origins="https://a.example, https://b.example",  # type: ignore[arg-type]
        arcgis_geocoding_feature_server="",
    )
    assert settings.cors_origins == ["https://a.example", "https://b.example"]
    assert settings.arcgis_geocoding_feature_server is None


def test_logs_redact_api_keys_of_every_format() -> None:
    from app.core.logging import redact_text

    for secret in ("geo_" + "k" * 32, "geo_live_" + "k" * 32, "geo_test_" + "k" * 32, "geo_pt_" + "k" * 40):
        redacted = redact_text(f"auth failed for {secret}.")
        assert "kkkk" not in redacted
        assert redacted == "auth failed for geo_[REDACTED]."
    assert redact_text("geo_platform") == "geo_platform"
