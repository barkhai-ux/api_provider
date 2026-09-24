import math

import pytest

from app.services.arcgis.providers import build_travel_profiles
from app.services.geo.road_graph import NoPathError, RoadGraph, RoadSegment

PROFILES = build_travel_profiles(
    driving_speeds={"primary": 60, "residential": 30, "motorway": 90},
    driving_default_speed=30,
    driving_max_speed=110,
    driving_excluded=["footway"],
    walking_speed=5,
    walking_excluded=["motorway"],
    use_data_speed=True,
)


def build(segments: list[RoadSegment]) -> RoadGraph:
    return RoadGraph.build(segments, list(PROFILES.values()))


def route(graph: RoadGraph, mode: str, a: tuple[float, float], b: tuple[float, float]):
    origin = graph.snap(mode, a[0], a[1], 500)
    destination = graph.snap(mode, b[0], b[1], 500)
    assert origin is not None and destination is not None
    return graph.shortest_path(mode, origin, destination, 100_000)


def test_vertices_shared_mid_line_connect_the_graph() -> None:
    # The cross street meets the main street at a vertex in the middle of its polyline.
    graph = build(
        [
            RoadSegment([(0.0, 0.0), (0.001, 0.0), (0.002, 0.0)], "primary"),
            RoadSegment([(0.001, 0.0), (0.001, 0.001)], "residential"),
        ]
    )
    result = route(graph, "driving", (0.0, 0.0), (0.001, 0.001))
    assert result.coordinates[0] == (0.0, 0.0)
    assert result.coordinates[-1] == (0.001, 0.001)
    assert result.distance_m == pytest.approx(111.3 + 110.6, rel=0.02)


def test_prefers_faster_roads() -> None:
    # Two parallel paths from A to B: a direct residential street and a slightly
    # longer primary road; the primary road is faster.
    graph = build(
        [
            RoadSegment([(0.0, 0.0), (0.01, 0.0)], "residential"),
            RoadSegment([(0.0, 0.0), (0.0, 0.0005), (0.01, 0.0005), (0.01, 0.0)], "primary"),
        ]
    )
    result = route(graph, "driving", (0.0, 0.0), (0.01, 0.0))
    assert (0.0, 0.0005) in result.coordinates
    assert result.duration_s < 1113 / (30 / 3.6)


def test_oneway_is_respected_when_driving_but_not_walking() -> None:
    graph = build(
        [
            RoadSegment([(0.0, 0.0), (0.002, 0.0)], "residential", direction="forward"),  # one-way eastbound
            RoadSegment([(0.0, 0.0), (0.0, 0.002), (0.002, 0.002), (0.002, 0.0)], "residential"),  # detour
        ]
    )
    east = route(graph, "driving", (0.0, 0.0), (0.002, 0.0))
    west = route(graph, "driving", (0.002, 0.0), (0.0, 0.0))
    walk_west = route(graph, "walking", (0.002, 0.0), (0.0, 0.0))
    assert east.distance_m == pytest.approx(222.6, rel=0.02)
    assert west.distance_m > 600  # must take the detour
    assert walk_west.distance_m == pytest.approx(222.6, rel=0.02)


def test_reverse_oneway() -> None:
    graph = build([RoadSegment([(0.0, 0.0), (0.002, 0.0)], "residential", direction="reverse")])
    origin = graph.snap("driving", 0.0, 0.0, 50)
    destination = graph.snap("driving", 0.002, 0.0, 50)
    assert origin and destination
    with pytest.raises(NoPathError):
        graph.shortest_path("driving", origin, destination, 1000)
    assert graph.shortest_path("driving", destination, origin, 1000).distance_m > 0


def test_walkers_never_snap_to_excluded_roads() -> None:
    graph = build(
        [
            RoadSegment([(0.0, 0.0), (0.01, 0.0)], "motorway"),
            RoadSegment([(0.0, 0.002), (0.01, 0.002)], "residential"),
        ]
    )
    walking = graph.snap("walking", 0.005, 0.0001, 1000)
    driving = graph.snap("driving", 0.005, 0.0001, 1000)
    assert walking is not None and walking.latitude == pytest.approx(0.002)
    assert driving is not None and driving.latitude == pytest.approx(0.0)


def test_snapping_ignores_small_disconnected_islands() -> None:
    graph = build(
        [
            RoadSegment([(0.0, 0.0), (0.01, 0.0)], "residential"),
            RoadSegment([(0.01, 0.0), (0.01, 0.01)], "residential"),
            RoadSegment([(0.005, 0.0003), (0.0051, 0.0003)], "residential"),  # isolated parking aisle
        ]
    )
    snap = graph.snap("driving", 0.00505, 0.0003, 500)
    assert snap is not None and snap.latitude == pytest.approx(0.0)


def test_snap_distance_limit() -> None:
    graph = build([RoadSegment([(0.0, 0.0), (0.01, 0.0)], "residential")])
    assert graph.snap("driving", 0.005, 0.01, 200) is None


def test_origin_and_destination_on_the_same_segment() -> None:
    graph = build([RoadSegment([(0.0, 0.0), (0.01, 0.0)], "residential")])
    result = route(graph, "driving", (0.002, 0.0), (0.006, 0.0))
    assert result.distance_m == pytest.approx(445.3, rel=0.02)
    assert len(result.coordinates) == 2


def test_identical_points_give_a_zero_length_route() -> None:
    graph = build([RoadSegment([(0.0, 0.0), (0.01, 0.0)], "residential")])
    result = route(graph, "driving", (0.004, 0.0), (0.004, 0.0))
    assert result.distance_m == 0
    assert result.duration_s == 0


def test_expansion_limit() -> None:
    segments = [RoadSegment([(i * 0.001, 0.0), ((i + 1) * 0.001, 0.0)], "residential") for i in range(50)]
    graph = build(segments)
    origin = graph.snap("driving", 0.0, 0.0, 10)
    destination = graph.snap("driving", 0.05, 0.0, 10)
    assert origin and destination
    with pytest.raises(NoPathError) as caught:
        graph.shortest_path("driving", origin, destination, 5)
    assert caught.value.reason == "search_limit"


def test_data_speeds_are_clamped_to_profile_maximum() -> None:
    graph = build([RoadSegment([(0.0, 0.0), (0.01, 0.0)], "primary", speed_kmh=500)])
    result = route(graph, "driving", (0.0, 0.0), (0.01, 0.0))
    assert result.duration_s == pytest.approx(result.distance_m / (110 / 3.6), rel=0.01)
    assert math.isfinite(result.duration_s)
