import httpx
import pytest
import respx

from app.services.arcgis.client import (
    ArcGISAuthError,
    ArcGISFeatureServerClient,
    ArcGISResponseError,
    ArcGISTimeoutError,
    ArcGISUnavailableError,
    PointFilter,
    resolve_layer_url,
)
from tests.conftest import feature_set, layer_json, point

LAYER = "https://gis.example.test/arcgis/rest/services/Places/FeatureServer/0"


@pytest.fixture
def router():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(LAYER).mock(return_value=httpx.Response(200, json=layer_json(["name"], max_record_count=2)))
        yield mock


def make_client(**kwargs) -> ArcGISFeatureServerClient:
    return ArcGISFeatureServerClient(
        httpx.AsyncClient(), backoff_base_seconds=0.001, timeout_seconds=1, **kwargs
    )


def test_resolve_layer_url_accepts_service_or_layer() -> None:
    assert (
        resolve_layer_url("https://x/arcgis/rest/services/S/FeatureServer")
        == "https://x/arcgis/rest/services/S/FeatureServer/0"
    )
    assert (
        resolve_layer_url("https://x/arcgis/rest/services/S/FeatureServer/3/")
        == "https://x/arcgis/rest/services/S/FeatureServer/3"
    )


async def test_layer_info_is_parsed_and_cached(router: respx.MockRouter) -> None:
    client = make_client()
    info = await client.layer_info(LAYER)
    await client.layer_info(LAYER)
    assert info.object_id_field == "OBJECTID"
    assert info.max_record_count == 2
    assert info.supports_pagination
    assert router.routes[0].call_count == 1


async def test_query_all_paginates_by_objectid(router: respx.MockRouter) -> None:
    pages = [
        feature_set([point(1, 106.9, 47.9, name="a"), point(2, 106.9, 47.9, name="b")], exceeded=True),
        feature_set([point(3, 106.9, 47.9, name="c")]),
    ]
    seen_where: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen_where.append(request.url.params["where"])
        assert request.url.params["orderByFields"] == "OBJECTID ASC"
        assert request.url.params["outSR"] == "4326"
        return httpx.Response(200, json=pages[len(seen_where) - 1])

    router.get(f"{LAYER}/query").mock(side_effect=respond)
    features = await make_client().query_all(LAYER, out_fields=["name"])
    assert [f.attributes["name"] for f in features] == ["a", "b", "c"]
    assert seen_where == ["1=1", "(1=1) AND OBJECTID > 2"]


async def test_geometry_queries_use_post(router: respx.MockRouter) -> None:
    route = router.post(f"{LAYER}/query").mock(return_value=httpx.Response(200, json=feature_set([])))
    await make_client().query(LAYER, geometry=PointFilter(106.9, 47.9, 100))
    body = route.calls[0].request.content.decode()
    assert "esriGeometryPoint" in body
    assert "distance=100.00" in body


async def test_arcgis_error_body_with_http_200_is_detected(router: respx.MockRouter) -> None:
    router.get(f"{LAYER}/query").mock(
        return_value=httpx.Response(
            200, json={"error": {"code": 400, "message": "Invalid query", "details": []}}
        )
    )
    with pytest.raises(ArcGISResponseError) as caught:
        await make_client().query(LAYER)
    assert caught.value.arcgis_code == 400


async def test_token_errors_are_auth_errors_and_token_is_sent(router: respx.MockRouter) -> None:
    route = router.get(f"{LAYER}/query").mock(
        return_value=httpx.Response(200, json={"error": {"code": 498, "message": "Invalid token."}})
    )
    with pytest.raises(ArcGISAuthError):
        await make_client(token="secret-token").query(LAYER)
    assert route.calls[0].request.headers["X-Esri-Authorization"] == "Bearer secret-token"


async def test_transient_failures_are_retried(router: respx.MockRouter) -> None:
    route = router.get(f"{LAYER}/query").mock(
        side_effect=[
            httpx.Response(503),
            httpx.ConnectError("refused"),
            httpx.Response(200, json=feature_set([point(1, 1, 1, name="ok")])),
        ]
    )
    result = await make_client(max_retries=2).query(LAYER)
    assert result.features[0].attributes["name"] == "ok"
    assert route.call_count == 3


async def test_retries_give_up_with_unavailable_error(router: respx.MockRouter) -> None:
    route = router.get(f"{LAYER}/query").mock(return_value=httpx.Response(502))
    with pytest.raises(ArcGISUnavailableError):
        await make_client(max_retries=1).query(LAYER)
    assert route.call_count == 2


async def test_read_timeouts_fail_fast_without_retry(router: respx.MockRouter) -> None:
    route = router.get(f"{LAYER}/query").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(ArcGISTimeoutError):
        await make_client(max_retries=2).query(LAYER)
    assert route.call_count == 1


async def test_client_errors_are_not_retried(router: respx.MockRouter) -> None:
    route = router.get(f"{LAYER}/query").mock(return_value=httpx.Response(404))
    with pytest.raises(ArcGISResponseError):
        await make_client().query(LAYER)
    assert route.call_count == 1


@pytest.mark.parametrize("payload", ["<html>maintenance</html>", "[1, 2]", '{"no_features": true}'])
async def test_malformed_responses_are_rejected(router: respx.MockRouter, payload: str) -> None:
    router.get(f"{LAYER}/query").mock(return_value=httpx.Response(200, text=payload))
    with pytest.raises(ArcGISResponseError):
        await make_client().query(LAYER)


async def test_error_messages_never_contain_the_service_url(router: respx.MockRouter) -> None:
    router.get(f"{LAYER}/query").mock(side_effect=httpx.ConnectError(f"failed to connect to {LAYER}"))
    with pytest.raises(ArcGISUnavailableError) as caught:
        await make_client(max_retries=0).query(LAYER)
    assert "gis.example.test" not in str(caught.value)


async def test_count(router: respx.MockRouter) -> None:
    router.get(f"{LAYER}/query").mock(return_value=httpx.Response(200, json={"count": 42}))
    assert await make_client().count(LAYER) == 42
