"""
The refresh ritual, as one interface.

`build_listings` turns a set of Providers plus the previous cache into fresh
Listings. It owns the step order — collection, Reconciliation, Enrichment,
Reconciliation again, English filter — because that order is load-bearing and
no caller should be able to get it wrong:

  1. Collection reconciles on **title**: pre-Enrichment nobody has an imdb_id
     yet, so titles are the only identity available.
  2. Enrichment fills TMDb metadata, which is where `imdb_id` and
     `original_lang` first appear.
  3. Reconciliation runs a second time so `same_movie`'s imdb_id branch can
     collapse title-variant duplicates the title pass could not see.
  4. The English filter runs last because `original_lang` only exists after
     Enrichment.

There is no I/O in this module beyond the Providers and the Enrichment function
handed to it: no cache read, no cache write, no S3, no SSG invoke. Those live in
`pipeline._refresh`. That matters for one non-obvious dependency in particular:
the Verdi Provider's admit-one sala map is recovered from the *previous*
refresh's cached Showtimes, so the Providers must be constructed from the cache
read that `cached` also comes from — and the cache must not be overwritten until
this function has returned. Taking `cached` as a parameter is what makes that
ordering visible instead of implicit.

Every count the run drops is reported in `RefreshStats`, and the arithmetic
closes:

    raw_movie_count
      - collection_merged_count
      - post_enrichment_merged_count
      - non_english_dropped_count
      == published_movie_count
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from itertools import chain
from typing import TYPE_CHECKING, NamedTuple, Protocol, TypedDict

from models import CinemaRegistry, Listings, Movie
from observability import emit_metric, log_event, now_ms
from reconcile import reconcile
from validation import normalize_movies

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from enricher import EnrichmentStats
    from providers import ListingsSource

logger = logging.getLogger(__name__)


class RefreshStats(TypedDict):
    """
    Full account of one refresh: what came in, what merged away, what was
    filtered, what was published, and how Enrichment fared.

    The TMDb counts are the `EnrichmentStats` the enricher returns, folded in
    rather than discarded — a refresh whose Enrichment silently failed for every
    Movie looks identical to a healthy one without them.
    """

    provider_success_count: int
    provider_failure_count: int
    raw_movie_count: int
    collection_merged_count: int
    collected_movie_count: int
    post_enrichment_merged_count: int
    non_english_dropped_count: int
    published_movie_count: int
    published_showtime_count: int
    tmdb_enriched_count: int
    tmdb_reenriched_count: int
    tmdb_cache_hit_count: int
    tmdb_failure_count: int


class Enrich(Protocol):
    """The Enrichment step's shape — `enricher.enrich`, or a stub in tests."""

    def __call__(self, movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]: ...


