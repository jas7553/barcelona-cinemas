"""
Tests for refresh.py — the refresh ritual behind one interface.

Everything here goes through `build_listings`, because the ordering it owns
(collection → Reconciliation → Enrichment → Reconciliation → English filter) is
the thing worth pinning: the old five-step sequence lived inline in
`pipeline._refresh` and was patched out of every test that reached it.

Enrichment is injected. The default is `enricher.enrich`, which talks to TMDb;
the stubs here stand in for it so a test can say exactly what Enrichment did or
failed to do and then assert on where that lands in `RefreshStats`.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest

import cache
import refresh
from enricher import EnrichmentStats
from models import Listings, Movie

from .conftest import FindEvent

NOW = datetime(2026, 3, 27, 9, 0, tzinfo=UTC)

_NO_ENRICHMENT: EnrichmentStats = {
    "tmdb_enriched_count": 0,
    "tmdb_reenriched_count": 0,
    "tmdb_cache_hit_count": 0,
    "tmdb_failure_count": 0,
}


# ── builders ──────────────────────────────────────────────────────────────────


def _showtime(**overrides: Any) -> dict[str, Any]:
    return {
        "cinema": "Verdi",
        "neighborhood": "Gracia",
        "address": "Carrer de Verdi, 32",
        "date": "2026-03-28",
        "time": "18:00",
        **overrides,
    }


def _raw_movie(title: str, showtimes: list[dict[str, Any]] | None = None, **overrides: Any) -> dict[str, Any]:
    """A Movie as a Provider emits it — untyped, pre-validation."""
    return {
        "title": title,
        "tmdb_id": None,
        "imdb_id": None,
        "year": None,
        "poster_url": None,
        "synopsis": None,
        "rating": None,
        "runtime_mins": None,
        "genres": None,
        "showtimes": [_showtime()] if showtimes is None else showtimes,
        **overrides,
    }


def _provider(name: str, movies: list[dict[str, Any]] | None = None, **kwargs: Any) -> MagicMock:
    provider = MagicMock()
    provider.name = name
    if "fetch" in kwargs:
        provider.fetch.side_effect = kwargs["fetch"]
    else:
        provider.fetch.return_value = movies or []
    return provider


def _no_enrichment(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
    """Enrichment that does nothing — isolates the Reconciliation passes."""
    return movies, _NO_ENRICHMENT.copy()


def _build(providers: list[Any], **kwargs: Any) -> tuple[Listings, refresh.RefreshStats]:
    return refresh.build_listings(
        providers,
        kwargs.pop("cinemas", {}),
        kwargs.pop("cached", None),
        kwargs.pop("now", NOW),
        enrich=kwargs.pop("enrich", _no_enrichment),
        **kwargs,
    )


# ── the interface ─────────────────────────────────────────────────────────────


def test_build_listings_stamps_fetched_at_from_the_injected_clock():
    """No wall clock inside the build — the caller supplies the instant."""
    listings, _ = _build([_provider("one", [_raw_movie("Dune: Part Two")])])

    assert listings["fetched_at"] == NOW.isoformat()
    assert listings["stale"] is False


def test_build_listings_does_no_cache_io():
    """The cache read and write belong to pipeline._refresh, not to the build."""
    with (
        patch.object(cache, "read", side_effect=AssertionError("build_listings read the cache")),
        patch.object(cache, "write", side_effect=AssertionError("build_listings wrote the cache")),
    ):
        _build([_provider("one", [_raw_movie("Dune: Part Two")])])


def test_build_listings_seeds_enrichment_with_the_cached_movies() -> None:
    """The previous refresh's Movies are how Enrichment avoids re-querying TMDb."""
    cached_movie = _raw_movie("Dune: Part Two", imdb_id="tt15239678")
    seen: list[list[Movie]] = []

    def _spy(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        seen.append(cached_movies)
        return movies, _NO_ENRICHMENT.copy()

    cached: Listings = {
        "fetched_at": "2026-03-26T09:00:00+00:00",
        "stale": False,
        "movies": [cast(Movie, cached_movie)],
    }
    _build([_provider("one", [_raw_movie("Dune: Part Two")])], cached=cached, enrich=_spy)

    assert seen == [[cached_movie]]


def test_build_listings_tolerates_a_cold_cache():
    listings, stats = _build([_provider("one", [_raw_movie("Dune: Part Two")])], cached=None)

    assert stats["published_movie_count"] == 1
    assert listings["movies"][0]["title"] == "Dune: Part Two"


# ── Reconciliation runs twice ─────────────────────────────────────────────────


def test_reconciliation_runs_again_after_enrichment_and_merges_on_imdb_id_alone():
    """
    The load-bearing reason the second pass exists.

    Two Providers list the same film under titles that never normalize to each
    other, so collection's title-keyed Reconciliation cannot merge them. TMDb
    resolves both to one imdb_id, and only the post-Enrichment pass can act on
    that.
    """
    providers = [
        _provider("one", [_raw_movie("Wuthering Heights", [_showtime(date="2026-03-28", time="18:00")])]),
        _provider("two", [_raw_movie("Cumbres Borrascosas", [_showtime(date="2026-03-29", time="20:00")])]),
    ]

    def _assign_one_imdb_id(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        enriched = [{**m, "imdb_id": "tt32897959", "original_lang": "en"} for m in movies]
        return enriched, {**_NO_ENRICHMENT, "tmdb_enriched_count": len(movies)}  # type: ignore[return-value]

    listings, stats = _build(providers, enrich=_assign_one_imdb_id)

    assert stats["collected_movie_count"] == 2  # the title pass could not merge them
    assert stats["post_enrichment_merged_count"] == 1
    assert len(listings["movies"]) == 1
    assert len(listings["movies"][0]["showtimes"]) == 2


def test_collection_reconciliation_merges_on_title_before_enrichment():
    """The first pass, which is all that runs when TMDb adds nothing."""
    providers = [
        _provider("one", [_raw_movie("Project Hail Mary", [_showtime(date="2026-03-28")])]),
        _provider(
            "two",
            [_raw_movie("Project Hail Mary", [_showtime(date="2026-03-29", time="20:00")], imdb_id="tt12042730")],
        ),
    ]

    listings, stats = _build(providers)

    assert stats["raw_movie_count"] == 2
    assert stats["collection_merged_count"] == 1
    assert stats["post_enrichment_merged_count"] == 0
    assert listings["movies"][0]["imdb_id"] == "tt12042730"
    assert len(listings["movies"][0]["showtimes"]) == 2


def test_collection_keeps_conflicting_imdb_ids_split_even_when_titles_normalize():
    """Two different films can share a title; the imdb_id branch keeps them apart."""
    providers = [
        _provider("one", [_raw_movie('"Wuthering Heights"', imdb_id="tt32897959", year=2026)]),
        _provider(
            "two",
            [_raw_movie("Wuthering Heights", [_showtime(cinema="Balmes", date="2026-03-29")], imdb_id="tt0104181")],
        ),
    ]

    listings, stats = _build(providers)

    assert {movie["imdb_id"] for movie in listings["movies"]} == {"tt32897959", "tt0104181"}
    assert stats["collection_merged_count"] == 0


def test_collection_merges_quoted_and_unquoted_titles():
    providers = [
        _provider("one", [_raw_movie('"Wuthering Heights"', [_showtime(date="2026-03-28")])]),
        _provider("two", [_raw_movie("Wuthering Heights", [_showtime(date="2026-03-29")], imdb_id="tt32897959")]),
    ]

    listings, _ = _build(providers)

    assert len(listings["movies"]) == 1
    assert listings["movies"][0]["imdb_id"] == "tt32897959"


def test_collection_dedups_showtimes_across_providers_and_keeps_the_booking_link():
    """The per-showtime booking link is the product's primary CTA; a dedup must not eat it."""
    providers = [
        _provider("one", [_raw_movie("Project Hail Mary", [_showtime(booking_url="https://tickets.example/seats/1")])]),
        _provider("two", [_raw_movie("Project Hail Mary", [_showtime(language="vo")])]),
    ]

    listings, _ = _build(providers)

    showtimes = listings["movies"][0]["showtimes"]
    assert len(showtimes) == 1
    assert showtimes[0]["booking_url"] == "https://tickets.example/seats/1"
    assert showtimes[0]["language"] == "vo"


def test_collection_drops_invalid_movies_and_showtimes():
    """Provider output is normalized before anything downstream sees it."""
    provider = _provider(
        "one",
        [
            _raw_movie("Valid Film", [_showtime(), _showtime(date="bad-date")]),
            _raw_movie("", []),
        ],
    )

    listings, _ = _build([provider])

    assert [movie["title"] for movie in listings["movies"]] == ["Valid Film"]
    assert listings["movies"][0]["showtimes"] == [_showtime()]


# ── the English filter ────────────────────────────────────────────────────────


def test_non_english_movie_survives_collection_then_the_filter_drops_it_and_says_so():
    """
    `original_lang` only exists after Enrichment, which is why the filter runs
    last. Until then the film is indistinguishable from an English one.
    """
    providers = [
        _provider("one", [_raw_movie("Dune: Part Two")]),
        _provider("two", [_raw_movie("El drama", [_showtime(cinema="Balmes")])]),
    ]

    def _tag_languages(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        langs = {"Dune: Part Two": "en", "El drama": "es"}
        enriched = [{**m, "original_lang": langs[m["title"]]} for m in movies]
        return enriched, {**_NO_ENRICHMENT, "tmdb_enriched_count": 2}  # type: ignore[return-value]

    listings, stats = _build(providers, enrich=_tag_languages)

    assert stats["collected_movie_count"] == 2  # it survived collection and Reconciliation
    assert stats["non_english_dropped_count"] == 1
    assert stats["published_movie_count"] == 1
    assert [movie["title"] for movie in listings["movies"]] == ["Dune: Part Two"]


def test_filter_keeps_unknown_original_lang():
    """Absent `original_lang` means 'we don't know', not 'not English'."""
    listings, stats = _build([_provider("one", [_raw_movie("Mystery Film")])])

    assert stats["non_english_dropped_count"] == 0
    assert len(listings["movies"]) == 1


# ── Enrichment failure ────────────────────────────────────────────────────────


def test_enrichment_failure_leaves_partial_data_and_is_counted_in_the_stats():
    """
    The enricher never raises; it returns what it managed plus a failure count.
    That count used to be discarded, so a refresh in which TMDb was down for
    every Movie looked exactly like a healthy one.
    """

    def _all_lookups_fail(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        return movies, {**_NO_ENRICHMENT, "tmdb_failure_count": len(movies)}

    listings, stats = _build(
        [_provider("one", [_raw_movie("Dune: Part Two"), _raw_movie("Sinners", [_showtime(time="21:00")])])],
        enrich=_all_lookups_fail,
    )

    assert stats["tmdb_failure_count"] == 2
    assert stats["published_movie_count"] == 2  # partial data still ships
    assert all(movie["poster_url"] is None for movie in listings["movies"])


def test_enrichment_counts_are_folded_into_the_refresh_stats():
    def _mixed(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        stats: EnrichmentStats = {
            "tmdb_enriched_count": 1,
            "tmdb_reenriched_count": 2,
            "tmdb_cache_hit_count": 3,
            "tmdb_failure_count": 4,
        }
        return movies, stats

    _, stats = _build([_provider("one", [_raw_movie("Dune: Part Two")])], enrich=_mixed)

    assert stats["tmdb_enriched_count"] == 1
    assert stats["tmdb_reenriched_count"] == 2
    assert stats["tmdb_cache_hit_count"] == 3
    assert stats["tmdb_failure_count"] == 4


# ── stats arithmetic ──────────────────────────────────────────────────────────


def test_stats_account_for_every_movie_between_collection_and_publication():
    """
    One run that loses a Movie at each of the three reductions. If the equation
    stops closing, some drop has gone unaccounted.
    """
    providers = [
        _provider(
            "one",
            [
                _raw_movie("Project Hail Mary", [_showtime(date="2026-03-28")]),
                _raw_movie("Wuthering Heights", [_showtime(date="2026-03-28", time="20:00")]),
                _raw_movie("El drama", [_showtime(cinema="Balmes")]),
            ],
        ),
        _provider("two", [_raw_movie("Project Hail Mary", [_showtime(date="2026-03-29")])]),
        _provider("three", [_raw_movie("Cumbres Borrascosas", [_showtime(date="2026-03-30", time="20:00")])]),
    ]

    def _enrich(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        by_title = {
            "Project Hail Mary": ("tt12042730", "en"),
            "Wuthering Heights": ("tt32897959", "en"),
            "Cumbres Borrascosas": ("tt32897959", "en"),
            "El drama": ("tt99999999", "es"),
        }
        enriched = []
        for movie in movies:
            imdb_id, lang = by_title[movie["title"]]
            enriched.append({**movie, "imdb_id": imdb_id, "original_lang": lang})
        return enriched, {**_NO_ENRICHMENT, "tmdb_enriched_count": len(movies)}  # type: ignore[return-value]

    listings, stats = _build(providers, enrich=_enrich)

    assert stats["raw_movie_count"] == 5
    assert stats["collection_merged_count"] == 1  # the two Project Hail Mary copies
    assert stats["collected_movie_count"] == 4
    assert stats["post_enrichment_merged_count"] == 1  # the two Wuthering Heights titles
    assert stats["non_english_dropped_count"] == 1  # El drama
    assert stats["published_movie_count"] == 2
    assert (
        stats["raw_movie_count"]
        - stats["collection_merged_count"]
        - stats["post_enrichment_merged_count"]
        - stats["non_english_dropped_count"]
        == stats["published_movie_count"]
    )
    assert stats["published_showtime_count"] == sum(len(m["showtimes"]) for m in listings["movies"])


def test_stats_count_provider_successes_and_failures():
    providers = [
        _provider("one", [_raw_movie("Dune: Part Two")]),
        _provider("two", fetch=RuntimeError("down")),
        _provider("three", []),
    ]

    _, stats = _build(providers)

    assert stats["provider_success_count"] == 2  # the zero-result provider still succeeded
    assert stats["provider_failure_count"] == 1


# ── Provider fan-out ──────────────────────────────────────────────────────────


def test_provider_order_is_preserved_regardless_of_completion_order():
    """Providers run in parallel; the reconciled output must not depend on who wins."""
    gate = threading.Event()

    def _slow_fetch(_cinemas: Any) -> list[dict[str, Any]]:
        gate.wait()  # blocks until the second provider has already finished
        return [_raw_movie("From Provider One", imdb_id="tt0000001")]

    def _fast_fetch(_cinemas: Any) -> list[dict[str, Any]]:
        gate.set()
        return [_raw_movie("From Provider Two", [_showtime(cinema="Balmes")], imdb_id="tt0000002")]

    providers = [_provider("one", fetch=_slow_fetch), _provider("two", fetch=_fast_fetch)]

    listings, _ = _build(providers)

    assert [movie["imdb_id"] for movie in listings["movies"]] == ["tt0000001", "tt0000002"]


def test_build_listings_raises_when_every_provider_fails():
    """The caller must be able to leave the old cache in place."""
    providers = [_provider("one", fetch=RuntimeError("down")), _provider("two", fetch=RuntimeError("down"))]

    with pytest.raises(RuntimeError, match="All providers failed"):
        _build(providers)


def test_build_listings_raises_when_providers_answer_but_yield_no_movies():
    with pytest.raises(RuntimeError, match="merge produced no movies"):
        _build([_provider("one", [_raw_movie("", [])])])


def test_build_listings_survives_one_failing_provider():
    providers = [_provider("one", fetch=RuntimeError("down")), _provider("two", [_raw_movie("Valid Film")])]

    listings, _ = _build(providers)

    assert [movie["title"] for movie in listings["movies"]] == ["Valid Film"]


def test_a_provider_that_yields_nothing_emits_its_own_signal(find_event: FindEvent) -> None:
    """A provider that runs clean but returns nothing looks like success without this."""
    _build([_provider("verdi", []), _provider("two", [_raw_movie("Valid Film")])])

    assert find_event("provider_zero_result")["provider"] == "verdi"


# ── metrics ───────────────────────────────────────────────────────────────────


def test_metrics_describe_the_stages_they_name(caplog: pytest.LogCaptureFixture, find_event: FindEvent) -> None:
    """
    `MoviesCollected` used to be emitted between the post-Enrichment
    Reconciliation and the English filter, so it named neither end. It now
    reports the collection stage, and `MoviesPublished` reports what reaches
    the cache.
    """
    providers = [
        _provider("one", [_raw_movie("Dune: Part Two"), _raw_movie("El drama", [_showtime(cinema="Balmes")])]),
    ]

    def _tag_languages(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
        langs = {"Dune: Part Two": "en", "El drama": "es"}
        return [{**m, "original_lang": langs[m["title"]]} for m in movies], _NO_ENRICHMENT.copy()

    _, stats = _build(providers, enrich=_tag_languages)

    assert '"MoviesCollected": 2' in caplog.text
    assert '"MoviesPublished": 1' in caplog.text
    assert '"NonEnglishFiltered": 1' in caplog.text
    assert find_event("refresh_stats")["published_movie_count"] == stats["published_movie_count"]
