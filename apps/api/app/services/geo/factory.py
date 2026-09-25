"""Composition root for geo services: picks provider implementations from config.

This is the single place that knows ArcGIS is the data source. To swap it out,
build different providers here; nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import Settings
from app.services.arcgis.auth import (
    GenerateTokenProvider,
    OAuthClientCredentialsProvider,
    StaticTokenProvider,
    TokenProvider,
    token_url_for,
)
from app.services.arcgis.client import ArcGISFeatureServerClient, resolve_layer_url
from app.services.arcgis.locator import (
    ArcGISLocatorGeocodingProvider,
    ArcGISLocatorReverseGeocodingProvider,
    LocatorConfig,
)
from app.services.arcgis.network_analyst import ArcGISNetworkAnalystRoutingProvider, NetworkAnalystConfig
from app.services.arcgis.providers import (
    AddressFieldMap,
    ArcGISGeocodingProvider,
    ArcGISReverseGeocodingProvider,
    ArcGISRoadNetworkRoutingProvider,
    PlacesFieldMap,
    ReverseLayers,
    RoadsFieldMap,
    RoutingLimits,
    build_travel_profiles,
)
from app.services.cache import TTLCache
from app.services.geo.base import (
    AddressMatch,
    Coordinate,
    GeocodingProvider,
    GeoServiceUnavailable,
    Place,
    ReverseGeocodingProvider,
    RouteResult,
    RoutingProvider,
)
from app.services.geo.geocoding import GeocodingService
from app.services.geo.routing import RoutingService


class UnconfiguredProvider:
    """Used when a data source URL is missing: every call answers 503."""

    def __init__(self, service: str) -> None:
        self._message = f"The {service} data source is not configured."

    async def search(self, text: str, limit: int) -> list[Place]:
        raise GeoServiceUnavailable(self._message)

    async def reverse(self, point: Coordinate) -> AddressMatch | None:
        raise GeoServiceUnavailable(self._message)

    async def route(self, origin: Coordinate, destination: Coordinate, mode: str) -> RouteResult:
        raise GeoServiceUnavailable(self._message)

    async def warm_up(self) -> None:
        return None


class ChainedReverseGeocodingProvider:
    """Tries each provider in order until one finds a match."""

    def __init__(self, providers: list[ReverseGeocodingProvider]) -> None:
        self._providers = providers

    async def reverse(self, point: Coordinate) -> AddressMatch | None:
        for provider in self._providers:
            match = await provider.reverse(point)
            if match is not None:
                return match
        return None


@dataclass(slots=True)
class GeoServices:
    geocoding: GeocodingService
    routing: RoutingService
    routing_provider: RoutingProvider
    arcgis_client: ArcGISFeatureServerClient
    # Data sources checked by /health/ready: name -> (kind, url).
    data_sources: dict[str, tuple[str, str]]


def build_token_provider(settings: Settings, http: httpx.AsyncClient) -> TokenProvider | None:
    """Precedence: OAuth app credentials, then a service account, then a static token."""
    services = [
        url
        for url in (
            settings.arcgis_route_service,
            settings.arcgis_geocode_server,
            settings.arcgis_geocoding_feature_server,
            settings.arcgis_reverse_geocoding_feature_server,
            settings.arcgis_routing_feature_server,
        )
        if url
    ]

    def token_url(endpoint: str) -> str:
        if settings.arcgis_token_url:
            return settings.arcgis_token_url
        if not services:
            raise ValueError("Set ARCGIS_TOKEN_URL, or an ArcGIS service URL to derive it from")
        return token_url_for(services[0], endpoint)

    if settings.arcgis_client_id and settings.arcgis_client_secret:
        return OAuthClientCredentialsProvider(
            http,
            token_url=token_url("oauth2/token"),
            client_id=settings.arcgis_client_id,
            client_secret=settings.arcgis_client_secret.get_secret_value(),
            referer=settings.arcgis_token_referer,
            expiration_minutes=settings.arcgis_token_expiration_minutes,
            timeout_seconds=settings.arcgis_timeout_seconds,
        )
    if settings.arcgis_username and settings.arcgis_password:
        return GenerateTokenProvider(
            http,
            token_url=token_url("generateToken"),
            username=settings.arcgis_username,
            password=settings.arcgis_password.get_secret_value(),
            referer=settings.arcgis_token_referer,
            expiration_minutes=settings.arcgis_token_expiration_minutes,
            timeout_seconds=settings.arcgis_timeout_seconds,
        )
    if settings.arcgis_token:
        return StaticTokenProvider(settings.arcgis_token.get_secret_value(), settings.arcgis_token_referer)
    return None


def build_geo_services(settings: Settings, http: httpx.AsyncClient) -> GeoServices:
    client = ArcGISFeatureServerClient(
        http,
        token_provider=build_token_provider(settings, http),
        timeout_seconds=settings.arcgis_timeout_seconds,
        max_retries=settings.arcgis_max_retries,
        max_records=settings.arcgis_max_records,
        max_concurrency=settings.arcgis_max_concurrency,
        queue_timeout_seconds=settings.arcgis_queue_timeout_seconds,
        max_response_bytes=settings.arcgis_max_response_bytes,
    )
    places_url = (
        resolve_layer_url(settings.arcgis_geocoding_feature_server)
        if settings.arcgis_geocoding_feature_server
        else None
    )
    addresses_url = (
        resolve_layer_url(settings.arcgis_reverse_geocoding_feature_server)
        if settings.arcgis_reverse_geocoding_feature_server
        else None
    )
    roads_url = (
        resolve_layer_url(settings.arcgis_routing_feature_server)
        if settings.arcgis_routing_feature_server
        else None
    )
    places_fields = PlacesFieldMap(
        name=settings.arcgis_places_name_field,
        alt_name=settings.arcgis_places_alt_name_field,
        address=settings.arcgis_places_address_field,
        type=settings.arcgis_places_type_field,
        importance=settings.arcgis_places_importance_field,
    )
    default_address = ", ".join(
        p for p in (settings.address_default_city, settings.address_default_country) if p
    )

    locator = (
        LocatorConfig(
            url=settings.arcgis_geocode_server.rstrip("/"),
            default_country=settings.address_default_country,
            resolve_concurrency=settings.locator_resolve_concurrency,
        )
        if settings.arcgis_geocode_server
        else None
    )

    geocoding_provider: GeocodingProvider = (
        ArcGISLocatorGeocodingProvider(client, locator)
        if locator
        else ArcGISGeocodingProvider(
            client,
            places_url,
            places_fields,
            candidate_limit=settings.geocode_candidate_limit,
            default_address=default_address or None,
        )
        if places_url
        else UnconfiguredProvider("geocoding")
    )

    feature_reverse: ReverseGeocodingProvider | None = (
        ArcGISReverseGeocodingProvider(
            client,
            ReverseLayers(addresses_url=addresses_url, places_url=places_url, roads_url=roads_url),
            AddressFieldMap(
                formatted=settings.arcgis_addresses_formatted_field,
                name=settings.arcgis_addresses_name_field,
                street=settings.arcgis_addresses_street_field,
                house_number=settings.arcgis_addresses_house_number_field,
                district=settings.arcgis_addresses_district_field,
                city=settings.arcgis_addresses_city_field,
                country=settings.arcgis_addresses_country_field,
            ),
            places_fields,
            settings.arcgis_roads_name_field,
            radii_m=settings.reverse_geocode_radii,
            default_city=settings.address_default_city,
            default_country=settings.address_default_country,
        )
        if addresses_url or places_url or roads_url
        else None
    )
    reverse_chain: list[ReverseGeocodingProvider] = []
    if locator:
        reverse_chain.append(
            ArcGISLocatorReverseGeocodingProvider(client, locator, radii_m=settings.reverse_geocode_radii)
        )
    if feature_reverse:
        reverse_chain.append(feature_reverse)
    reverse_provider: ReverseGeocodingProvider
    if len(reverse_chain) > 1:
        reverse_provider = ChainedReverseGeocodingProvider(reverse_chain)
    elif reverse_chain:
        reverse_provider = reverse_chain[0]
    else:
        reverse_provider = UnconfiguredProvider("reverse geocoding")

    profiles = build_travel_profiles(
        driving_speeds=settings.routing_driving_speeds_kmh,
        driving_default_speed=settings.routing_driving_default_speed_kmh,
        driving_max_speed=settings.routing_driving_max_speed_kmh,
        driving_excluded=settings.routing_driving_excluded_classes,
        walking_speed=settings.routing_walking_speed_kmh,
        walking_excluded=settings.routing_walking_excluded_classes,
        use_data_speed=settings.arcgis_roads_speed_field is not None,
    )
    route_service = settings.arcgis_route_service.rstrip("/") if settings.arcgis_route_service else None
    use_network_analyst = settings.routing_provider == "arcgis_network_analyst" or (
        settings.routing_provider == "auto" and route_service is not None
    )
    road_network: RoutingProvider = (
        ArcGISRoadNetworkRoutingProvider(
            client,
            roads_url,
            RoadsFieldMap(
                name=settings.arcgis_roads_name_field,
                road_class=settings.arcgis_roads_class_field,
                oneway=settings.arcgis_roads_oneway_field,
                speed=settings.arcgis_roads_speed_field,
                oneway_forward=frozenset(v.lower() for v in settings.arcgis_oneway_forward_values)
                | frozenset(settings.arcgis_oneway_forward_values),
                oneway_reverse=frozenset(v.lower() for v in settings.arcgis_oneway_reverse_values)
                | frozenset(settings.arcgis_oneway_reverse_values),
            ),
            profiles,
            RoutingLimits(
                max_features=settings.routing_max_features,
                max_snap_m=settings.routing_max_snap_meters,
                max_expansions=settings.routing_max_expansions,
                graph_ttl_s=settings.routing_graph_ttl_seconds,
            ),
        )
        if roads_url
        else UnconfiguredProvider("routing")
    )
    routing_provider: RoutingProvider
    if use_network_analyst and route_service:
        routing_provider = ArcGISNetworkAnalystRoutingProvider(
            client,
            NetworkAnalystConfig(
                url=route_service,
                travel_mode_names={
                    mode: name
                    for mode, name in (
                        ("driving", settings.routing_na_driving_travel_mode),
                        ("walking", settings.routing_na_walking_travel_mode),
                    )
                    if name
                },
            ),
        )
    elif use_network_analyst:
        routing_provider = UnconfiguredProvider("routing")
    else:
        routing_provider = road_network

    data_sources: dict[str, tuple[str, str]] = {}
    if locator:
        data_sources["geocoding"] = ("locator", locator.url)
        data_sources["reverse_geocoding"] = ("locator", locator.url)
    else:
        if places_url:
            data_sources["geocoding"] = ("layer", places_url)
        if addresses_url:
            data_sources["reverse_geocoding"] = ("layer", addresses_url)
    if use_network_analyst and route_service:
        data_sources["routing"] = ("service", route_service)
    elif roads_url:
        data_sources["routing"] = ("layer", roads_url)
    return GeoServices(
        geocoding=GeocodingService(
            geocoding_provider,
            reverse_provider,
            TTLCache(settings.cache_geocode_ttl_seconds, settings.cache_geocode_max_entries),
        ),
        routing=RoutingService(routing_provider, settings.routing_max_distance_km),
        routing_provider=routing_provider,
        arcgis_client=client,
        data_sources=data_sources,
    )