def _default_enrich(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
    # Deferred: `enricher` pulls in requests/urllib3 adapters, and nothing that
    # merely imports this module should pay for that.
    import enricher  # noqa: PLC0415

    return enricher.enrich(movies, cached_movies)


class _Collection(NamedTuple):
    movies: list[Movie]
    raw_movie_count: int
    success_count: int
    failure_count: int


def build_listings(
    providers: Sequence[ListingsSource],
    cinemas: CinemaRegistry,
    cached: Listings | None,
    now: datetime,
    *,
    enrich: Enrich = _default_enrich,
) -> tuple[Listings, RefreshStats]:
    """
    Run the refresh ritual and return the fresh Listings plus their stats.

    `cached` is the previous refresh's Listings (None on a cold cache); it seeds
    Enrichment so unchanged Movies cost no TMDb request. Raises RuntimeError if
    every Provider failed or collection produced nothing — the caller must then
    leave the existing cache in place.
    """
    cached_movies: list[Movie] = cached["movies"] if cached else []

    collection = _collect_movies(providers, cinemas)
    enriched, enrichment_stats = enrich(collection.movies, cached_movies)
    reconciled = reconcile(enriched, stage="post_enrichment")
    published, non_english_dropped = _filter_english(reconciled)

    listings: Listings = {
        "fetched_at": now.isoformat(),
        "stale": False,
        "movies": published,
    }
    stats: RefreshStats = {
        "provider_success_count": collection.success_count,
        "provider_failure_count": collection.failure_count,
        "raw_movie_count": collection.raw_movie_count,
        "collection_merged_count": collection.raw_movie_count - len(collection.movies),
        "collected_movie_count": len(collection.movies),
        "post_enrichment_merged_count": len(enriched) - len(reconciled),
        "non_english_dropped_count": non_english_dropped,
        "published_movie_count": len(published),
        "published_showtime_count": sum(len(movie["showtimes"]) for movie in published),
        **enrichment_stats,
    }
    _emit_refresh_metrics(stats)
    log_event("refresh_stats", **stats)
    return listings, stats


def _emit_refresh_metrics(stats: RefreshStats) -> None:
    """
    The single emission site for refresh-level counts.

    `MoviesCollected` names the collection stage and now reports it: the Movie
    count after collection's Reconciliation, before Enrichment. `MoviesPublished`
    is the count that actually reaches the cache — previously nothing measured
    it, and `MoviesCollected` was emitted mid-way between the two.

    The TMDb metrics stay in `enricher.py`, at the only place that can observe
    a per-lookup failure; their counts are folded into `RefreshStats` for the
    `refresh_stats` log event, not re-emitted here.
    """
    emit_metric("MoviesCollected", stats["collected_movie_count"])
    emit_metric("MoviesPublished", stats["published_movie_count"])
    emit_metric("NonEnglishFiltered", stats["non_english_dropped_count"])


def _filter_english(movies: list[Movie]) -> tuple[list[Movie], int]:
    """Drop Movies with a confirmed non-English original language."""
    kept: list[Movie] = []
    dropped: list[str] = []
    for movie in movies:
        original_lang = movie.get("original_lang")
        if original_lang is None or original_lang == "en":
            kept.append(movie)
        else:
            dropped.append(movie["title"])
    if dropped:
        logger.info("Excluded %d non-English-original film(s): %s", len(dropped), ", ".join(dropped))
    return kept, len(dropped)


def _collect_movies(providers: Sequence[ListingsSource], cinemas: CinemaRegistry) -> _Collection:
    """
    Fetch every Provider in parallel and reconcile their combined output.

    Results are gathered in Provider list order, not completion order, so the
    reconciled output is deterministic regardless of which feed answers first.
    """
    started_ms = now_ms()
    provider_results: list[list[Movie]] = []
    failed_provider_count = 0

    with ThreadPoolExecutor(max_workers=len(providers) or 1) as executor:
        futures = [executor.submit(_fetch_provider_movies, provider, cinemas) for provider in providers]

    for future in futures:
        movies = future.result()
        if movies is None:
            failed_provider_count += 1
            continue
        provider_results.append(movies)

    if not provider_results:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("All providers failed to return listings")

    raw = list(chain.from_iterable(provider_results))
    movies = reconcile(raw, stage="collection")
    if not movies:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("Providers returned data but merge produced no movies")
    log_event(
        "collection_summary",
        provider_count=len(provider_results),
        failed_provider_count=failed_provider_count,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return _Collection(
        movies=movies,
        raw_movie_count=len(raw),
        success_count=len(provider_results),
        failure_count=failed_provider_count,
    )


def _fetch_provider_movies(provider: ListingsSource, cinemas: CinemaRegistry) -> list[Movie] | None:
    started_ms = now_ms()
    try:
        fetched = provider.fetch(cinemas)
    except Exception as exc:
        logger.warning("%s failed: %s", provider.name, exc)
        emit_metric("ProviderFailure", 1)
        log_event("collection_failure", provider=provider.name, exception_type=type(exc).__name__)
        return None

    movies = normalize_movies(fetched, source=f"{provider.name} output")
    emit_metric("ProviderSuccess", 1)
    if not movies:
        emit_metric("ProviderZeroResult", 1)
        log_event("provider_zero_result", provider=provider.name)
    log_event(
        "provider_collection_summary",
        provider=provider.name,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return movies
