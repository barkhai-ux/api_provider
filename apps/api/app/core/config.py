"""Application settings, loaded from environment variables.

Every value that differs between environments lives here. Nothing else in the
code base reads ``os.environ`` directly.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.urls import check_upstream_url


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


# Development-only fallbacks. The production guard below refuses to start while
# any of these is still in use, so they can never reach a real deployment.
DEV_API_KEY_PEPPER = "dev-only-api-key-pepper-change-me-0123456789"
DEV_GATEWAY_SECRET = "dev-only-gateway-secret-change-me-0123456789"  # noqa: S105
MIN_SECRET_LENGTH = 32

CommaList = Annotated[list[str], NoDecode]

DEFAULT_DRIVING_SPEEDS_KMH: dict[str, float] = {
    "motorway": 90,
    "motorway_link": 50,
    "trunk": 70,
    "trunk_link": 40,
    "primary": 60,
    "primary_link": 40,
    "secondary": 50,
    "secondary_link": 35,
    "tertiary": 40,
    "tertiary_link": 30,
    "unclassified": 30,
    "residential": 25,
    "living_street": 10,
    "service": 15,
}
DEFAULT_DRIVING_EXCLUDED_CLASSES = [
    "footway",
    "path",
    "pedestrian",
    "steps",
    "cycleway",
    "bridleway",
    "corridor",
]
DEFAULT_WALKING_EXCLUDED_CLASSES = ["motorway", "motorway_link", "trunk", "trunk_link"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- General -----------------------------------------------------------
    # A missing ENVIRONMENT is treated as production so that a forgotten
    # variable fails closed (strict secret checks) instead of open.
    environment: Environment = Environment.PRODUCTION
    app_name: str = "Geo Platform API"
    log_level: str = "INFO"
    public_api_url: str = "http://localhost:8000"

    # --- Convex (accounts, API keys, usage, rate limits) ------------------------
    # The gateway calls Convex HTTP actions (the deployment's "site" URL) with a
    # shared secret. Convex owns all persistent state; this service is stateless.
    convex_site_url: str = "http://localhost:3211"
    gateway_secret: SecretStr = SecretStr(DEV_GATEWAY_SECRET)
    convex_timeout_seconds: float = Field(default=3.0, gt=0)

    # --- Secrets -----------------------------------------------------------
    # HMAC pepper for API keys. Must match API_KEY_PEPPER in the Convex
    # deployment, which hashes keys when they are created.
    api_key_pepper: SecretStr = SecretStr(DEV_API_KEY_PEPPER)
    # The key the Next.js server uses for the public map. Only its hash is used
    # here: requests made with it get an extra per-visitor (client IP) limit.
    site_api_key: SecretStr | None = None

    # --- HTTP --------------------------------------------------------------
    # Browser origins allowed to call /v1 (the developer playground). An
    # explicit list is required in production; "*" is refused there.
    cors_origins: CommaList = ["*"]
    max_request_body_bytes: int = Field(default=16 * 1024, ge=1024)
    max_query_string_bytes: int = Field(default=2048, ge=256)
    max_query_params: int = Field(default=16, ge=1)
    max_header_bytes: int = Field(default=16 * 1024, ge=1024)
    max_header_count: int = Field(default=64, ge=8)
    # Swagger UI and ReDoc. Off in production unless enabled; /openapi.json
    # (the public contract) is always served.
    api_docs_enabled: bool | None = None
    # A single-IP header set by a trusted edge proxy that overwrites client
    # values (cf-connecting-ip on Render). Unset: the connection's address,
    # after Uvicorn's --proxy-headers handling for trusted local proxies.
    client_ip_header: str | None = None
    # Permit plain-HTTP or private-network upstream URLs in production (only
    # for services on a private network you control).
    allow_http_upstreams: bool = False

    # --- Rate limiting -----------------------------------------------------
    rate_limit_per_minute: int = Field(default=100, ge=1)
    site_key_per_ip_per_minute: int = Field(default=60, ge=1)
    # Before authentication: failed key checks per client IP and minute. Past
    # this, requests from that IP get 429 without a lookup.
    failed_auth_per_ip_per_minute: int = Field(default=60, ge=1)
    # Seconds a hash that Convex did not recognise is remembered, so repeating
    # the same bad key does not cause another lookup.
    invalid_key_cache_seconds: float = Field(default=30.0, ge=0)

    # --- Caching -----------------------------------------------------------
    # In-process cache for geocoding results. 0 disables it (the default).
    cache_geocode_ttl_seconds: int = Field(default=0, ge=0)
    cache_geocode_max_entries: int = Field(default=10_000, ge=1)

    # --- ArcGIS (internal data sources) ------------------------------------
    # A GeocodeServer (locator). When set it answers /v1/geocode and
    # /v1/reverse-geocode; FeatureServer layers then only serve as fallbacks.
    arcgis_geocode_server: str | None = None
    locator_resolve_concurrency: int = Field(default=6, ge=1, le=20)
    # A Network Analyst route layer (.../NAServer/Route). When set, it answers
    # /v1/route instead of the road-network graph.
    arcgis_route_service: str | None = None
    arcgis_geocoding_feature_server: str | None = None
    arcgis_reverse_geocoding_feature_server: str | None = None
    arcgis_routing_feature_server: str | None = None
    # Authentication for secured services, in order of precedence: an OAuth
    # app (client credentials), a service account, or a static token.
    # Generated tokens are renewed automatically.
    arcgis_token: SecretStr | None = None
    arcgis_client_id: str | None = None
    arcgis_client_secret: SecretStr | None = None
    arcgis_username: str | None = None
    arcgis_password: SecretStr | None = None
    # Defaults to <server>/arcgis/sharing/rest/oauth2/token (app credentials)
    # or .../generateToken (service account) of the configured services.
    arcgis_token_url: str | None = None
    # When set, tokens are bound to this Referer (sent with every request);
    # otherwise to this server's IP address.
    arcgis_token_referer: str | None = None
    arcgis_token_expiration_minutes: int = Field(default=60, ge=5, le=60 * 24 * 14)
    arcgis_timeout_seconds: float = Field(default=8.0, gt=0)
    arcgis_max_retries: int = Field(default=2, ge=0, le=5)
    # Concurrent upstream requests across all ArcGIS services; more wait up to
    # ARCGIS_QUEUE_TIMEOUT_SECONDS, then fail with 503.
    arcgis_max_concurrency: int = Field(default=16, ge=1, le=256)
    arcgis_queue_timeout_seconds: float = Field(default=5.0, gt=0)
    arcgis_max_response_bytes: int = Field(default=32 * 1024 * 1024, ge=64 * 1024)
    arcgis_max_records: int = Field(default=250_000, ge=1)

    # Places layer (forward geocoding)
    arcgis_places_name_field: str = "name"
    arcgis_places_alt_name_field: str | None = "alt_name"
    arcgis_places_address_field: str | None = "address"
    arcgis_places_type_field: str | None = "type"
    arcgis_places_importance_field: str | None = "importance"
    geocode_candidate_limit: int = Field(default=50, ge=5, le=500)

    # Addresses layer (reverse geocoding)
    arcgis_addresses_formatted_field: str | None = "address"
    arcgis_addresses_name_field: str | None = "name"
    arcgis_addresses_street_field: str | None = "street"
    arcgis_addresses_house_number_field: str | None = "house_number"
    arcgis_addresses_district_field: str | None = "district"
    arcgis_addresses_city_field: str | None = "city"
    arcgis_addresses_country_field: str | None = "country"
    address_default_city: str | None = "Ulaanbaatar"
    address_default_country: str | None = "Mongolia"
    reverse_geocode_radii_meters: CommaList = ["100", "500", "2000"]

    # Roads layer (routing)
    arcgis_roads_name_field: str | None = "name"
    arcgis_roads_class_field: str | None = "road_class"
    arcgis_roads_oneway_field: str | None = "oneway"
    arcgis_roads_speed_field: str | None = "speed_kmh"
    arcgis_oneway_forward_values: CommaList = ["FT", "yes", "true", "1", "Y", "T"]
    arcgis_oneway_reverse_values: CommaList = ["TF", "-1", "reverse"]

    # --- Routing -------------------------------------------------------------
    # auto: the route service if ARCGIS_ROUTE_SERVICE is set, else the road layer.
    routing_provider: Literal["auto", "arcgis_network_analyst", "arcgis_road_network"] = "auto"
    # Travel-mode names on the route service; empty = pick by type
    # (AUTOMOBILE for driving, WALK for walking), preferring time-based modes.
    routing_na_driving_travel_mode: str | None = None
    routing_na_walking_travel_mode: str | None = None
    routing_max_features: int = Field(default=250_000, ge=1)
    routing_max_distance_km: float = Field(default=100.0, gt=0)
    routing_max_snap_meters: float = Field(default=500.0, gt=0)
    routing_max_expansions: int = Field(default=2_000_000, ge=1000)
    routing_graph_ttl_seconds: int = Field(default=3600, ge=60)
    routing_driving_speeds_kmh: dict[str, float] = Field(
        default_factory=lambda: dict(DEFAULT_DRIVING_SPEEDS_KMH)
    )
    routing_driving_default_speed_kmh: float = Field(default=30.0, gt=0)
    routing_driving_max_speed_kmh: float = Field(default=110.0, gt=0)
    routing_walking_speed_kmh: float = Field(default=5.0, gt=0)
    routing_driving_excluded_classes: CommaList = Field(
        default_factory=lambda: list(DEFAULT_DRIVING_EXCLUDED_CLASSES)
    )
    routing_walking_excluded_classes: CommaList = Field(
        default_factory=lambda: list(DEFAULT_WALKING_EXCLUDED_CLASSES)
    )

    @field_validator(
        "arcgis_geocode_server",
        "arcgis_route_service",
        "arcgis_client_id",
        "arcgis_username",
        "arcgis_token_url",
        "client_ip_header",
        "arcgis_token_referer",
        "routing_na_driving_travel_mode",
        "routing_na_walking_travel_mode",
        "arcgis_geocoding_feature_server",
        "arcgis_reverse_geocoding_feature_server",
        "arcgis_routing_feature_server",
        "arcgis_places_alt_name_field",
        "arcgis_places_address_field",
        "arcgis_places_type_field",
        "arcgis_places_importance_field",
        "arcgis_addresses_formatted_field",
        "arcgis_addresses_name_field",
        "arcgis_addresses_street_field",
        "arcgis_addresses_house_number_field",
        "arcgis_addresses_district_field",
        "arcgis_addresses_city_field",
        "arcgis_addresses_country_field",
        "arcgis_roads_name_field",
        "arcgis_roads_class_field",
        "arcgis_roads_oneway_field",
        "arcgis_roads_speed_field",
        "address_default_city",
        "address_default_country",
        mode="before",
    )
    @classmethod
    def _empty_string_is_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value.strip().rstrip("/") if isinstance(value, str) and value.startswith("http") else value

    @field_validator("arcgis_token", "arcgis_password", "arcgis_client_secret", "site_api_key", mode="before")
    @classmethod
    def _empty_secret_is_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator(
        "cors_origins",
        "arcgis_oneway_forward_values",
        "arcgis_oneway_reverse_values",
        "routing_driving_excluded_classes",
        "routing_walking_excluded_classes",
        "reverse_geocode_radii_meters",
        mode="before",
    )
    @classmethod
    def _split_comma_list(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("reverse_geocode_radii_meters")
    @classmethod
    def _validate_radii(cls, value: list[str]) -> list[str]:
        radii = [float(item) for item in value]
        if not radii or any(r <= 0 for r in radii) or radii != sorted(radii):
            raise ValueError("REVERSE_GEOCODE_RADII_METERS must be positive and ascending")
        return value

    def _upstream_problems(self) -> list[str]:
        production = self.environment is Environment.PRODUCTION
        problems: list[str] = []
        upstreams = {
            "CONVEX_SITE_URL": self.convex_site_url,
            "ARCGIS_GEOCODE_SERVER": self.arcgis_geocode_server,
            "ARCGIS_ROUTE_SERVICE": self.arcgis_route_service,
            "ARCGIS_GEOCODING_FEATURE_SERVER": self.arcgis_geocoding_feature_server,
            "ARCGIS_REVERSE_GEOCODING_FEATURE_SERVER": self.arcgis_reverse_geocoding_feature_server,
            "ARCGIS_ROUTING_FEATURE_SERVER": self.arcgis_routing_feature_server,
            "ARCGIS_TOKEN_URL": self.arcgis_token_url,
        }
        for name, url in upstreams.items():
            if url:
                problems += check_upstream_url(
                    name, url, production=production, allow_http=self.allow_http_upstreams
                )
        return problems

    @model_validator(mode="after")
    def _production_guard(self) -> Settings:
        """Refuses unsafe configuration: bad upstream URLs in any environment,
        and in production anything that is only acceptable for development.
        All problems are reported at once."""
        problems = self._upstream_problems()
        if self.environment is not Environment.PRODUCTION:
            if problems:
                raise ValueError("Invalid configuration: " + "; ".join(problems))
            return self
        if "*" in self.cors_origins:
            problems.append("CORS_ORIGINS must list the allowed origins explicitly (not *)")
        for origin in self.cors_origins:
            if origin != "*" and not origin.startswith("https://"):
                problems.append(f"CORS_ORIGINS entry {origin!r} must be an https origin")
        if not self.public_api_url.startswith("https://"):
            problems.append("PUBLIC_API_URL must be an https URL")
        if self.api_key_pepper.get_secret_value() == self.gateway_secret.get_secret_value():
            problems.append("API_KEY_PEPPER and GATEWAY_SECRET must be different")
        secrets = {
            "API_KEY_PEPPER": (self.api_key_pepper, DEV_API_KEY_PEPPER),
            "GATEWAY_SECRET": (self.gateway_secret, DEV_GATEWAY_SECRET),
        }
        for name, (secret, dev_default) in secrets.items():
            value = secret.get_secret_value()
            if value == dev_default or value.startswith("dev-only") or value == "change-me":
                problems.append(f"{name} still uses a development default")
            elif len(value) < MIN_SECRET_LENGTH:
                problems.append(f"{name} must be at least {MIN_SECRET_LENGTH} characters")
        if self.site_api_key is not None and "DevOnly" in self.site_api_key.get_secret_value():
            problems.append("SITE_API_KEY still uses a development default")
        if problems:
            raise ValueError("Refusing to start in production: " + "; ".join(problems))
        return self

    # --- Derived values --------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment is Environment.PRODUCTION

    @property
    def docs_enabled(self) -> bool:
        return self.api_docs_enabled if self.api_docs_enabled is not None else not self.is_production

    @property
    def reverse_geocode_radii(self) -> list[float]:
        return [float(item) for item in self.reverse_geocode_radii_meters]


@lru_cache
def get_settings() -> Settings:
    return Settings()
