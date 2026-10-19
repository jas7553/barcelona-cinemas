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
        m["match_version"] = kwargs.get("match_version", enricher.MATCH_VERSION)
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


# ── Matching ─────────────────────────────────────────────────────────────────


class FakeTmdb:
    """A TMDb stand-in routed on URL path, recording every path requested."""

    def __init__(
        self,
        *,
        searches: dict[str, list[dict[str, Any]]] | None = None,
        details: dict[int, dict[str, Any]] | None = None,
        finds: dict[str, list[dict[str, Any]]] | None = None,
    ) -> None:
        self.searches = searches or {}
        self.details = details or {}
        self.finds = finds or {}
        self.paths: list[str] = []

    def get(self, url: str, params: dict[str, str], timeout: int) -> MagicMock:
        path = url.removeprefix(enricher._BASE_URL)
        self.paths.append(path if path != "/search/movie" else f"/search/movie?{params['query']}")
        parts = path.strip("/").split("/")
        if parts[0] == "search":
            body: dict[str, Any] = {"results": self.searches.get(params["query"], [])}
        elif parts[0] == "find":
            body = {"movie_results": self.finds.get(parts[1], [])}
        elif len(parts) == 2:
            body = self.details[int(parts[1])]
        else:
            body = {}
        return MagicMock(json=lambda: body, raise_for_status=lambda: None)

    def __enter__(self) -> "FakeTmdb":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def mount(self, *args: object) -> None:
        return None


def _detail(tmdb_id: int, title: str, year: int, runtime: int, *genres: str) -> dict[str, Any]:
    return {
        "id": tmdb_id,
        "title": title,
        "imdb_id": f"tt{tmdb_id:07d}",
        "release_date": f"{year}-01-01",
        "runtime": runtime,
        "genres": [{"id": i, "name": name} for i, name in enumerate(genres or ("Drama",))],
        "vote_average": 7.0,
        "vote_count": 500,
        "original_language": "en",
    }


def _result(tmdb_id: int, title: str, year: int, *genre_ids: int) -> dict[str, Any]:
    return {"id": tmdb_id, "title": title, "release_date": f"{year}-05-01", "genre_ids": list(genre_ids)}


def _enrich_one(movie: Movie, tmdb: FakeTmdb) -> Movie:
    with patch("enricher.requests.Session", return_value=tmdb):
        [result], _ = enricher.enrich([movie], [])
    return result


def _hinted(title: str, **hints: Any) -> Movie:
    movie = _movie(title, showtimes=[_showtime()], imdb_id=hints.pop("imdb_id", None))
    movie.update(hints)  # type: ignore[typeddict-item]
    return movie


def test_imdb_id_from_the_source_is_looked_up_directly(mock_env):
    # The Miracle Worker: title search found the 2000 TV movie; ECB gives tt0056241.
    tmdb = FakeTmdb(
        finds={"tt0056241": [{"id": 1162}]},
        details={1162: {**_detail(1162, "The Miracle Worker", 1962, 106), "imdb_id": "tt0056241"}},
    )
    result = _enrich_one(_hinted("The Miracle Worker", imdb_id="tt0056241"), tmdb)

    assert result["tmdb_id"] == 1162
    assert result["year"] == 1962
    assert not any(path.startswith("/search") for path in tmdb.paths)


def test_imdb_id_unknown_to_tmdb_falls_back_to_search(mock_env):
    tmdb = FakeTmdb(
        searches={"Pressure": [_result(7, "Pressure", 2026)]},
        details={7: _detail(7, "Pressure", 2026, 101)},
    )
    result = _enrich_one(_hinted("Pressure", imdb_id="tt9999999"), tmdb)

    assert result["tmdb_id"] == 7
    assert result["imdb_id"] == "tt0000007"


def test_imdb_id_of_a_tv_movie_falls_back_to_search(mock_env):
    tmdb = FakeTmdb(
        finds={"tt0246786": [{"id": 1163}]},
        searches={"The Miracle Worker": [_result(1162, "The Miracle Worker", 1962)]},
        details={
            1163: _detail(1163, "The Miracle Worker", 2000, 95, "Drama", "TV Movie"),
            1162: _detail(1162, "The Miracle Worker", 1962, 106),
        },
    )
    assert _enrich_one(_hinted("The Miracle Worker", imdb_id="tt0246786"), tmdb)["tmdb_id"] == 1162


def test_tv_movies_are_never_matched(mock_env):
    tmdb = FakeTmdb(
        searches={
            "The Miracle Worker": [
                _result(1163, "The Miracle Worker", 2000, 18, 10770),
                _result(1162, "The Miracle Worker", 1962, 18),
            ]
        },
        details={1162: _detail(1162, "The Miracle Worker", 1962, 106)},
    )
    assert _enrich_one(_hinted("The Miracle Worker"), tmdb)["tmdb_id"] == 1162


def test_tv_movie_genre_on_the_detail_is_rejected_too(mock_env):
    tmdb = FakeTmdb(
        searches={"Gala": [_result(1, "Gala", 2020)]},
        details={1: _detail(1, "Gala", 2020, 90, "TV Movie")},
    )
    assert _enrich_one(_hinted("Gala"), tmdb)["tmdb_id"] is None


