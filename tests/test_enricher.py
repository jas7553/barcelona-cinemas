"""Tests for enricher.py — TMDb cache reuse and metadata merging."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import enricher
import listings_config
from models import Movie, Showtime
from reconcile import reconcile


def _movie(title: str, showtimes: list[Showtime] | None = None, **kwargs: Any) -> Movie:
    m = Movie(
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
    if "enriched_at" in kwargs:
        m["enriched_at"] = kwargs["enriched_at"]
    if "tmdb_match_version" in kwargs:
        m["tmdb_match_version"] = kwargs["tmdb_match_version"]
    if "english_title" in kwargs:
        m["english_title"] = kwargs["english_title"]
    return m


def _fresh_enriched_at() -> str:
    """An `enriched_at` inside the re-enrichment TTL, whenever the suite runs."""
    return (datetime.now(UTC) - timedelta(hours=1)).isoformat()


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
    "vote_count": 12345,
    "runtime": 166,
    "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
    "original_language": "en",
}

TMDB_VIDEOS: dict[str, Any] = {"results": []}

TMDB_CREDITS = {
    "cast": [
        {"name": "Timothée Chalamet", "order": 0},
        {"name": "Zendaya", "order": 1},
        {"name": "Rebecca Ferguson", "order": 2},
    ],
    "crew": [
        {"name": "Denis Villeneuve", "job": "Director"},
        {"name": "Hans Zimmer", "job": "Original Music Composer"},
    ],
}


@pytest.fixture(autouse=True)
def reset_api_key_cache() -> Iterator[None]:
    listings_config._resolved_cache.clear()
    yield
    listings_config._resolved_cache.clear()


@pytest.fixture()
def mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TMDB_API_KEY", "test-key")


def test_reuses_cached_metadata(mock_env):
    """Movie already in cache keeps its TMDb data; only showtimes are updated."""
    cached = _movie(
        "Dune: Part Two",
        tmdb_id=42,
        imdb_id="tt15239678",
        poster_url="https://image.tmdb.org/t/p/w342/poster.jpg",
        synopsis="Old synopsis",
        rating=8.5,
        enriched_at=_fresh_enriched_at(),
        tmdb_match_version=enricher._MATCH_VERSION,
        showtimes=[_showtime("2026-03-27")],
    )
    fresh = _movie("Dune: Part Two", showtimes=[_showtime("2026-03-28")])

    with patch("enricher.requests.Session") as MockSession:
        result, stats = enricher.enrich([fresh], [cached])

    # Session.get should never be called — data came from cache
    MockSession.return_value.__enter__ = MagicMock()
    assert result[0]["synopsis"] == "Old synopsis"
    assert result[0]["imdb_id"] == "tt15239678"
    assert result[0]["poster_url"] == "https://image.tmdb.org/t/p/w342/poster.jpg"
    assert result[0]["showtimes"][0]["date"] == "2026-03-28"
    assert (
        "original_lang" not in result[0]
    )  # pre-enrichment cache entries lack the field; cache-hit path does not backfill
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
    assert result[0]["vote_count"] == 12345
    assert result[0]["runtime_mins"] == 166
    assert result[0]["genres"] == ["Science Fiction", "Adventure"]
    assert result[0]["original_lang"] == "en"
    assert stats["tmdb_enriched_count"] == 1


def test_fetches_director_and_cast_from_credits(mock_env):
    """Credits call populates director and top-billed cast."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_DETAIL, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_VIDEOS, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_CREDITS, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0]["director"] == "Denis Villeneuve"
    assert result[0]["cast"] == ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"]


