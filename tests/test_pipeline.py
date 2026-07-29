"""
Tests for pipeline.py — the refresh's I/O half.

The ritual itself (collection, Reconciliation, Enrichment, the English filter)
lives in refresh.py and is tested in tests/test_refresh.py. What is left here is
cache TTL logic, the cache read/build/write ordering, and publication of the
static site.
"""

import json
import logging
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import cache
import observability
import pipeline
import transform
from models import Listings


def _listings() -> Listings:
    return Listings(
        fetched_at=datetime.now(UTC).isoformat(),
        stale=False,
        movies=[],
    )


@pytest.fixture()
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_backend", cache._FileBackend(tmp_path, tmp_path / "listings.json"))


def test_get_listings_returns_cache_when_fresh(tmp_cache, monkeypatch):
    """A fresh cache is served straight back."""
    cached = _listings()
    cache.write(cached)

    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 12)

    assert pipeline.get_listings()["fetched_at"] == cached["fetched_at"]


def test_get_listings_marks_cache_stale_when_ttl_is_exceeded(tmp_cache, monkeypatch):
    """An expired cache is served back as stale; the read path never refreshes."""
    cache.write(_listings())
    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 0)  # always stale

    assert pipeline.get_listings()["stale"] is True


def test_get_listings_raises_when_no_cache(tmp_cache, monkeypatch):
    """No cache file now returns an error to the request path."""
    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 12)

    with pytest.raises(RuntimeError, match="Listings cache unavailable"):
        pipeline.get_listings()


def test_force_refresh_bypasses_ttl(tmp_cache, monkeypatch):
    """force_refresh always calls _refresh regardless of cache state."""
    cached = _listings()
    cache.write(cached)
    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 999)

    fresh = _listings()
    with patch.object(pipeline, "_refresh", return_value=fresh) as mock_refresh:
        result = pipeline.force_refresh()

    mock_refresh.assert_called_once()
    assert result is fresh


# ── _publish_static_site ──────────────────────────────────────────────────────


def test_publish_static_site_noop_when_bucket_absent(monkeypatch):
    monkeypatch.delenv("FRONTEND_BUCKET", raising=False)
    with patch.object(pipeline, "_s3") as mock_s3, patch.object(pipeline, "_lambda") as mock_lambda:
        pipeline._publish_static_site(_listings())
    mock_s3.assert_not_called()
    mock_lambda.assert_not_called()


def test_publish_static_site_uploads_public_json_and_invokes_renderer(monkeypatch):
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.setenv("SSG_FUNCTION_NAME", "ssg-renderer")
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_s3, mock_lambda = MagicMock(), MagicMock()
    with (
        patch.object(pipeline, "_s3", return_value=mock_s3),
        patch.object(pipeline, "_lambda", return_value=mock_lambda),
    ):
        pipeline._publish_static_site(_listings())

    mock_s3.put_object.assert_called_once()
    put = mock_s3.put_object.call_args.kwargs
    assert put["Bucket"] == "frontend-bucket"
    assert put["Key"] == "data/listings.json"
    mock_lambda.invoke.assert_called_once()
    invoke = mock_lambda.invoke.call_args.kwargs
    assert invoke["FunctionName"] == "ssg-renderer"
    assert invoke["InvocationType"] == "Event"


