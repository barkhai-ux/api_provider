from __future__ import annotations

import httpx
import pytest
import respx

from app.services.geo.base import Coordinate
from app.services.osm.providers import NominatimProvider, OSRMProvider


@pytest.mark.asyncio
async def test_nominatim_search_maps_places() -> None:
    with respx.mock(assert_all_called=True) as router:
        route = router.get("http://nominatim:8080/search").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "osm_type": "node",
                        "osm_id": 42,
                        "lat": "47.9184",
                        "lon": "106.9177",
                        "name": "Sukhbaatar Square",
                        "display_name": "Sukhbaatar Square, Ulaanbaatar, Mongolia",
                        "type": "square",
                        "importance": 0.8,
                    }
                ],
            )
        )
        async with httpx.AsyncClient() as http:
            provider = NominatimProvider(http, "http://nominatim:8080")
            places = await provider.search("Sukhbaatar Square", 5)

    assert route.calls[0].request.url.params["countrycodes"] == "mn"
    assert places[0].id == "osm_node_42"
    assert places[0].location == Coordinate(longitude=106.9177, latitude=47.9184)


@pytest.mark.asyncio
async def test_nominatim_reverse_maps_address_parts() -> None:
    with respx.mock(assert_all_called=True) as router:
        router.get("http://nominatim:8080/reverse").mock(
            return_value=httpx.Response(
                200,
                json={
                    "lat": "47.9184",
                    "lon": "106.9177",
                    "display_name": "Peace Avenue, Ulaanbaatar, Mongolia",
                    "address": {"road": "Peace Avenue", "city": "Ulaanbaatar", "country": "Mongolia"},
                },
            )
        )
        async with httpx.AsyncClient() as http:
            provider = NominatimProvider(http, "http://nominatim:8080")
            match = await provider.reverse(Coordinate(longitude=106.9177, latitude=47.9184))

    assert match is not None
    assert match.street == "Peace Avenue"
    assert match.city == "Ulaanbaatar"


@pytest.mark.asyncio
async def test_osrm_route_maps_geometry_and_snapped_waypoints() -> None:
    with respx.mock(assert_all_called=True) as router:
        route = router.get("http://osrm-driving:5000/route/v1/driving/106.9,47.9;106.91,47.91").mock(
            return_value=httpx.Response(
                200,
                json={
                    "code": "Ok",
                    "routes": [
                        {
                            "distance": 1600.0,
                            "duration": 300.0,
                            "geometry": {"coordinates": [[106.9, 47.9], [106.91, 47.91]]},
                        }
                    ],
                    "waypoints": [
                        {"location": [106.9001, 47.9001], "distance": 12.0, "name": "Peace Avenue"},
                        {"location": [106.9099, 47.9099], "distance": 15.0, "name": "Baga Toiruu"},
                    ],
                },
            )
        )
        async with httpx.AsyncClient() as http:
            provider = OSRMProvider(http, "http://osrm-driving:5000", "http://osrm-walking:5001")
            result = await provider.route(
                Coordinate(longitude=106.9, latitude=47.9),
                Coordinate(longitude=106.91, latitude=47.91),
                "driving",
            )

    assert route.called
    assert result.distance_meters == 1600
    assert result.origin.road_name == "Peace Avenue"
    assert result.coordinates[-1] == (106.91, 47.91)