def test_shorts_are_never_matched(mock_env):
    # Stranger Than Paradise: the 32-minute short ranked above the 1984 feature.
    tmdb = FakeTmdb(
        searches={
            "Stranger Than Paradise": [
                _result(410051, "Stranger Than Paradise", 1983),
                _result(469, "Stranger Than Paradise", 1984),
            ]
        },
        details={
            410051: _detail(410051, "Stranger Than Paradise", 1983, 32),
            469: _detail(469, "Stranger Than Paradise", 1984, 89),
        },
    )
    result = _enrich_one(_hinted("Stranger Than Paradise"), tmdb)

    assert result["tmdb_id"] == 469
    assert result["runtime_mins"] == 89


def test_source_year_rules_out_other_films_of_the_same_title(mock_env):
    # Sense and Sensibility: ECB lists the 2026 film; title search matched 1995.
    tmdb = FakeTmdb(
        searches={
            "Sense and Sensibility": [
                _result(4584, "Sense and Sensibility", 1995),
                _result(1503762, "Sense and Sensibility", 2026),
            ]
        },
        details={1503762: _detail(1503762, "Sense and Sensibility", 2026, 132)},
    )
    result = _enrich_one(_hinted("Sense and Sensibility", source_year=2026), tmdb)

    assert result["tmdb_id"] == 1503762
    assert "/movie/4584" not in tmdb.paths


def test_no_candidate_in_the_source_year_leaves_the_film_unmatched(mock_env):
    tmdb = FakeTmdb(
        searches={"Rachel": [_result(5, "Rachel", 2009)]},
        details={5: _detail(5, "Rachel", 2009, 100)},
    )
    assert _enrich_one(_hinted("Rachel", source_year=2026), tmdb)["tmdb_id"] is None


def test_a_result_with_no_release_date_yet_stays_a_candidate(mock_env):
    # TMDb often has no date for a new release; ECB gives one for every film.
    tmdb = FakeTmdb(
        searches={"Rachel": [{**_result(5, "Rachel", 2026), "release_date": ""}]},
        details={5: {**_detail(5, "Rachel", 2026, 100), "release_date": ""}},
    )
    assert _enrich_one(_hinted("Rachel", source_year=2026), tmdb)["tmdb_id"] == 5


def test_a_dated_result_ranks_above_an_undated_one(mock_env):
    tmdb = FakeTmdb(
        searches={"Rachel": [{**_result(1, "Rachel", 2026), "release_date": ""}, _result(2, "Rachel", 2026)]},
        details={1: _detail(1, "Rachel", 2026, 100), 2: _detail(2, "Rachel", 2026, 100)},
    )
    assert _enrich_one(_hinted("Rachel", source_year=2026), tmdb)["tmdb_id"] == 2


def test_runtime_picks_between_films_sharing_a_title(mock_env):
    tmdb = FakeTmdb(
        searches={"Pressure": [_result(1, "Pressure", 2026), _result(2, "Pressure", 2026)]},
        details={1: _detail(1, "Pressure", 2026, 85), 2: _detail(2, "Pressure", 2026, 101)},
    )
    assert _enrich_one(_hinted("Pressure", source_runtime_mins=101), tmdb)["tmdb_id"] == 2


def test_no_runtime_fit_falls_back_to_the_first_feature(mock_env):
    tmdb = FakeTmdb(
        searches={"Pressure": [_result(1, "Pressure", 2026), _result(2, "Pressure", 2026)]},
        details={1: _detail(1, "Pressure", 2026, 85), 2: _detail(2, "Pressure", 2026, 140)},
    )
    assert _enrich_one(_hinted("Pressure", source_runtime_mins=101), tmdb)["tmdb_id"] == 1


def test_detail_lookups_are_capped(mock_env):
    tmdb = FakeTmdb(
        searches={"Pressure": [_result(i, "Pressure", 2026) for i in range(1, 7)]},
        details={i: _detail(i, "Pressure", 2026, 20) for i in range(1, 7)},
    )
    assert _enrich_one(_hinted("Pressure"), tmdb)["tmdb_id"] is None
    assert sum(1 for path in tmdb.paths if path.startswith("/movie/")) == enricher._MAX_DETAIL_LOOKUPS


def test_exact_title_outranks_tmdb_order(mock_env):
    tmdb = FakeTmdb(
        searches={"Digger": [_result(1, "The Digger", 2026), _result(2, "Digger", 2026)]},
        details={1: _detail(1, "The Digger", 2026, 100), 2: _detail(2, "Digger", 2026, 129)},
    )
    assert _enrich_one(_hinted("Digger"), tmdb)["tmdb_id"] == 2


def test_original_title_is_searched_before_the_local_title(mock_env):
    # "El precio de la red" matched Ida Red (2021); SensaCine's original title is exact.
    tmdb = FakeTmdb(
        searches={
            "The Social Reckoning": [_result(1281331, "The Social Reckoning", 2026)],
            "El precio de la red": [_result(818192, "Ida Red", 2021)],
        },
        details={1281331: _detail(1281331, "The Social Reckoning", 2026, 112)},
    )
    result = _enrich_one(_hinted("El precio de la red", original_title="The Social Reckoning"), tmdb)

    assert result["tmdb_id"] == 1281331
    assert "/search/movie?El precio de la red" not in tmdb.paths


