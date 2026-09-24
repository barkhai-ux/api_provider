"""In-memory road network graph and A* shortest-path search.

This module is independent of ArcGIS: it takes plain road segments (lon/lat
paths plus class, direction, speed and name) and answers routing queries.

Design notes
- Every vertex is a node. Vertices are keyed by coordinates rounded to 1e-6
  degrees (about 0.1 m), so junctions in the middle of a polyline and float noise
  from reprojection still connect.
- Consecutive vertices form a *link*. Links are stored in flat arrays and the
  adjacency is a CSR structure, which keeps memory to tens of bytes per link.
- Each travel profile (driving, walking, ...) gets its own per-link cost array
  and its own largest-connected-component mask. Origins and destinations only
  snap to links that the profile may use and that are in that component, so a
  walker never snaps to a motorway and a car never snaps to an isolated
  parking aisle.
- Snapping projects onto the nearest link and starts or ends the search part
  way along it; the graph is never mutated, so one graph serves concurrent
  requests from worker threads.
- The A* heuristic is straight-line distance divided by the profile's top
  speed. Speeds from the data are clamped to that top speed, which keeps the
  heuristic admissible and the result optimal.
"""

from __future__ import annotations

import heapq
import math
from array import array
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.services.geo.geodesy import buffer_envelope, haversine_m, project_onto_segment

Direction = Literal["both", "forward", "reverse"]
_DIR_CODE: dict[str, int] = {"both": 0, "forward": 1, "reverse": 2}
COORDINATE_PRECISION = 1_000_000
DEFAULT_GRID_CELL_DEG = 0.005


@dataclass(frozen=True, slots=True)
class RoadSegment:
    coordinates: Sequence[tuple[float, float]]
    road_class: str | None = None
    direction: Direction = "both"
    speed_kmh: float | None = None
    name: str | None = None


@dataclass(frozen=True, slots=True)
class TravelProfile:
    mode: str
    excluded_classes: frozenset[str]
    respects_oneway: bool
    default_speed_kmh: float
    max_speed_kmh: float
    class_speeds_kmh: Mapping[str, float] | None = None
    use_data_speed: bool = False

    def speed_kmh(self, road_class: str | None, data_speed: float | None) -> float:
        if self.use_data_speed and data_speed and data_speed > 0:
            speed = data_speed
        elif self.class_speeds_kmh and road_class is not None and road_class in self.class_speeds_kmh:
            speed = self.class_speeds_kmh[road_class]
        else:
            speed = self.default_speed_kmh
        return min(max(speed, 1.0), self.max_speed_kmh)

    def allows_class(self, road_class: str | None) -> bool:
        return road_class not in self.excluded_classes


@dataclass(frozen=True, slots=True)
class Snap:
    link: int
    fraction: float
    longitude: float
    latitude: float
    distance_m: float


@dataclass(frozen=True, slots=True)
class PathResult:
    coordinates: list[tuple[float, float]]
    distance_m: float
    duration_s: float


class NoPathError(Exception):
    def __init__(self, reason: Literal["no_path", "search_limit"]) -> None:
        super().__init__(reason)
        self.reason = reason


class _ProfileData:
    __slots__ = ("in_main_component", "link_cost", "max_speed_mps", "profile")

    def __init__(self, profile: TravelProfile, link_cost: array[float], in_main_component: bytearray) -> None:
        self.profile = profile
        self.link_cost = link_cost
        self.in_main_component = in_main_component
        self.max_speed_mps = profile.max_speed_kmh / 3.6


