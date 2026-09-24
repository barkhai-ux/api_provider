"""Small geodesy helpers (WGS84 longitude/latitude in degrees, distances in meters)."""

from __future__ import annotations

import math
from itertools import pairwise

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_DEGREE_LAT = 111_320.0


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def project_onto_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float, float, float]:
    """Project point P onto segment AB using a local equirectangular plane.

    Returns ``(t, x, y, distance_m)`` where ``t`` in [0, 1] is the fraction along
    AB, ``(x, y)`` is the projected lon/lat and ``distance_m`` the distance from P.
    Accurate to well under a meter for segments up to a few kilometers.
    """
    scale_x = math.cos(math.radians(py))
    dx = (bx - ax) * scale_x
    dy = by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        t = 0.0
    else:
        t = ((px - ax) * scale_x * dx + (py - ay) * dy) / length_sq
        t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
    x = ax + (bx - ax) * t
    y = ay + (by - ay) * t
    return t, x, y, haversine_m(px, py, x, y)


def distance_to_polyline_m(px: float, py: float, path: list[tuple[float, float]]) -> float:
    if len(path) == 1:
        return haversine_m(px, py, path[0][0], path[0][1])
    best = math.inf
    for (ax, ay), (bx, by) in pairwise(path):
        best = min(best, project_onto_segment(px, py, ax, ay, bx, by)[3])
    return best


def buffer_envelope(lon: float, lat: float, meters: float) -> tuple[float, float, float, float]:
    """Axis-aligned envelope (xmin, ymin, xmax, ymax) around a point."""
    d_lat = meters / METERS_PER_DEGREE_LAT
    d_lon = meters / (METERS_PER_DEGREE_LAT * max(0.01, math.cos(math.radians(lat))))
    return lon - d_lon, lat - d_lat, lon + d_lon, lat + d_lat
