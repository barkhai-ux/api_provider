"""ArcGISFeatureServerClient: the only code that speaks the ArcGIS REST protocol.

Responsibilities: build ``/query`` requests, paginate, retry transient failures,
enforce timeouts, detect ArcGIS error bodies (ArcGIS often answers HTTP 200 with
``{"error": {...}}``) and validate responses. It raises ``ArcGISError``
subclasses whose messages never include the service URL, so nothing about the
internal data source can leak into logs or API responses.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import re
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

if TYPE_CHECKING:
    from app.services.arcgis.auth import TokenProvider

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
ARCGIS_TOKEN_ERROR_CODES = frozenset({498, 499})
WGS84 = 4326
# Queries carrying a geometry or a long WHERE clause are sent as POST forms,
# which ArcGIS accepts on /query and which avoids URL length limits.
MAX_GET_QUERY_LENGTH = 1800
_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


# --- Errors ------------------------------------------------------------------------


class ArcGISError(Exception):
    """Base class. Messages are safe to log: they never contain URLs or tokens."""


class ArcGISNotConfiguredError(ArcGISError):
    pass


class ArcGISTimeoutError(ArcGISError):
    pass


class ArcGISUnavailableError(ArcGISError):
    """Connection failures or retryable HTTP statuses after all retries."""


class ArcGISResponseError(ArcGISError):
    """ArcGIS answered with an error body, a non-JSON body or an unexpected shape."""

    def __init__(
        self, message: str, arcgis_code: int | None = None, details: list[str] | None = None
    ) -> None:
        super().__init__(message)
        self.arcgis_code = arcgis_code
        # ArcGIS "details" strings (never contain the service URL).
        self.details = details or []


class ArcGISAuthError(ArcGISResponseError):
    """Token missing, invalid or expired (ArcGIS codes 498/499)."""


# --- Response models ---------------------------------------------------------------


class EsriFeature(BaseModel):
    model_config = ConfigDict(extra="ignore")

    attributes: dict[str, Any] = Field(default_factory=dict)
    geometry: dict[str, Any] | None = None


class EsriFeatureSet(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    features: list[EsriFeature] = Field(default_factory=list)
    exceeded_transfer_limit: bool = Field(default=False, alias="exceededTransferLimit")
    object_id_field_name: str | None = Field(default=None, alias="objectIdFieldName")
    geometry_type: str | None = Field(default=None, alias="geometryType")


class _EsriCount(BaseModel):
    count: int


class _EsriField(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    type: str


class _EsriLayer(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    name: str | None = None
    type: str | None = None
    geometry_type: str | None = Field(default=None, alias="geometryType")
    object_id_field: str | None = Field(default=None, alias="objectIdField")
    max_record_count: int = Field(default=1000, alias="maxRecordCount")
    fields: list[_EsriField] = Field(default_factory=list)
    advanced_query_capabilities: dict[str, Any] = Field(
        default_factory=dict, alias="advancedQueryCapabilities"
    )


@dataclass(frozen=True, slots=True)
class LayerInfo:
    object_id_field: str
    max_record_count: int
    geometry_type: str | None
    field_names: frozenset[str]
    supports_pagination: bool


# --- Geometry filters --------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PointFilter:
    """Features within ``distance_m`` meters of a WGS84 point."""

    longitude: float
    latitude: float
    distance_m: float

    def params(self) -> dict[str, str]:
        return {
            "geometry": json.dumps(
                {"x": self.longitude, "y": self.latitude, "spatialReference": {"wkid": WGS84}}
            ),
            "geometryType": "esriGeometryPoint",
            "inSR": str(WGS84),
            "spatialRel": "esriSpatialRelIntersects",
            "distance": f"{self.distance_m:.2f}",
            "units": "esriSRUnit_Meter",
        }


@dataclass(frozen=True, slots=True)
class EnvelopeFilter:
    xmin: float
    ymin: float
    xmax: float
    ymax: float

    def params(self) -> dict[str, str]:
        return {
            "geometry": json.dumps(
                {
                    "xmin": self.xmin,
                    "ymin": self.ymin,
                    "xmax": self.xmax,
                    "ymax": self.ymax,
                    "spatialReference": {"wkid": WGS84},
                }
            ),
            "geometryType": "esriGeometryEnvelope",
            "inSR": str(WGS84),
            "spatialRel": "esriSpatialRelIntersects",
        }


GeometryFilter = PointFilter | EnvelopeFilter


def resolve_layer_url(url: str) -> str:
    """Accept either a layer URL (``.../FeatureServer/3``) or a service URL
    (``.../FeatureServer``, which means layer 0)."""
    url = url.rstrip("/")
    return f"{url}/0" if url.lower().endswith("/featureserver") else url


def validate_field_name(name: str) -> str:
    if not _FIELD_NAME.fullmatch(name):
        raise ValueError(f"Invalid ArcGIS field name: {name!r}")
    return name


# --- Client --------------------------------------------------------------------------


class ArcGISFeatureServerClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        token: str | None = None,
        token_provider: TokenProvider | None = None,
        timeout_seconds: float = 8.0,
        max_retries: int = 2,
        max_records: int = 250_000,
        backoff_base_seconds: float = 0.2,
        max_concurrency: int = 16,
        queue_timeout_seconds: float = 5.0,
        max_response_bytes: int = 32 * 1024 * 1024,
    ) -> None:
        self._http = http
        self._token = token
        self._token_provider = token_provider
        self._timeout = timeout_seconds
        self._max_retries = max_retries
        self._max_records = max_records
        self._backoff_base = backoff_base_seconds
        # One budget for all upstream calls, so a burst of expensive requests
        # queues briefly and then fails fast instead of piling up connections.
        self._slots = asyncio.Semaphore(max_concurrency)
        self._queue_timeout = queue_timeout_seconds
        self._max_response_bytes = max_response_bytes
        self._layer_cache: dict[str, LayerInfo] = {}
        self._layer_locks: dict[str, asyncio.Lock] = {}

    # -- Metadata --------------------------------------------------------------------

    async def layer_info(self, layer_url: str) -> LayerInfo:
        cached = self._layer_cache.get(layer_url)
        if cached is not None:
            return cached
        lock = self._layer_locks.setdefault(layer_url, asyncio.Lock())
        async with lock:
            cached = self._layer_cache.get(layer_url)
            if cached is not None:
                return cached
            payload = await self._request(layer_url, {"f": "json"})
            try:
                layer = _EsriLayer.model_validate(payload)
            except ValidationError as exc:
                raise ArcGISResponseError("Layer metadata has an unexpected shape") from exc
            oid_field = layer.object_id_field or next(
                (f.name for f in layer.fields if f.type == "esriFieldTypeOID"), None
            )
            if oid_field is None:
                raise ArcGISResponseError("Layer metadata does not declare an OBJECTID field")
            info = LayerInfo(
                object_id_field=oid_field,
                max_record_count=max(1, layer.max_record_count),
                geometry_type=layer.geometry_type,
                field_names=frozenset(f.name for f in layer.fields),
                supports_pagination=bool(layer.advanced_query_capabilities.get("supportsPagination", False)),
            )
            self._layer_cache[layer_url] = info
            return info

    # -- Queries -----------------------------------------------------------------------

    async def query(
        self,
        layer_url: str,
        *,
        where: str = "1=1",
        out_fields: Sequence[str] = ("*",),
        geometry: GeometryFilter | None = None,
        return_geometry: bool = True,
        order_by: str | None = None,
        record_count: int | None = None,
    ) -> EsriFeatureSet:
        """Run one ``/query`` request and return a single page of features."""
        params = self._query_params(where, out_fields, geometry, return_geometry)
        if order_by:
            params["orderByFields"] = order_by
        if record_count is not None:
            info = await self.layer_info(layer_url)
            if info.supports_pagination:
                params["resultRecordCount"] = str(min(record_count, info.max_record_count))
        payload = await self._request(f"{layer_url}/query", params)
        return self._parse_feature_set(payload)

    async def query_all(
        self,
        layer_url: str,
        *,
        where: str = "1=1",
        out_fields: Sequence[str] = ("*",),
        geometry: GeometryFilter | None = None,
        return_geometry: bool = True,
        max_records: int | None = None,
    ) -> list[EsriFeature]:
        """Fetch every matching feature using OBJECTID keyset pagination.

        Keyset pagination (``OID > last`` ordered by OID) is stable even when the
        layer does not support ``resultOffset``.
        """
        info = await self.layer_info(layer_url)
        oid = info.object_id_field
        cap = min(max_records or self._max_records, self._max_records)
        fields = list(out_fields)
        if "*" not in fields and oid not in fields:
            fields.append(oid)
        features: list[EsriFeature] = []
        last_oid: int | None = None
        while len(features) < cap:
            page_where = where if last_oid is None else f"({where}) AND {oid} > {last_oid}"
            page = await self.query(
                layer_url,
                where=page_where,
                out_fields=fields,
                geometry=geometry,
                return_geometry=return_geometry,
                order_by=f"{oid} ASC",
                record_count=min(info.max_record_count, cap - len(features)),
            )
            if not page.features:
                break
            features.extend(page.features)
            page_last = page.features[-1].attributes.get(oid)
            if not isinstance(page_last, int) or (last_oid is not None and page_last <= last_oid):
                raise ArcGISResponseError("Pagination did not advance; results are not ordered by OBJECTID")
            last_oid = page_last
            if not page.exceeded_transfer_limit and len(page.features) < info.max_record_count:
                break
        return features[:cap]

    async def count(
        self, layer_url: str, *, where: str = "1=1", geometry: GeometryFilter | None = None
    ) -> int:
        params = self._query_params(where, ("*",), geometry, return_geometry=False)
        params["returnCountOnly"] = "true"
        payload = await self._request(f"{layer_url}/query", params)
        try:
            return _EsriCount.model_validate(payload).count
        except ValidationError as exc:
            raise ArcGISResponseError("Count response has an unexpected shape") from exc

    # -- Internals ---------------------------------------------------------------------

    @staticmethod
    def _query_params(
        where: str, out_fields: Sequence[str], geometry: GeometryFilter | None, return_geometry: bool
    ) -> dict[str, str]:
        fields = [f if f == "*" else validate_field_name(f) for f in out_fields]
        params = {
            "f": "json",
            "where": where,
            "outFields": ",".join(fields),
            "returnGeometry": "true" if return_geometry else "false",
            "outSR": str(WGS84),
        }
        if geometry is not None:
            params.update(geometry.params())
        return params

    @staticmethod
    def _parse_feature_set(payload: dict[str, Any]) -> EsriFeatureSet:
        if "features" not in payload:
            raise ArcGISResponseError("Query response has no 'features' member")
        try:
            return EsriFeatureSet.model_validate(payload)
        except ValidationError as exc:
            raise ArcGISResponseError("Query response has an unexpected shape") from exc

    async def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        provider = self._token_provider
        token = await provider.token() if provider is not None else self._token
        if token:
            headers["X-Esri-Authorization"] = f"Bearer {token}"
        if provider is not None and provider.referer:
            # Referer-bound tokens are only valid with the same Referer.
            headers["Referer"] = provider.referer
        return headers

    @contextlib.asynccontextmanager
    async def _slot(self) -> AsyncIterator[None]:
        try:
            await asyncio.wait_for(self._slots.acquire(), self._queue_timeout)
        except TimeoutError as exc:
            raise ArcGISUnavailableError("Too many concurrent requests to the data service") from exc
        try:
            yield
        finally:
            self._slots.release()

    async def _send(
        self, url: str, params: dict[str, str], headers: dict[str, str], *, use_post: bool
    ) -> httpx.Response:
        """One upstream attempt: bounded in concurrency, total time (including a
        slowly trickling body) and response size. Redirects are never followed."""
        async with self._slot(), asyncio.timeout(self._timeout):
            request = self._http.build_request(
                "POST" if use_post else "GET",
                url,
                data=params if use_post else None,
                params=None if use_post else params,
                headers=headers,
                timeout=self._timeout,
            )
            response = await self._http.send(request, stream=True, follow_redirects=False)
            try:
                declared = int(response.headers.get("Content-Length", "0") or 0)
                if declared > self._max_response_bytes:
                    raise ArcGISResponseError("The data service response is too large")
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > self._max_response_bytes:
                        raise ArcGISResponseError("The data service response is too large")
                    chunks.append(chunk)
            finally:
                await response.aclose()
            # Rebuild a fully read response so callers can use .content/.json().
            # The body is already decoded, so drop the encoding headers.
            kept = [
                (name, value)
                for name, value in response.headers.multi_items()
                if name.lower() not in ("content-encoding", "content-length", "transfer-encoding")
            ]
            return httpx.Response(
                response.status_code, headers=kept, content=b"".join(chunks), request=request
            )

    async def get_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        """Any other ArcGIS REST operation (for example a GeocodeServer), with the
        same token handling, retries, timeouts and error detection."""
        return await self._request(url, {**params, "f": "json"})

    async def post_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        """Like get_json, sent as a POST form (for long parameters such as
        Network Analyst travel modes)."""
        return await self._request(url, {**params, "f": "json"}, force_post=True)

    async def _request(self, url: str, params: dict[str, str], *, force_post: bool = False) -> dict[str, Any]:
        use_post = (
            force_post or "geometry" in params or len(str(params.get("where", ""))) > MAX_GET_QUERY_LENGTH
        )
        deadline = time.monotonic() + self._timeout * (self._max_retries + 1)
        attempt = 0
        token_renewed = False
        while True:
            retry_after: float | None = None
            headers = await self._headers()
            try:
                response = await self._send(url, params, headers, use_post=use_post)
            except httpx.ConnectTimeout as exc:
                failure: ArcGISError = ArcGISTimeoutError("Timed out connecting to the data service")
                cause: BaseException = exc
            except (httpx.TimeoutException, TimeoutError) as exc:
                # A read timeout (or the whole attempt taking longer than the
                # timeout, e.g. a trickling body) means the server is slow;
                # retrying would only multiply the wait, so fail fast.
                raise ArcGISTimeoutError("The data service did not respond in time") from exc
            except httpx.TransportError as exc:
                failure = ArcGISUnavailableError(f"Could not reach the data service ({type(exc).__name__})")
                cause = exc
            else:
                if response.status_code in RETRYABLE_STATUS:
                    failure = ArcGISUnavailableError(f"The data service returned HTTP {response.status_code}")
                    cause = failure
                    retry_after = _parse_retry_after(response.headers.get("Retry-After"))
                elif response.status_code >= 400:
                    raise ArcGISResponseError(f"The data service returned HTTP {response.status_code}")
                else:
                    payload = _decode_json(response)
                    error = payload.get("error")
                    if not isinstance(error, dict):
                        return payload
                    code = error.get("code")
                    code = code if isinstance(code, int) else None
                    if code in ARCGIS_TOKEN_ERROR_CODES:
                        if self._token_provider is not None and not token_renewed:
                            # Expired or revoked token: renew once and retry.
                            token_renewed = True
                            await self._token_provider.invalidate(_bearer(headers))
                            continue
                        raise ArcGISAuthError("The data service rejected the access token", code)
                    if code is None or code < 500:
                        raw_details = error.get("details")
                        details = [str(d) for d in raw_details] if isinstance(raw_details, list) else []
                        raise ArcGISResponseError(
                            f"The data service rejected the query (code {code})", code, details
                        )
                    failure = ArcGISUnavailableError(
                        f"The data service reported an internal error (code {code})"
                    )
                    cause = failure

            attempt += 1
            delay = retry_after if retry_after is not None else self._backoff(attempt)
            if attempt > self._max_retries or time.monotonic() + delay >= deadline:
                if failure is cause:
                    raise failure
                raise failure from cause
            logger.warning(
                "arcgis_request_retry",
                extra={"attempt": attempt, "reason": str(failure), "delay_s": round(delay, 3)},
            )
            await asyncio.sleep(delay)

    def _backoff(self, attempt: int) -> float:
        return float(self._backoff_base * (2 ** (attempt - 1)) + random.uniform(0, self._backoff_base))  # noqa: S311


def _bearer(headers: dict[str, str]) -> str | None:
    value = headers.get("X-Esri-Authorization", "")
    return value.removeprefix("Bearer ") or None


def _decode_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = json.loads(response.content)
    except ValueError as exc:
        raise ArcGISResponseError("The data service returned a non-JSON response") from exc
    if not isinstance(payload, dict):
        raise ArcGISResponseError("The data service returned an unexpected JSON document")
    return payload


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return min(2.0, max(0.0, float(value)))
    except ValueError:
        return None
