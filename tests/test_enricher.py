"""Tests for enricher.py — TMDb cache reuse and metadata merging."""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import enricher
from models import Movie, Showtime


def _movie(title: str, showtimes: list[Showtime] | None = None, **kwargs: Any) -> Movie:
    return Movie(
        title=title,
        tmdb_id=kwargs.get("tmdb_id"),
        imdb_id=kwargs.get("imdb_id"),
        year=kwargs.get("year"),
        poster_url=kwargs.get("poster_url"),
        synopsis=kwargs.get("synopsis"),
        rating=kwargs.get("rating"),
        runtime_mins=kwargs.get("runtime_mins"),
        genres=kwargs.get("genres"),
        showtimes=showtimes or [],
    )


def _showtime(date: str = "2026-03-28") -> Showtime:
    return Showtime(cinema="Verdi", neighborhood="Gràcia", address="", date=date, time="18:00")


TMDB_SEARCH = {
    "results": [{"id": 42, "title": "Dune: Part Two"}],
}

TMDB_DETAIL = {
    "id": 42,
    "imdb_id": "tt15239678",
    "poster_path": "/poster.jpg",
    "overview": "A hero's journey continues.",
    "vote_average": 8.5,
    "runtime": 166,
    "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
}


@pytest.fixture(autouse=True)
def reset_api_key_cache() -> None:
    enricher._cached_api_key = None


@pytest.fixture()
def mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TMDB_API_KEY", "test-key")


def test_reuses_cached_metadata(mock_env):
    """Movie already in cache keeps its TMDb data; only showtimes are updated."""
    cached = _movie("Dune: Part Two", tmdb_id=42, imdb_id="tt15239678",
                    poster_url="https://image.tmdb.org/t/p/w342/poster.jpg", synopsis="Old synopsis", rating=8.5,
                    showtimes=[_showtime("2026-03-27")])
    fresh = _movie("Dune: Part Two", showtimes=[_showtime("2026-03-28")])

    with patch("enricher.requests.Session") as MockSession:
        result, stats = enricher.enrich([fresh], [cached])

    # Session.get should never be called — data came from cache
    MockSession.return_value.__enter__ = MagicMock()
    assert result[0]["synopsis"] == "Old synopsis"
    assert result[0]["imdb_id"] == "tt15239678"
    assert result[0]["poster_url"] == "https://image.tmdb.org/t/p/w342/poster.jpg"
    assert result[0]["showtimes"][0]["date"] == "2026-03-28"
    assert stats["tmdb_cache_hit_count"] == 1
    MockSession.return_value.get.assert_not_called()


def test_fetches_tmdb_for_new_title(mock_env):
    """New title not in cache triggers two TMDb calls."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_DETAIL, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, stats = enricher.enrich([movie], [])

    assert result[0]["tmdb_id"] == 42
    assert result[0]["imdb_id"] == "tt15239678"
    assert result[0]["poster_url"] == "https://image.tmdb.org/t/p/w342/poster.jpg"
    assert result[0]["synopsis"] == "A hero's journey continues."
    assert result[0]["rating"] == 8.5
    assert result[0]["runtime_mins"] == 166
    assert result[0]["genres"] == ["Science Fiction", "Adventure"]
    assert stats["tmdb_enriched_count"] == 1


def test_lookup_failure_returns_movie_without_metadata(mock_env):
    """TMDb network error leaves metadata as None; never raises."""
    movie = _movie("Unknown Film", showtimes=[_showtime()])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = ConnectionError("network down")

    with patch("enricher.requests.Session", return_value=mock_session):
        result, stats = enricher.enrich([movie], [])

    assert result[0]["title"] == "Unknown Film"
    assert result[0]["tmdb_id"] is None
    assert result[0]["synopsis"] is None
    assert stats["tmdb_failure_count"] == 1


def test_skips_enrichment_when_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing API key returns movies unchanged."""
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    movie = _movie("Any Film", showtimes=[_showtime()])
    result, stats = enricher.enrich([movie], [])
    assert result == [movie]
    assert stats["tmdb_enriched_count"] == 0


def test_exact_title_match_preferred_over_popularity(mock_env):
    """When search returns multiple results, exact title match wins."""
    movie = _movie("Alien", showtimes=[_showtime()])
    search_results = {
        "results": [
            {"id": 1, "title": "Alien: Romulus"},  # higher popularity, first result
            {"id": 2, "title": "Alien"},            # exact match
        ]
    }
    detail = {**TMDB_DETAIL, "id": 2}

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: search_results, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: detail, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    # Verify the detail call used id=2 (exact match), not id=1
    detail_call_url = mock_session.get.call_args_list[1][0][0]
    assert "/movie/2" in detail_call_url
    assert result[0]["tmdb_id"] == 2


def test_cache_reuse_does_not_cross_exact_title_variants(mock_env):
    cached = _movie(
        "Wuthering Heights",
        tmdb_id=25095,
        imdb_id="tt0104181",
        synopsis="Older adaptation",
        showtimes=[_showtime("2026-03-27")],
    )
    fresh = _movie("\"Wuthering Heights\"", showtimes=[_showtime("2026-03-28")])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(
            status_code=200,
            json=lambda: {"results": [{"id": 1316092, "title": "\"Wuthering Heights\""}]},
            raise_for_status=lambda: None,
        ),
        MagicMock(
            status_code=200,
            json=lambda: {
                "id": 1316092,
                "imdb_id": "tt32897959",
                "poster_path": "/poster.jpg",
                "overview": "New adaptation",
                "vote_average": 6.4,
                "runtime": 136,
                "genres": [{"id": 18, "name": "Drama"}],
            },
            raise_for_status=lambda: None,
        ),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, stats = enricher.enrich([fresh], [cached])

    assert result[0]["tmdb_id"] == 1316092
    assert result[0]["imdb_id"] == "tt32897959"
    assert result[0]["synopsis"] == "New adaptation"
    assert stats["tmdb_cache_hit_count"] == 0


def test_invalid_tmdb_fields_are_safely_discarded(mock_env):
    """Malformed TMDb detail fields degrade to null instead of leaking bad data."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])
    invalid_detail = {
        "id": 42,
        "imdb_id": "not-an-imdb-id",
        "poster_path": "not-a-poster-path",
        "overview": ["not", "a", "string"],
        "vote_average": "8.5",
        "runtime": -10,
        "genres": [{"name": "Science Fiction"}, {"name": ""}, "bad-entry"],
    }

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: invalid_detail, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0]["tmdb_id"] == 42
    assert result[0]["imdb_id"] is None
    assert result[0]["poster_url"] is None
    assert result[0]["synopsis"] is None
    assert result[0]["rating"] is None
    assert result[0]["runtime_mins"] is None
    assert result[0]["genres"] == ["Science Fiction"]