def test_credits_fetch_failure_is_non_fatal(mock_env):
    """A failing credits call still enriches the rest; director/cast fall back to None."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_DETAIL, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: TMDB_VIDEOS, raise_for_status=lambda: None),
        ConnectionError("credits down"),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, stats = enricher.enrich([movie], [])

    assert result[0]["tmdb_id"] == 42
    assert result[0]["director"] is None
    assert result[0]["cast"] is None
    assert stats["tmdb_enriched_count"] == 1
    assert stats["tmdb_failure_count"] == 0


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


def test_reenrichment_failure_preserves_cached_metadata(mock_env):
    """Stale cache + TMDb outage keeps cached metadata, only showtimes refresh."""
    cached = _movie(
        "Dune: Part Two",
        tmdb_id=42,
        imdb_id="tt15239678",
        poster_url="https://image.tmdb.org/t/p/w342/poster.jpg",
        synopsis="Cached synopsis",
        rating=8.5,
        enriched_at="2020-01-01T00:00:00+00:00",
        showtimes=[_showtime("2026-03-27")],
    )
    fresh = _movie("Dune: Part Two", showtimes=[_showtime("2026-03-28")])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = ConnectionError("network down")

    with patch("enricher.requests.Session", return_value=mock_session):
        result, stats = enricher.enrich([fresh], [cached])

    assert result[0]["synopsis"] == "Cached synopsis"
    assert result[0]["poster_url"] == "https://image.tmdb.org/t/p/w342/poster.jpg"
    assert result[0]["tmdb_id"] == 42
    assert result[0]["showtimes"][0]["date"] == "2026-03-28"
    assert stats["tmdb_failure_count"] == 1
    assert stats["tmdb_reenriched_count"] == 1


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
            {"id": 2, "title": "Alien"},  # exact match
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
    fresh = _movie('"Wuthering Heights"', showtimes=[_showtime("2026-03-28")])

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(
            status_code=200,
            json=lambda: {"results": [{"id": 1316092, "title": '"Wuthering Heights"'}]},
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


def test_vote_count_absent_when_tmdb_omits_it(mock_env):
    """vote_count is absent (not None) when TMDb detail response omits the field."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])
    detail_without_count = {k: v for k, v in TMDB_DETAIL.items() if k != "vote_count"}

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: detail_without_count, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0]["vote_count"] is None


def test_scraper_title_preserved_as_cache_key_and_english_title_set(mock_env):
    """Scraper title stays in 'title' (stable cache key); TMDb English title goes into 'english_title'."""
    movie = _movie("Encuentros en la tercera fase", showtimes=[_showtime()])
    search = {"results": [{"id": 42, "title": "Close Encounters of the Third Kind"}]}
    detail = {
        **TMDB_DETAIL,
        "title": "Close Encounters of the Third Kind",
        "original_language": "en",
    }

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: search, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: detail, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0]["title"] == "Encuentros en la tercera fase"
    assert result[0]["english_title"] == "Close Encounters of the Third Kind"


def test_cache_hit_when_scraper_title_matches_cached_scraper_title(mock_env):
    """Cache lookup uses scraper title so localized-title movies hit cache after enrichment."""
    cached = _movie(
        "Encuentros en la tercera fase",
        tmdb_id=42,
        imdb_id="tt0075860",
        synopsis="A UFO story.",
        enriched_at=_fresh_enriched_at(),
        tmdb_match_version=enricher._MATCH_VERSION,
        showtimes=[_showtime("2026-03-27")],
    )
    cached["english_title"] = "Close Encounters of the Third Kind"
    fresh = _movie("Encuentros en la tercera fase", showtimes=[_showtime("2026-03-28")])

    with patch("enricher.requests.Session") as MockSession:
        result, stats = enricher.enrich([fresh], [cached])

    assert stats["tmdb_cache_hit_count"] == 1
    assert result[0]["synopsis"] == "A UFO story."
    assert result[0]["english_title"] == "Close Encounters of the Third Kind"
    MockSession.return_value.get.assert_not_called()


def test_populates_original_lang_from_tmdb(mock_env):
    """original_lang is populated from TMDb original_language."""
    movie = _movie("Anatomy of a Fall", showtimes=[_showtime()])
    detail = {**TMDB_DETAIL, "original_language": "fr"}

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: detail, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0].get("original_lang") == "fr"


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


