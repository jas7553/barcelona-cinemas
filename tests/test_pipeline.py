"""Tests for pipeline.py — cache TTL logic and collection error handling."""

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

import cache
import pipeline
from models import Listings


def _listings() -> Listings:
    return Listings(
        fetched_at=datetime.now(UTC).isoformat(),
        stale=False,
        movies=[],
    )


@pytest.fixture()
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache, "_CACHE_FILE", tmp_path / "listings.json")


def test_get_listings_returns_cache_when_fresh(tmp_cache, monkeypatch):
    """Fresh cache is returned without calling refresh."""
    cached = _listings()
    cache.write(cached)

    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 12)

    with patch.object(pipeline, "_refresh") as mock_refresh:
        result = pipeline.get_listings()

    mock_refresh.assert_not_called()
    assert result["fetched_at"] == cached["fetched_at"]


def test_get_listings_marks_cache_stale_when_ttl_is_exceeded(tmp_cache, monkeypatch):
    """Expired cache is served back as stale without triggering refresh."""
    cache.write(_listings())
    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 0)  # always stale

    with patch.object(pipeline, "_refresh") as mock_refresh:
        result = pipeline.get_listings()

    mock_refresh.assert_not_called()
    assert result["stale"] is True


def test_get_listings_raises_when_no_cache(tmp_cache, monkeypatch):
    """No cache file now returns an error to the request path."""
    monkeypatch.setattr(pipeline, "_CACHE_TTL_HOURS", 12)

    with (
        patch.object(pipeline, "_refresh") as mock_refresh,
        pytest.raises(RuntimeError, match="Listings cache unavailable"),
    ):
        pipeline.get_listings()

    mock_refresh.assert_not_called()


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


def test_collect_movies_raises_when_provider_fails():
    """RuntimeError is raised when the provider fails."""
    with (
        patch.object(pipeline, "ListingsProvider") as mock_cls,
        pytest.raises(RuntimeError, match="Provider failed"),
    ):
        mock_cls.return_value.fetch.side_effect = RuntimeError("down")
        pipeline._collect_movies({})


def test_collect_movies_drops_invalid_movies_and_showtimes():
    """Provider output is normalized before it reaches the cache layer."""
    provider = MagicMock()
    provider.fetch.return_value = [
        {
            "title": "Valid Film",
            "tmdb_id": None,
            "synopsis": None,
            "rating": None,
            "runtime_mins": None,
            "genres": None,
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-28",
                    "time": "18:00",
                },
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "bad-date",
                    "time": "18:00",
                },
            ],
        },
        {
            "title": "",
            "tmdb_id": None,
            "synopsis": None,
            "rating": None,
            "runtime_mins": None,
            "genres": None,
            "showtimes": [],
        },
    ]

    with patch.object(pipeline, "ListingsProvider", return_value=provider):
        result = pipeline._collect_movies({})

    assert len(result) == 1
    assert result[0]["title"] == "Valid Film"
    assert result[0]["showtimes"] == [
        {
            "cinema": "Verdi",
            "neighborhood": "Gracia",
            "address": "Carrer de Verdi, 32",
            "date": "2026-03-28",
            "time": "18:00",
        }
    ]