def test_publish_static_site_skips_invoke_when_function_unset(monkeypatch):
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.delenv("SSG_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_s3, mock_lambda = MagicMock(), MagicMock()
    with (
        patch.object(pipeline, "_s3", return_value=mock_s3),
        patch.object(pipeline, "_lambda", return_value=mock_lambda),
    ):
        pipeline._publish_static_site(_listings())
    mock_s3.put_object.assert_called_once()
    mock_lambda.invoke.assert_not_called()


def test_publish_static_site_swallows_exceptions(monkeypatch):
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_s3 = MagicMock()
    mock_s3.put_object.side_effect = RuntimeError("S3 down")
    with patch.object(pipeline, "_s3", return_value=mock_s3):
        pipeline._publish_static_site(_listings())  # must not raise


# ── force_refresh integration ─────────────────────────────────────────────────


def test_force_refresh_publishes_site_on_success(tmp_cache):
    fresh = _listings()
    with (
        patch.object(pipeline, "_refresh", return_value=fresh),
        patch.object(pipeline, "_publish_static_site") as mock_publish,
    ):
        pipeline.force_refresh()

    mock_publish.assert_called_once_with(fresh)


def test_force_refresh_skips_publish_on_failure(tmp_cache):
    with (
        patch.object(pipeline, "_refresh", side_effect=RuntimeError("refresh failed")),
        patch.object(pipeline, "_publish_static_site") as mock_publish,
        pytest.raises(RuntimeError),
    ):
        pipeline.force_refresh()

    mock_publish.assert_not_called()


def test_publish_static_site_forwards_the_refresh_id_to_the_renderer(monkeypatch):
    """Nothing else joins the renderer's log group back to the refresh that triggered it."""
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.setenv("SSG_FUNCTION_NAME", "ssg-renderer")
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_s3, mock_lambda = MagicMock(), MagicMock()
    observability.set_context(refresh_id="refresh-abc123")
    try:
        with (
            patch.object(pipeline, "_s3", return_value=mock_s3),
            patch.object(pipeline, "_lambda", return_value=mock_lambda),
        ):
            pipeline._publish_static_site(_listings())
    finally:
        observability.clear_context()

    payload = json.loads(mock_lambda.invoke.call_args.kwargs["Payload"])
    assert payload["refresh_id"] == "refresh-abc123"


def test_publish_static_site_emits_a_metric_when_the_upload_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The refresh still reports success, so this metric is the only alarm signal."""
    caplog.set_level(logging.INFO, logger="observability")
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_s3 = MagicMock()
    mock_s3.put_object.side_effect = RuntimeError("S3 down")
    with patch.object(pipeline, "_s3", return_value=mock_s3):
        pipeline._publish_static_site(_listings())

    assert '"SsgPublishFailure": 1' in caplog.text
    assert '"event": "ssg_publish_failure"' in caplog.text


def test_publish_static_site_emits_a_metric_when_the_renderer_invoke_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    monkeypatch.setenv("FRONTEND_BUCKET", "frontend-bucket")
    monkeypatch.setenv("SSG_FUNCTION_NAME", "ssg-renderer")
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})
    monkeypatch.setattr(
        transform,
        "to_api_response",
        lambda listings, cinemas: {"generated_at": "x", "stale": False, "theaters": [], "movies": []},
    )
    mock_lambda = MagicMock()
    mock_lambda.invoke.side_effect = RuntimeError("Lambda down")
    with (
        patch.object(pipeline, "_s3", return_value=MagicMock()),
        patch.object(pipeline, "_lambda", return_value=mock_lambda),
    ):
        pipeline._publish_static_site(_listings())  # must not raise

    assert '"SsgInvokeFailure": 1' in caplog.text
    assert '"event": "ssg_invoke_failure"' in caplog.text


# ── _refresh: I/O only ────────────────────────────────────────────────────────


def test_refresh_reads_the_cache_builds_then_writes(tmp_cache, monkeypatch):
    """
    The whole of `_refresh`: one cache read in, one cache write out, and
    `refresh.build_listings` in between. The order is the point — the read has
    to precede the build (its Listings seed both Enrichment and the Verdi
    Provider's admit-one sala map) and the write has to follow it.
    """
    previous = _listings()
    cache.write(previous)
    fresh = _listings()
    calls: list[str] = []

    def _fake_build(providers: Any, cinemas: Any, cached: Any, now: Any) -> tuple[Listings, dict[str, int]]:
        calls.append("build")
        assert cached["fetched_at"] == previous["fetched_at"]
        assert cinemas  # the registry, not an empty dict
        return fresh, {}

    real_write = cache.write

    def _spy_write(listings: Listings) -> None:
        calls.append("write")
        real_write(listings)

    monkeypatch.setattr(pipeline, "build_listings", _fake_build)
    monkeypatch.setattr(cache, "write", _spy_write)
    with patch("providers.all_providers", return_value=[]) as mock_all_providers:
        result = pipeline._refresh()

    assert calls == ["build", "write"]
    assert result is fresh
    written = cache.read()
    assert written is not None
    assert written["fetched_at"] == fresh["fetched_at"]
    # The Providers are constructed from the same cache read the build gets.
    assert mock_all_providers.call_args.args[0]["fetched_at"] == previous["fetched_at"]


def test_refresh_leaves_the_cache_alone_when_the_build_fails(tmp_cache, monkeypatch):
    """A failed refresh must leave the old Listings serving."""
    previous = _listings()
    cache.write(previous)

    def _failing_build(*args: Any, **kwargs: Any) -> tuple[Listings, dict[str, int]]:
        raise RuntimeError("All providers failed to return listings")

    monkeypatch.setattr(pipeline, "build_listings", _failing_build)
    with patch("providers.all_providers", return_value=[]), pytest.raises(RuntimeError):
        pipeline._refresh()

    untouched = cache.read()
    assert untouched is not None
    assert untouched["fetched_at"] == previous["fetched_at"]


def test_refresh_passes_a_cold_cache_through_as_none(tmp_cache, monkeypatch):
    seen: list[Any] = []

    def _fake_build(providers: Any, cinemas: Any, cached: Any, now: Any) -> tuple[Listings, dict[str, int]]:
        seen.append(cached)
        return _listings(), {}

    monkeypatch.setattr(pipeline, "build_listings", _fake_build)
    with patch("providers.all_providers", return_value=[]) as mock_all_providers:
        pipeline._refresh()

    assert seen == [None]
    assert mock_all_providers.call_args.args[0] is None