class RoadGraph:
    """Immutable after ``build``; safe to query from several threads."""

    def __init__(self) -> None:
        self.node_lon: array[float] = array("d")
        self.node_lat: array[float] = array("d")
        self.link_u: array[int] = array("q")
        self.link_v: array[int] = array("q")
        self.link_length: array[float] = array("d")
        self.link_dir: array[int] = array("b")
        self.link_name: array[int] = array("l")
        self.names: list[str] = []
        self.arc_offsets: array[int] = array("q")
        self.arc_link: array[int] = array("q")
        self.arc_forward = bytearray()
        self.grid: dict[tuple[int, int], list[int]] = {}
        self.grid_cell_deg = DEFAULT_GRID_CELL_DEG
        self.profiles: dict[str, _ProfileData] = {}

    @property
    def node_count(self) -> int:
        return len(self.node_lon)

    @property
    def link_count(self) -> int:
        return len(self.link_u)

    # --- Construction -------------------------------------------------------------

    @classmethod
    def build(
        cls,
        segments: Sequence[RoadSegment],
        profiles: Sequence[TravelProfile],
        grid_cell_deg: float = DEFAULT_GRID_CELL_DEG,
    ) -> RoadGraph:
        graph = cls()
        graph.grid_cell_deg = grid_cell_deg
        node_index: dict[tuple[int, int], int] = {}
        name_index: dict[str, int] = {}
        link_class: list[str | None] = []
        link_speed: list[float | None] = []

        def node_for(lon: float, lat: float) -> int:
            key = (round(lon * COORDINATE_PRECISION), round(lat * COORDINATE_PRECISION))
            node = node_index.get(key)
            if node is None:
                node = len(graph.node_lon)
                node_index[key] = node
                graph.node_lon.append(lon)
                graph.node_lat.append(lat)
            return node

        for segment in segments:
            name_id = -1
            if segment.name:
                name_id = name_index.setdefault(segment.name, len(name_index))
            direction = _DIR_CODE[segment.direction]
            previous: int | None = None
            for lon, lat in segment.coordinates:
                node = node_for(lon, lat)
                if previous is not None and node != previous:
                    graph.link_u.append(previous)
                    graph.link_v.append(node)
                    graph.link_length.append(
                        haversine_m(
                            graph.node_lon[previous],
                            graph.node_lat[previous],
                            graph.node_lon[node],
                            graph.node_lat[node],
                        )
                    )
                    graph.link_dir.append(direction)
                    graph.link_name.append(name_id)
                    link_class.append(segment.road_class)
                    link_speed.append(segment.speed_kmh)
                previous = node

        graph.names = [""] * len(name_index)
        for name, idx in name_index.items():
            graph.names[idx] = name

        graph._build_adjacency()
        graph._build_grid()
        for profile in profiles:
            graph.profiles[profile.mode] = graph._build_profile(profile, link_class, link_speed)
        return graph

    def _build_adjacency(self) -> None:
        n = self.node_count
        degree = array("q", [0]) * (n + 1)
        for u, v in zip(self.link_u, self.link_v, strict=True):
            degree[u + 1] += 1
            degree[v + 1] += 1
        for i in range(1, n + 1):
            degree[i] += degree[i - 1]
        self.arc_offsets = degree
        cursor = array("q", degree[:n])
        total = degree[n]
        self.arc_link = array("q", [0]) * total
        self.arc_forward = bytearray(total)
        for link, (u, v) in enumerate(zip(self.link_u, self.link_v, strict=True)):
            slot = cursor[u]
            self.arc_link[slot] = link
            self.arc_forward[slot] = 1
            cursor[u] += 1
            slot = cursor[v]
            self.arc_link[slot] = link
            self.arc_forward[slot] = 0
            cursor[v] += 1

    def _build_grid(self) -> None:
        cell = self.grid_cell_deg
        for link, (u, v) in enumerate(zip(self.link_u, self.link_v, strict=True)):
            x0, x1 = sorted((self.node_lon[u], self.node_lon[v]))
            y0, y1 = sorted((self.node_lat[u], self.node_lat[v]))
            for cx in range(math.floor(x0 / cell), math.floor(x1 / cell) + 1):
                for cy in range(math.floor(y0 / cell), math.floor(y1 / cell) + 1):
                    self.grid.setdefault((cx, cy), []).append(link)

    def _build_profile(
        self, profile: TravelProfile, link_class: list[str | None], link_speed: list[float | None]
    ) -> _ProfileData:
        costs = array("d", [math.inf]) * self.link_count
        # Union-find over the links this profile may use (direction ignored), to
        # find the largest weakly connected component.
        parent = list(range(self.node_count))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for link in range(self.link_count):
            road_class = link_class[link]
            if not profile.allows_class(road_class):
                continue
            speed_mps = profile.speed_kmh(road_class, link_speed[link]) / 3.6
            costs[link] = self.link_length[link] / speed_mps
            ru, rv = find(self.link_u[link]), find(self.link_v[link])
            if ru != rv:
                parent[ru] = rv

        sizes: dict[int, int] = {}
        for link in range(self.link_count):
            if costs[link] != math.inf:
                root = find(self.link_u[link])
                sizes[root] = sizes.get(root, 0) + 1
        in_main = bytearray(self.node_count)
        if sizes:
            main_root = max(sizes, key=lambda r: sizes[r])
            for node in range(self.node_count):
                if find(node) == main_root:
                    in_main[node] = 1
        return _ProfileData(profile, costs, in_main)

    # --- Queries ------------------------------------------------------------------

    def snap(self, mode: str, lon: float, lat: float, max_distance_m: float) -> Snap | None:
        data = self.profiles[mode]
        cell = self.grid_cell_deg
        xmin, ymin, xmax, ymax = buffer_envelope(lon, lat, max_distance_m)
        best: Snap | None = None
        seen: set[int] = set()
        for cx in range(math.floor(xmin / cell), math.floor(xmax / cell) + 1):
            for cy in range(math.floor(ymin / cell), math.floor(ymax / cell) + 1):
                for link in self.grid.get((cx, cy), ()):
                    if link in seen:
                        continue
                    seen.add(link)
                    if data.link_cost[link] == math.inf or not data.in_main_component[self.link_u[link]]:
                        continue
                    u, v = self.link_u[link], self.link_v[link]
                    t, x, y, distance = project_onto_segment(
                        lon, lat, self.node_lon[u], self.node_lat[u], self.node_lon[v], self.node_lat[v]
                    )
                    if distance <= max_distance_m and (best is None or distance < best.distance_m):
                        best = Snap(link, t, x, y, distance)
        return best

    def link_name_of(self, link: int) -> str | None:
        idx = self.link_name[link]
        return self.names[idx] if idx >= 0 else None

    def _can_traverse(self, data: _ProfileData, link: int, forward: bool) -> bool:
        if not data.profile.respects_oneway:
            return True
        direction = self.link_dir[link]
        return direction == 0 or (direction == 1 and forward) or (direction == 2 and not forward)

    def shortest_path(self, mode: str, origin: Snap, destination: Snap, max_expansions: int) -> PathResult:
        data = self.profiles[mode]
        costs = data.link_cost
        lon, lat = self.node_lon, self.node_lat
        dest_lon, dest_lat = destination.longitude, destination.latitude
        inv_speed = 1.0 / data.max_speed_mps

        o_link, o_t = origin.link, origin.fraction
        d_link, d_t = destination.link, destination.fraction
        o_cost, d_cost = costs[o_link], costs[d_link]

        best_total = math.inf
        best_goal: int | None = None  # node id, or -1 for "same link, direct"

        # Origin and destination on the same link: travel directly along it.
        if o_link == d_link:
            forward = d_t >= o_t
            if self._can_traverse(data, o_link, forward):
                best_total = abs(d_t - o_t) * o_cost
                best_goal = -1

        # Goal nodes: reach an end of the destination link, then move along it.
        goals: dict[int, float] = {}
        du, dv = self.link_u[d_link], self.link_v[d_link]
        if self._can_traverse(data, d_link, True):
            goals[du] = d_t * d_cost
        if self._can_traverse(data, d_link, False):
            goals[dv] = min(goals.get(dv, math.inf), (1 - d_t) * d_cost)

        g_score: dict[int, float] = {}
        previous: dict[int, tuple[int, int]] = {}  # node -> (previous node or -1, link)
        heap: list[tuple[float, float, int]] = []

        def push_start(node: int, cost: float) -> None:
            if cost < g_score.get(node, math.inf):
                g_score[node] = cost
                previous[node] = (-1, o_link)
                h = haversine_m(lon[node], lat[node], dest_lon, dest_lat) * inv_speed
                heapq.heappush(heap, (cost + h, cost, node))

        ou, ov = self.link_u[o_link], self.link_v[o_link]
        if self._can_traverse(data, o_link, False):
            push_start(ou, o_t * o_cost)
        if self._can_traverse(data, o_link, True):
            push_start(ov, (1 - o_t) * o_cost)

        expansions = 0
        offsets, arc_link, arc_forward = self.arc_offsets, self.arc_link, self.arc_forward
        link_u, link_v = self.link_u, self.link_v
        while heap:
            f, g, node = heapq.heappop(heap)
            if g > g_score.get(node, math.inf):
                continue
            if f >= best_total:
                break
            extra = goals.get(node)
            if extra is not None and g + extra < best_total:
                best_total = g + extra
                best_goal = node
            expansions += 1
            if expansions > max_expansions:
                raise NoPathError("search_limit")
            for slot in range(offsets[node], offsets[node + 1]):
                link = arc_link[slot]
                cost = costs[link]
                if cost == math.inf:
                    continue
                forward = arc_forward[slot] == 1
                if not self._can_traverse(data, link, forward):
                    continue
                neighbor = link_v[link] if forward else link_u[link]
                new_g = g + cost
                if new_g < g_score.get(neighbor, math.inf):
                    g_score[neighbor] = new_g
                    previous[neighbor] = (node, link)
                    h = haversine_m(lon[neighbor], lat[neighbor], dest_lon, dest_lat) * inv_speed
                    heapq.heappush(heap, (new_g + h, new_g, neighbor))

        if best_goal is None:
            raise NoPathError("no_path")

        start = (origin.longitude, origin.latitude)
        end = (destination.longitude, destination.latitude)
        if best_goal == -1:
            distance = abs(d_t - o_t) * self.link_length[o_link]
            return PathResult(_dedupe([start, end]), distance, best_total)

        nodes: list[int] = []
        distance = 0.0
        node = best_goal
        while True:
            nodes.append(node)
            prev_node, link = previous[node]
            if prev_node == -1:
                # Partial length from the origin snap point to this first node.
                fraction = o_t if node == ou else 1 - o_t
                distance += fraction * self.link_length[o_link]
                break
            distance += self.link_length[link]
            node = prev_node
        nodes.reverse()
        # Partial length from the last node to the destination snap point.
        distance += (d_t if best_goal == du else 1 - d_t) * self.link_length[d_link]

        coordinates = [start, *((lon[n], lat[n]) for n in nodes), end]
        return PathResult(_dedupe(coordinates), distance, best_total)


def _dedupe(coordinates: list[tuple[float, float]]) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for lon, lat in coordinates:
        point = (round(lon, 7), round(lat, 7))
        if not result or result[-1] != point:
            result.append(point)
    if len(result) == 1:
        result.append(result[0])
    return result
