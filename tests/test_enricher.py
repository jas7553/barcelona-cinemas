"""Tests for enricher.py — TMDb cache reuse and metadata merging."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import enricher
import listings_config
from models import Movie, Showtime


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


# ── Matching rules: never a short or a TV movie, the cinema's year, a feature's runtime ──


def _ok(payload: Any) -> MagicMock:
    return MagicMock(status_code=200, json=lambda: payload, raise_for_status=lambda: None)


def _session_answering(search: dict[str, Any], details: dict[int, dict[str, Any]]) -> MagicMock:
    """A TMDb session: the search answers `search`, /movie/{id} answers `details[id]`."""
    session = MagicMock()
    session.__enter__ = MagicMock(return_value=session)
    session.__exit__ = MagicMock(return_value=False)

    def _get(url: str, **_kwargs: Any) -> MagicMock:
        if url.endswith("/search/movie"):
            return _ok(search)
        if url.endswith("/videos") or url.endswith("/credits"):
            return _ok({})
        return _ok(details[int(url.rsplit("/", 1)[1])])

    session.get.side_effect = _get
    return session


def _detail(tmdb_id: int, year: int, runtime: int, *genres: str) -> dict[str, Any]:
    return {
        "id": tmdb_id,
        "release_date": f"{year}-01-01",
        "runtime": runtime,
        "genres": [{"id": 10770 if g == "TV Movie" else 18, "name": g} for g in genres],
        "vote_average": 7.5,
        "vote_count": 900,
    }


def _detail_urls(session: MagicMock) -> list[str]:
    return [c.args[0] for c in session.get.call_args_list if "/movie/" in c.args[0] and "search" not in c.args[0]]


def test_a_short_sharing_the_title_is_skipped_for_the_feature(mock_env):
    """Stranger Than Paradise: TMDb ranks the 1982 32-minute short first."""
    search = {
        "results": [
            {"id": 410051, "title": "Stranger Than Paradise", "release_date": "1982-01-01"},
            {"id": 469, "title": "Stranger Than Paradise", "release_date": "1984-10-01"},
        ]
    }
    session = _session_answering(search, {410051: _detail(410051, 1982, 32), 469: _detail(469, 1984, 89, "Comedy")})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("Stranger Than Paradise", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 469
    assert result[0]["year"] == 1984
    assert result[0]["runtime_mins"] == 89


def test_a_tv_movie_is_never_matched(mock_env):
    """The Miracle Worker: the 2000 TV movie is dropped from the search results unfetched."""
    search = {
        "results": [
            {"id": 1163, "title": "The Miracle Worker", "release_date": "2000-10-01", "genre_ids": [10770, 18]},
            {"id": 1162, "title": "The Miracle Worker", "release_date": "1962-05-23", "genre_ids": [18]},
        ]
    }
    session = _session_answering(search, {1162: _detail(1162, 1962, 106, "Drama")})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("The Miracle Worker", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 1162
    assert result[0]["year"] == 1962
    assert not any(url.endswith("/1163") for url in _detail_urls(session))


def test_a_tv_movie_genre_on_the_detail_is_rejected_too(mock_env):
    """Search results do not always carry genre_ids; the detail's genres are the backstop."""
    search = {"results": [{"id": 1163, "title": "The Miracle Worker"}, {"id": 1162, "title": "The Miracle Worker"}]}
    details = {1163: _detail(1163, 2000, 90, "TV Movie"), 1162: _detail(1162, 1962, 106, "Drama")}
    session = _session_answering(search, details)

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("The Miracle Worker", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 1162


def test_the_cinema_year_picks_between_features_sharing_a_title(mock_env):
    search = {
        "results": [
            {"id": 2, "title": "Wuthering Heights", "release_date": "2026-02-13"},
            {"id": 1, "title": "Wuthering Heights", "release_date": "1939-04-07"},
        ]
    }
    session = _session_answering(search, {1: _detail(1, 1939, 104), 2: _detail(2, 2026, 136)})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("Wuthering Heights", [_showtime()], year=1939)], [])

    assert result[0]["tmdb_id"] == 1
    assert _detail_urls(session)[0].endswith("/movie/1")


def test_an_exact_title_beats_an_earlier_partial_match(mock_env):
    search = {"results": [{"id": 7, "title": "Paradise Road"}, {"id": 469, "title": "Stranger Than Paradise"}]}
    session = _session_answering(search, {7: _detail(7, 1997, 122), 469: _detail(469, 1984, 89)})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("Stranger Than Paradise", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 469


def test_unknown_runtime_is_not_taken_for_a_short(mock_env):
    """TMDb reports 0 minutes for a film whose runtime it does not know yet."""
    session = _session_answering({"results": [{"id": 5, "title": "New Film"}]}, {5: _detail(5, 2026, 0)})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("New Film", [_showtime()])], [])

    assert result[0]["tmdb_id"] == 5


def test_only_shorts_means_no_match(mock_env):
    session = _session_answering({"results": [{"id": 9, "title": "Tiny"}]}, {9: _detail(9, 2020, 12)})

    with patch("enricher.requests.Session", return_value=session):
        result, stats = enricher.enrich([_movie("Tiny", [_showtime()])], [])

    assert result[0]["tmdb_id"] is None
    assert stats["tmdb_failure_count"] == 0


def test_a_cached_short_is_looked_up_again_and_never_kept(mock_env):
    """A wrong match cached before the rules existed is redone at once, not after the TTL."""
    cached = _movie(
        "Stranger Than Paradise", tmdb_id=410051, runtime_mins=32, year=1982, enriched_at=_fresh_enriched_at()
    )
    search = {
        "results": [
            {"id": 410051, "title": "Stranger Than Paradise"},
            {"id": 469, "title": "Stranger Than Paradise"},
        ]
    }
    session = _session_answering(search, {410051: _detail(410051, 1982, 32), 469: _detail(469, 1984, 89)})

    with patch("enricher.requests.Session", return_value=session):
        result, stats = enricher.enrich([_movie("Stranger Than Paradise", [_showtime()])], [cached])

    assert result[0]["tmdb_id"] == 469
    assert stats["tmdb_cache_hit_count"] == 0


def test_a_cached_tv_movie_is_dropped_even_when_the_lookup_finds_nothing(mock_env):
    cached = _movie("The Miracle Worker", tmdb_id=1163, genres=["TV Movie", "Drama"], enriched_at=_fresh_enriched_at())
    session = _session_answering({"results": []}, {})

    with patch("enricher.requests.Session", return_value=session):
        result, _ = enricher.enrich([_movie("The Miracle Worker", [_showtime()])], [cached])

    assert result[0]["tmdb_id"] is None


def test_a_cache_hit_takes_the_rerelease_flag_from_this_run(mock_env):
    cached = _movie("Avengers: Endgame", tmdb_id=299534, runtime_mins=181, enriched_at=_fresh_enriched_at())
    fresh: Movie = {**_movie("Avengers: Endgame", [_showtime()]), "rerelease": True}

    with patch("enricher.requests.Session"):
        (flagged,), _ = enricher.enrich([fresh], [cached])
        (plain,), _ = enricher.enrich([_movie("Avengers: Endgame", [_showtime()])], [flagged])

    assert flagged["rerelease"] is True
    assert "rerelease" not in plain