def test_original_lang_absent_yields_none(mock_env):
    """Missing original_language from TMDb leaves original_lang as None without raising."""
    movie = _movie("Dune: Part Two", showtimes=[_showtime()])
    detail_without_lang = {k: v for k, v in TMDB_DETAIL.items() if k != "original_language"}

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda: TMDB_SEARCH, raise_for_status=lambda: None),
        MagicMock(status_code=200, json=lambda: detail_without_lang, raise_for_status=lambda: None),
    ]

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([movie], [])

    assert result[0]["original_lang"] is None


def _session(*payloads: dict[str, Any]) -> MagicMock:
    """A TMDb session answering each GET with the next payload, in order."""
    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = [
        MagicMock(status_code=200, json=lambda p=p: p, raise_for_status=lambda: None) for p in payloads
    ]
    return mock_session


def _detail_ids(mock_session: MagicMock) -> list[str]:
    return [
        call[0][0].rsplit("/", 1)[1]
        for call in mock_session.get.call_args_list
        if "/movie/" in call[0][0] and not call[0][0].endswith(("/videos", "/credits"))
    ]


TODAY = date(2026, 10, 20)

SENSE_AND_SENSIBILITY = [
    {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13", "genre_ids": [18, 10749]},
    {"id": 1503762, "title": "Sense and Sensibility", "release_date": "2026-09-18", "genre_ids": [18, 10749]},
    {"id": 1, "title": "Sense and Sensibility", "release_date": "1971-09-01", "genre_ids": [10770]},
]


def _ids(results: list[dict[str, Any]]) -> list[int]:
    return [r["id"] for r in results]


def _ranked_ids(title: str, results: list[dict[str, Any]], year: int | None = None) -> tuple[list[int], list[int]]:
    first_run, ordered = enricher._rank_candidates(title, results, year=year, today=TODAY)
    return _ids(first_run), _ids(ordered)


def _days_ago(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


def _spanish_release(released: str) -> dict[str, Any]:
    return {
        "results": [{"iso_3166_1": "ES", "release_dates": [{"release_date": f"{released}T00:00:00.000Z", "type": 3}]}]
    }


def test_same_title_tie_tries_a_recent_release_first_without_a_year():
    assert _ranked_ids("Sense and Sensibility", SENSE_AND_SENSIBILITY) == ([1503762], [4584, 1503762])


def test_provider_year_picks_the_film_from_that_year():
    assert _ranked_ids("Sense and Sensibility", SENSE_AND_SENSIBILITY, year=1995) == ([], [4584, 1503762])


def test_provider_year_allows_a_year_either_side_for_festival_premieres():
    assert _ranked_ids("Sense and Sensibility", SENSE_AND_SENSIBILITY, year=2025) == ([], [1503762, 4584])


def test_repertory_classic_keeps_tmdb_order_without_a_recent_namesake():
    results = [
        {"id": 7340, "title": "Carrie", "release_date": "1976-11-03"},
        {"id": 133805, "title": "Carrie", "release_date": "2013-10-16"},
    ]
    assert _ranked_ids("Carrie", results) == ([], [7340, 133805])


def test_recency_window_admits_a_preview_but_not_an_announced_film():
    results = [
        {"id": 8009, "title": "Highlander", "release_date": "1986-03-07"},
        {"id": 2, "title": "Highlander", "release_date": "2027-06-01"},
        {"id": 3, "title": "Highlander", "release_date": "2026-11-20"},
    ]
    assert _ranked_ids("Highlander", results)[0] == [3]


def test_tv_movies_never_match():
    results = [
        {"id": 1163, "title": "The Miracle Worker", "release_date": "2000-10-29", "genre_ids": [18, 10770]},
        {"id": 1162, "title": "The Miracle Worker", "release_date": "1962-05-23", "genre_ids": [18]},
    ]
    assert _ranked_ids("The Miracle Worker", results) == ([], [1162])
    assert _ranked_ids("The Miracle Worker", results[:1]) == ([], [])


def test_without_an_exact_title_the_top_result_stands_in():
    results = [
        {"id": 1503762, "title": "Sense and Sensibility", "release_date": "2026-09-18"},
        {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13"},
    ]
    assert _ranked_ids("Sentido y sensibilidad", results) == ([], [1503762])


def test_enrich_matches_the_current_release_over_an_older_namesake(mock_env):
    search = {
        "results": [
            {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13"},
            {"id": 1503762, "title": "Sense and Sensibility", "release_date": _days_ago(30)},
        ]
    }
    detail = {
        **TMDB_DETAIL,
        "id": 1503762,
        "imdb_id": "tt13609648",
        "runtime": 132,
        "release_dates": _spanish_release(_days_ago(-3)),
    }
    mock_session = _session(search, detail, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([_movie("Sense and Sensibility", [_showtime()])], [])

    assert _detail_ids(mock_session) == ["1503762"]
    assert result[0]["tmdb_id"] == 1503762
    assert result[0]["imdb_id"] == "tt13609648"
    assert result[0]["tmdb_match_version"] == enricher._MATCH_VERSION


def test_repertory_classic_beats_a_recent_namesake_never_released_in_spain(mock_env):
    search = {
        "results": [
            {"id": 152601, "title": "Her", "release_date": "2013-12-18"},
            {"id": 1380868, "title": "Her", "release_date": _days_ago(300)},
        ]
    }
    namesake = {**TMDB_DETAIL, "id": 1380868, "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": []}]}}
    classic = {**TMDB_DETAIL, "id": 152601, "runtime": 126, "release_dates": _spanish_release("2014-03-07")}
    mock_session = _session(search, namesake, classic, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([_movie("Her", [_showtime()])], [])

    assert _detail_ids(mock_session) == ["1380868", "152601"]
    assert result[0]["tmdb_id"] == 152601


def test_a_new_film_missing_its_spanish_release_keeps_its_tmdb_rank(mock_env):
    search = {
        "results": [
            {"id": 1309083, "title": "Dolly", "release_date": _days_ago(200)},
            {"id": 1069885, "title": "Dolly", "release_date": "2022-10-31"},
        ]
    }
    no_spanish_release = {**TMDB_DETAIL, "id": 1309083, "runtime": 83, "release_dates": {"results": []}}
    mock_session = _session(search, no_spanish_release, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([_movie("Dolly", [_showtime()])], [])

    assert _detail_ids(mock_session) == ["1309083"]
    assert result[0]["tmdb_id"] == 1309083


def test_a_recent_namesake_long_out_in_spain_is_not_a_first_run():
    detail = {"release_dates": _spanish_release("2025-01-29")}
    assert not enricher._in_spanish_first_run(detail, TODAY)
    assert enricher._in_spanish_first_run({"release_dates": _spanish_release("2026-10-23")}, TODAY)


def test_a_short_loses_a_same_title_tie_to_the_feature(mock_env):
    search = {
        "results": [
            {"id": 410051, "title": "Stranger Than Paradise", "release_date": "1982-01-01"},
            {"id": 469, "title": "Stranger Than Paradise", "release_date": "1984-09-01"},
        ]
    }
    short = {**TMDB_DETAIL, "id": 410051, "runtime": 32}
    feature = {**TMDB_DETAIL, "id": 469, "runtime": 89}
    mock_session = _session(search, short, feature, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([_movie("Stranger Than Paradise", [_showtime()])], [])

    assert _detail_ids(mock_session) == ["410051", "469"]
    assert result[0]["tmdb_id"] == 469
    assert result[0]["runtime_mins"] == 89
    assert mock_session.get.call_args_list[3][0][0].endswith("/movie/469/videos")


def test_a_lone_short_still_matches(mock_env):
    search = {"results": [{"id": 5, "title": "Short Film", "release_date": "2020-01-01"}]}
    mock_session = _session(search, {**TMDB_DETAIL, "id": 5, "runtime": 12}, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        result, _ = enricher.enrich([_movie("Short Film", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 5


def test_a_match_from_older_rules_is_looked_up_again(mock_env):
    cached = _movie(
        "Sense and Sensibility",
        tmdb_id=4584,
        imdb_id="tt0114388",
        enriched_at=_fresh_enriched_at(),
        english_title="Sense and Sensibility",
    )
    mock_session = _session(TMDB_SEARCH, TMDB_DETAIL, TMDB_VIDEOS, TMDB_CREDITS)

    with patch("enricher.requests.Session", return_value=mock_session):
        _, stats = enricher.enrich([_movie("Sense and Sensibility", [_showtime()], imdb_id="tt0114388")], [cached])

    assert stats["tmdb_reenriched_count"] == 1
    assert stats["tmdb_cache_hit_count"] == 0


def test_a_listing_under_the_english_title_reuses_the_cached_film(mock_env):
    """A provider listing the English title finds the film another listed under its Spanish title."""
    cached = _movie(
        "Sentido y sensibilidad",
        tmdb_id=1503762,
        imdb_id="tt13609648",
        enriched_at=_fresh_enriched_at(),
        tmdb_match_version=enricher._MATCH_VERSION,
        english_title="Sense and Sensibility",
    )
    fresh = _movie("Sense and Sensibility", [_showtime()], imdb_id="tt0114388")

    with patch("enricher.requests.Session") as MockSession:
        result, stats = enricher.enrich([fresh], [cached])

    assert stats["tmdb_cache_hit_count"] == 1
    assert result[0]["tmdb_id"] == 1503762
    assert result[0]["imdb_id"] == "tt13609648"
    MockSession.return_value.get.assert_not_called()


def _routed_session(routes: dict[str, dict[str, Any]]) -> MagicMock:
    """A TMDb session answering by URL suffix (search queries by their `query` param)."""

    def get(url: str, params: dict[str, str], timeout: int) -> MagicMock:
        key = params["query"] if url.endswith("/search/movie") else url.split("/3/", 1)[1]
        payload = routes.get(key, {"results": []})
        return MagicMock(status_code=200, json=lambda: payload, raise_for_status=lambda: None)

    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_session.get.side_effect = get
    return mock_session


def test_every_provider_copy_of_a_remade_title_lands_on_one_film(mock_env):
    """
    The Sense and Sensibility split: the secondary feed tagged a preview
    with the 1995 film's imdb_id, so collection kept two English-titled copies,
    and SensaCine lists the Spanish title. All three must end up as the 2026 film.
    """
    preview = Showtime(cinema="Balmes", neighborhood="", address="", date="2026-10-22", time="20:00")
    run = Showtime(cinema="Balmes", neighborhood="", address="", date="2026-10-23", time="16:00")
    renoir = Showtime(
        cinema="RenFlo", neighborhood="", address="", date="2026-10-23", time="19:00", booking_url="https://pillalas"
    )
    collected = reconcile(
        [
            _movie("Sense and Sensibility", [preview, renoir]),  # englishcinemabarcelona: no imdb_id
            _movie("Sense and Sensibility", [preview], imdb_id="tt0114388"),  # secondary, mis-tagged
            _movie("Sense and Sensibility", [run], imdb_id="tt13609648"),  # secondary
            _movie("Sentido y sensibilidad", [preview, renoir]),  # sensacine
        ]
    )
    assert len(collected) == 3

    film_2026 = {
        **TMDB_DETAIL,
        "id": 1503762,
        "imdb_id": "tt13609648",
        "title": "Sense and Sensibility",
        "release_dates": _spanish_release(_days_ago(-3)),
    }
    search = {
        "results": [
            {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13"},
            {"id": 1503762, "title": "Sense and Sensibility", "release_date": _days_ago(30)},
        ]
    }
    mock_session = _routed_session(
        {
            "Sense and Sensibility": search,
            "Sentido y sensibilidad": {"results": search["results"][::-1]},
            "movie/1503762": film_2026,
            "movie/4584": {**TMDB_DETAIL, "id": 4584, "imdb_id": "tt0114388"},
        }
    )

    with patch("enricher.requests.Session", return_value=mock_session):
        enriched, _ = enricher.enrich(collected, [])
    [film] = reconcile(enriched)

    assert film["tmdb_id"] == 1503762
    assert [(s["date"], s["time"]) for s in film["showtimes"]] == [
        ("2026-10-22", "20:00"),
        ("2026-10-23", "16:00"),
        ("2026-10-23", "19:00"),
    ]
    assert film["showtimes"][2]["booking_url"] == "https://pillalas"