def test_local_title_is_searched_when_the_original_title_finds_nothing(mock_env):
    tmdb = FakeTmdb(
        searches={"Vengadores: Endgame": [_result(299534, "Avengers: Endgame", 2019)]},
        details={299534: _detail(299534, "Avengers: Endgame", 2019, 181)},
    )
    result = _enrich_one(_hinted("Vengadores: Endgame", original_title="Avengers Endgame"), tmdb)

    assert result["tmdb_id"] == 299534


# ── Re-matching cached films ─────────────────────────────────────────────────


def _cached_match(title: str, tmdb_id: int, **fields: Any) -> Movie:
    return _movie(title, tmdb_id=tmdb_id, enriched_at=_fresh_enriched_at(), **fields)


def _enrich_with_cache(movie: Movie, cached: Movie, tmdb: FakeTmdb) -> Movie:
    with patch("enricher.requests.Session", return_value=tmdb):
        [result], _ = enricher.enrich([movie], [cached])
    return result


def test_new_enrichment_is_stamped_with_the_match_version(mock_env):
    tmdb = FakeTmdb(
        searches={"Pressure": [_result(7, "Pressure", 2026)]}, details={7: _detail(7, "Pressure", 2026, 101)}
    )
    assert _enrich_one(_hinted("Pressure"), tmdb).get("match_version") == enricher.MATCH_VERSION


def test_older_match_version_is_rematched_inside_the_ttl(mock_env):
    stale = _cached_match("Stranger Than Paradise", 410051, imdb_id="tt0209182", runtime_mins=32, match_version=1)
    tmdb = FakeTmdb(
        searches={"Stranger Than Paradise": [_result(469, "Stranger Than Paradise", 1984)]},
        details={469: _detail(469, "Stranger Than Paradise", 1984, 89)},
    )
    result = _enrich_with_cache(_hinted("Stranger Than Paradise"), stale, tmdb)

    assert result["tmdb_id"] == 469


def test_older_match_english_title_is_not_searched(mock_env):
    stale = _cached_match("El precio de la red", 818192, match_version=1)
    stale["english_title"] = "Ida Red"
    tmdb = FakeTmdb(searches={"Ida Red": [_result(818192, "Ida Red", 2021)]}, details={})
    result = _enrich_with_cache(_hinted("El precio de la red"), stale, tmdb)

    assert "/search/movie?Ida Red" not in tmdb.paths
    # The current rules found nothing, so the old match is dropped rather than kept.
    assert result["tmdb_id"] is None


def test_older_match_is_kept_through_a_network_failure(mock_env):
    stale = _cached_match("Pressure", 7, synopsis="Kept", match_version=1)
    failing = MagicMock()
    failing.__enter__ = MagicMock(return_value=failing)
    failing.__exit__ = MagicMock(return_value=False)
    failing.get.side_effect = ConnectionError("down")
    with patch("enricher.requests.Session", return_value=failing):
        [result], stats = enricher.enrich([_hinted("Pressure")], [stale])

    assert result["synopsis"] == "Kept"
    assert stats["tmdb_failure_count"] == 1


def test_cached_title_match_with_another_imdb_id_is_not_reused(mock_env):
    # The cache holds the 2000 TV movie; the source now names the 1962 film.
    cached = _cached_match("The Miracle Worker", 1163, imdb_id="tt0246786")
    tmdb = FakeTmdb(
        finds={"tt0056241": [{"id": 1162}]},
        details={1162: {**_detail(1162, "The Miracle Worker", 1962, 106), "imdb_id": "tt0056241"}},
    )
    result = _enrich_with_cache(_hinted("The Miracle Worker", imdb_id="tt0056241"), cached, tmdb)

    assert result["tmdb_id"] == 1162


def test_cache_hit_takes_this_runs_source_fields(mock_env):
    cached = _cached_match("Avengers: Endgame", 299534, imdb_id="tt4154796")
    cached["source_year"] = 2019
    cached["rerelease"] = True
    fresh = _hinted("Avengers: Endgame", imdb_id="tt4154796", source_runtime_mins=181)
    result = _enrich_with_cache(fresh, cached, FakeTmdb())

    assert result["tmdb_id"] == 299534
    assert result.get("source_runtime_mins") == 181
    assert "source_year" not in result
    assert "rerelease" not in result


def test_match_off_the_source_runtime_is_logged(mock_env, find_event):
    tmdb = FakeTmdb(
        finds={"tt1": [{"id": 1}]},
        details={1: {**_detail(1, "Pressure", 2026, 140), "imdb_id": "tt1"}},
    )
    _enrich_one(_hinted("Pressure", imdb_id="tt1", source_runtime_mins=101), tmdb)

    event = find_event("tmdb_match_disagrees")
    assert event["runtime_mins"] == 140
    assert event["source_runtime_mins"] == 101
