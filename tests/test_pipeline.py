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


def test_collect_movies_raises_when_all_providers_fail():
    """RuntimeError is raised when every provider fails."""
    provider_one = MagicMock(name="provider_one")
    provider_one.name = "provider_one"
    provider_one.fetch.side_effect = RuntimeError("down")
    provider_two = MagicMock(name="provider_two")
    provider_two.name = "provider_two"
    provider_two.fetch.side_effect = RuntimeError("down")

    with (
        patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]),
        pytest.raises(RuntimeError, match="Provider failed"),
    ):
        pipeline._collect_movies({})


def test_collect_movies_drops_invalid_movies_and_showtimes():
    """Provider output is normalized before it reaches the cache layer."""
    provider = MagicMock()
    provider.name = "provider_one"
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

    with patch.object(pipeline, "all_providers", return_value=[provider]):
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


def test_collect_movies_merges_provider_results_by_title_and_imdb_id():
    provider_one = MagicMock()
    provider_one.name = "provider_one"
    provider_one.fetch.return_value = [
        {
            "title": "Project Hail Mary",
            "tmdb_id": None,
            "imdb_id": None,
            "year": None,
            "poster_url": None,
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
                }
            ],
        }
    ]
    provider_two = MagicMock()
    provider_two.name = "provider_two"
    provider_two.fetch.return_value = [
        {
            "title": "Project Hail Mary",
            "tmdb_id": None,
            "imdb_id": "tt12042730",
            "year": None,
            "poster_url": None,
            "synopsis": None,
            "rating": None,
            "runtime_mins": None,
            "genres": None,
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-29",
                    "time": "20:00",
                    "language": "vo",
                }
            ],
        }
    ]

    with patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]):
        result = pipeline._collect_movies({})

    assert len(result) == 1
    assert result[0]["imdb_id"] == "tt12042730"
    assert len(result[0]["showtimes"]) == 2


def test_collect_movies_deduplicates_missing_and_explicit_vo_language():
    provider_one = MagicMock()
    provider_one.name = "provider_one"
    provider_one.fetch.return_value = [
        {
            "title": "Project Hail Mary",
            "tmdb_id": None,
            "imdb_id": None,
            "year": None,
            "poster_url": None,
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
                }
            ],
        }
    ]
    provider_two = MagicMock()
    provider_two.name = "provider_two"
    provider_two.fetch.return_value = [
        {
            "title": "Project Hail Mary",
            "tmdb_id": None,
            "imdb_id": "tt12042730",
            "year": None,
            "poster_url": None,
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
                    "language": "vo",
                }
            ],
        }
    ]

    with patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]):
        result = pipeline._collect_movies({})

    assert len(result) == 1
    assert result[0]["showtimes"] == [
        {
            "cinema": "Verdi",
            "neighborhood": "Gracia",
            "address": "Carrer de Verdi, 32",
            "date": "2026-03-28",
            "time": "18:00",
            "language": "vo",
        }
    ]


def test_collect_movies_merges_quoted_and_unquoted_titles_when_identity_matches():
    provider_one = MagicMock()
    provider_one.name = "provider_one"
    provider_one.fetch.return_value = [
        {
            "title": "\"Wuthering Heights\"",
            "tmdb_id": None,
            "imdb_id": None,
            "year": None,
            "poster_url": None,
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
                    "language": "vo",
                }
            ],
        }
    ]
    provider_two = MagicMock()
    provider_two.name = "provider_two"
    provider_two.fetch.return_value = [
        {
            "title": "Wuthering Heights",
            "tmdb_id": None,
            "imdb_id": "tt32897959",
            "year": None,
            "poster_url": None,
            "synopsis": None,
            "rating": None,
            "runtime_mins": None,
            "genres": None,
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-29",
                    "time": "20:00",
                    "language": "vo",
                }
            ],
        }
    ]

    with patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]):
        result = pipeline._collect_movies({})

    assert len(result) == 1
    assert result[0]["imdb_id"] == "tt32897959"
    assert len(result[0]["showtimes"]) == 2


def test_collect_movies_keeps_conflicting_imdb_ids_split_even_when_titles_normalize():
    provider_one = MagicMock()
    provider_one.name = "provider_one"
    provider_one.fetch.return_value = [
        {
            "title": "\"Wuthering Heights\"",
            "tmdb_id": 1316092,
            "imdb_id": "tt32897959",
            "year": 2026,
            "poster_url": "https://image.tmdb.org/t/p/w342/new.jpg",
            "synopsis": "New adaptation",
            "rating": 6.4,
            "runtime_mins": 136,
            "genres": ["Drama"],
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-28",
                    "time": "18:00",
                    "language": "vo",
                }
            ],
        }
    ]
    provider_two = MagicMock()
    provider_two.name = "provider_two"
    provider_two.fetch.return_value = [
        {
            "title": "Wuthering Heights",
            "tmdb_id": 25095,
            "imdb_id": "tt0104181",
            "year": 1992,
            "poster_url": "https://image.tmdb.org/t/p/w342/old.jpg",
            "synopsis": "Older adaptation",
            "rating": 6.6,
            "runtime_mins": 105,
            "genres": ["Drama", "Romance"],
            "showtimes": [
                {
                    "cinema": "Balmes",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Balmes, 422-424",
                    "date": "2026-03-29",
                    "time": "20:00",
                    "language": "vo",
                }
            ],
        }
    ]

    with patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]):
        result = pipeline._collect_movies({})

    assert len(result) == 2
    imdb_ids = {movie["imdb_id"] for movie in result}
    assert imdb_ids == {"tt32897959", "tt0104181"}


def test_collect_movies_returns_data_when_one_provider_fails():
    provider_one = MagicMock()
    provider_one.name = "provider_one"
    provider_one.fetch.side_effect = RuntimeError("down")
    provider_two = MagicMock()
    provider_two.name = "provider_two"
    provider_two.fetch.return_value = [
        {
            "title": "Valid Film",
            "tmdb_id": None,
            "imdb_id": None,
            "year": None,
            "poster_url": None,
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
                }
            ],
        }
    ]

    with patch.object(pipeline, "all_providers", return_value=[provider_one, provider_two]):
        result = pipeline._collect_movies({})

    assert len(result) == 1
    assert result[0]["title"] == "Valid Film"
