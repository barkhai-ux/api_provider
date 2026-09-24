"""Conversion of Esri JSON geometries (already in WGS84 via ``outSR=4326``)."""

from __future__ import annotations

from typing import Any

from app.services.arcgis.client import ArcGISResponseError

Path = list[tuple[float, float]]


def _position(value: Any) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ArcGISResponseError("Geometry contains an invalid coordinate")
    x, y = value[0], value[1]
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        raise ArcGISResponseError("Geometry contains a non-numeric coordinate")
    return float(x), float(y)


def polyline_paths(geometry: dict[str, Any] | None) -> list[Path]:
    """Esri polyline ``{"paths": [[[x, y], ...], ...]}`` to a list of paths."""
    if not geometry:
        return []
    paths = geometry.get("paths")
    if not isinstance(paths, list):
        raise ArcGISResponseError("Expected a polyline geometry")
    result: list[Path] = []
    for path in paths:
        if not isinstance(path, list):
            raise ArcGISResponseError("Polyline path is not a list")
        coords = [_position(p) for p in path]
        if len(coords) >= 2:
            result.append(coords)
    return result


def _ring_centroid(ring: Path) -> tuple[float, float, float]:
    area = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1], strict=False):
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if area == 0:
        xs, ys = zip(*ring, strict=False)
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (3 * area), cy / (3 * area), abs(area / 2)


def representative_point(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    """A single lon/lat for any geometry type (points, lines, polygons)."""
    if not geometry:
        return None
    if "x" in geometry and "y" in geometry:
        if geometry["x"] is None or geometry["y"] is None:
            return None
        return _position([geometry["x"], geometry["y"]])
    if geometry.get("points"):
        return _position(geometry["points"][0])
    if "paths" in geometry:
        paths = polyline_paths(geometry)
        if not paths:
            return None
        path = paths[0]
        return path[len(path) // 2]
    if "rings" in geometry:
        rings = [[_position(p) for p in ring] for ring in geometry["rings"] if ring]
        if not rings:
            return None
        x, y, _ = max((_ring_centroid(ring) for ring in rings), key=lambda c: c[2])
        return x, y
    raise ArcGISResponseError("Unsupported geometry type")
