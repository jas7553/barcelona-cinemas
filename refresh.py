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
     collapse title-variant duplicates the title pass could not see. Then a
     showing a translated copy repeats under another film is dropped from the
     copy (`drop_translated_slot_duplicates`).
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
      - slot_duplicate_dropped_count
      - non_english_dropped_count
      == published_movie_count

A Provider that still fails after its retry, or returns nothing, contributes
its last good output (`Listings.provider_snapshots`, via `_fallback_movies`) to
the raw collection instead, so that output goes through exactly the same
Reconciliation and Enrichment as fresh data.

Movies that drop out are carried in `Listings.ended` for
`ENDED_RETENTION_DAYS` after their last showing, so a shared film link keeps
rendering ("No more showings") instead of hitting the 404.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import date, datetime, timedelta
from itertools import chain
from typing import TYPE_CHECKING, Any, NamedTuple, Protocol, TypedDict

from models import CinemaRegistry, EndedMovie, Listings, Movie, ProviderSnapshot
from observability import emit_metric, log_event, now_ms
from providers.common import assume_utc, madrid_now, madrid_today
from providers.diagnostics import (
    clear_entry_response,
    failure_diagnostics,
    is_retryable,
    zero_result_diagnostics,
)
from reconcile import drop_translated_slot_duplicates, reconcile, same_movie
from validation import normalize_movies

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from enricher import EnrichmentStats
    from providers import ListingsSource

logger = logging.getLogger(__name__)

ENDED_RETENTION_DAYS = 30

# Covers two consecutive missed refreshes; older, the upstream schedule has
# likely moved on.
FALLBACK_MAX_AGE = timedelta(hours=24)


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
    provider_fallback_count: int
    raw_movie_count: int
    collection_merged_count: int
    collected_movie_count: int
    post_enrichment_merged_count: int
    slot_duplicate_dropped_count: int
    non_english_dropped_count: int
    published_movie_count: int
    published_showtime_count: int
    ended_movie_count: int
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
    fallback_count: int
    snapshots: dict[str, ProviderSnapshot]


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
    Enrichment so unchanged Movies cost no TMDb request, and its
    `provider_snapshots` stand in for a Provider that fails. Raises
    RuntimeError if no Provider returned fresh Movies (fallbacks
    notwithstanding) or collection produced nothing — the caller must then
    leave the existing cache in place.
    """
    cached_movies: list[Movie] = cached["movies"] if cached else []

    previous_snapshots = cached.get("provider_snapshots", {}) if cached else {}
    collection = _collect_movies(providers, cinemas, previous_snapshots, now)
    enriched, enrichment_stats = enrich(collection.movies, cached_movies)
    reconciled = reconcile(enriched, stage="post_enrichment")
    deduplicated, slot_duplicate_dropped = drop_translated_slot_duplicates(reconciled)
    published, non_english_dropped = _filter_english(deduplicated)

    ended = carry_ended(published, cached, madrid_today(now))

    listings: Listings = {
        "fetched_at": now.isoformat(),
        "movies": published,
        "ended": ended,
        "provider_snapshots": collection.snapshots,
    }
    stats: RefreshStats = {
        "provider_success_count": collection.success_count,
        "provider_failure_count": collection.failure_count,
        "provider_fallback_count": collection.fallback_count,
        "raw_movie_count": collection.raw_movie_count,
        "collection_merged_count": collection.raw_movie_count - len(collection.movies),
        "collected_movie_count": len(collection.movies),
        "post_enrichment_merged_count": len(enriched) - len(reconciled),
        "slot_duplicate_dropped_count": slot_duplicate_dropped,
        "non_english_dropped_count": non_english_dropped,
        "published_movie_count": len(published),
        "published_showtime_count": sum(len(movie["showtimes"]) for movie in published),
        "ended_movie_count": len(ended),
        **enrichment_stats,
    }
    _emit_refresh_metrics(stats)
    log_event("refresh_stats", **stats)
    return listings, stats


def carry_ended(published: list[Movie], cached: Listings | None, today: date) -> list[EndedMovie]:
    """
    The ended films to keep: every Movie the previous refresh had (listed or
    already ended) that this one no longer lists, until `ENDED_RETENTION_DAYS`
    after its last showing. A film that comes back is listed again, not ended.
    """
    if cached is None:
        return []
    candidates: list[EndedMovie] = list(cached.get("ended", []))
    for movie in cached["movies"]:
        if movie["showtimes"]:
            last_showing = max(showtime["date"] for showtime in movie["showtimes"])
            candidates.append({**movie, "showtimes": [], "last_showing": last_showing})

    oldest_kept = today - timedelta(days=ENDED_RETENTION_DAYS)
    ended: list[EndedMovie] = []
    for candidate in candidates:
        if date.fromisoformat(candidate["last_showing"]) < oldest_kept:
            continue
        if any(same_movie(candidate, movie) for movie in published):
            continue
        for index, kept in enumerate(ended):
            if same_movie(kept, candidate):
                if candidate["last_showing"] > kept["last_showing"]:
                    ended[index] = candidate
                break
        else:
            ended.append(candidate)
    return ended


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


def _collect_movies(
    providers: Sequence[ListingsSource],
    cinemas: CinemaRegistry,
    previous_snapshots: Mapping[str, ProviderSnapshot],
    now: datetime,
) -> _Collection:
    """
    Fetch every Provider in parallel and reconcile their combined output.

    Results are gathered in Provider list order, not completion order, so the
    reconciled output is deterministic regardless of which feed answers first.
    A failed Provider contributes its fallback (see `_fallback_movies`), if any.
    """
    started_ms = now_ms()
    provider_results: list[list[Movie]] = []
    snapshots: dict[str, ProviderSnapshot] = {}
    success_count = 0
    failed_provider_count = 0
    fallback_count = 0

    # ContextVars do not propagate into worker threads by default.
    with ThreadPoolExecutor(max_workers=len(providers) or 1) as executor:
        futures = [
            executor.submit(copy_context().run, _fetch_provider_movies, provider, cinemas) for provider in providers
        ]

    for provider, future in zip(providers, futures, strict=True):
        movies = future.result()
        if movies is None:
            failed_provider_count += 1
        else:
            success_count += 1
        if movies:
            snapshots[provider.name] = {"fetched_at": now.isoformat(), "movies": movies}
            provider_results.append(movies)
            continue
        # Zero films is treated as a failure too: a bot-challenge page parses to nothing.
        previous = previous_snapshots.get(provider.name)
        fallback = _fallback_movies(
            provider.name, previous, now, trigger="failure" if movies is None else "zero_result"
        )
        if previous is not None and fallback is not None:
            fallback_count += 1
            # Unchanged, original fetched_at included, so repeated failures age it out.
            snapshots[provider.name] = previous
            provider_results.append(fallback)

    if not success_count:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("All providers failed to return listings")
    if len(provider_results) == fallback_count:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("Providers answered but none returned movies")

    raw = list(chain.from_iterable(provider_results))
    movies = reconcile(raw, stage="collection")
    if not movies:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("Providers returned data but merge produced no movies")
    log_event(
        "collection_summary",
        provider_count=success_count,
        failed_provider_count=failed_provider_count,
        fallback_provider_count=fallback_count,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return _Collection(
        movies=movies,
        raw_movie_count=len(raw),
        success_count=success_count,
        failure_count=failed_provider_count,
        fallback_count=fallback_count,
        snapshots=snapshots,
    )


def _fallback_movies(
    provider: str, snapshot: ProviderSnapshot | None, now: datetime, *, trigger: str
) -> list[Movie] | None:
    """
    A Provider's last good Movies minus Showtimes that have already started, or
    None if there is no snapshot or it is older than `FALLBACK_MAX_AGE`.
    """
    if snapshot is None:
        log_event(
            "provider_fallback_unavailable",
            level=logging.WARNING,
            provider=provider,
            trigger=trigger,
            reason="no_snapshot",
        )
        return None
    age = assume_utc(now) - assume_utc(datetime.fromisoformat(snapshot["fetched_at"]))
    age_hours = round(age / timedelta(hours=1), 1)
    if age > FALLBACK_MAX_AGE:
        log_event(
            "provider_fallback_unavailable",
            level=logging.WARNING,
            provider=provider,
            trigger=trigger,
            reason="stale",
            snapshot_age_hours=age_hours,
        )
        return None

    local = madrid_now(now)
    cutoff = (local.date().isoformat(), local.strftime("%H:%M"))
    movies: list[Movie] = []
    dropped = 0
    for movie in snapshot["movies"]:
        upcoming = [showtime for showtime in movie["showtimes"] if (showtime["date"], showtime["time"]) >= cutoff]
        dropped += len(movie["showtimes"]) - len(upcoming)
        if upcoming:
            movies.append({**movie, "showtimes": upcoming})

    emit_metric("ProviderFallback", 1)
    log_event(
        "provider_fallback",
        level=logging.WARNING,
        provider=provider,
        trigger=trigger,
        snapshot_fetched_at=snapshot["fetched_at"],
        snapshot_age_hours=age_hours,
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
        past_showtime_dropped_count=dropped,
    )
    return movies


# Long enough for a dropped connection or a rate-limit window on the upstream
# front end to clear, short enough that the retry still fits the budget below.
_RETRY_DELAY_S = 30.0

# Latest a retry may start, measured from the Provider's first attempt (which
# is collection start: Providers run in parallel). A retry starting then plus
# the slowest Provider's success must still leave Enrichment and publishing
# room within the function timeout.
_RETRY_START_DEADLINE_S = 55.0

_sleep = time.sleep
_monotonic = time.monotonic


def _fetch_provider_movies(provider: ListingsSource, cinemas: CinemaRegistry) -> list[Movie] | None:
    started_ms = now_ms()
    fetched = _fetch_with_retry(provider, cinemas)
    if fetched is None:
        return None

    movies = normalize_movies(fetched, source=f"{provider.name} output")
    emit_metric("ProviderSuccess", 1)
    if not movies:
        emit_metric("ProviderZeroResult", 1)
        zero: dict[str, Any] = zero_result_diagnostics()
        log_event("provider_zero_result", provider=provider.name, **zero)
    log_event(
        "provider_collection_summary",
        provider=provider.name,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return movies


def _fetch_with_retry(provider: ListingsSource, cinemas: CinemaRegistry) -> list[Movie] | None:
    """
    `provider.fetch`, retried once on a transient error or zero films if the
    budget allows.

    `ProviderFailure` fires only once no further attempt will be made.
    """
    first_started = _monotonic()
    attempt = 1
    while True:
        attempt_started = _monotonic()
        clear_entry_response()
        try:
            fetched = provider.fetch(cinemas)
        except Exception as exc:
            failure: dict[str, Any] = {
                **_attempt_fields(provider, attempt, attempt_started, first_started),
                "exception_type": type(exc).__name__,
                **failure_diagnostics(exc),
            }
            logger.warning("%s failed (attempt %d): %s", provider.name, attempt, exc)

            if attempt > 1:
                outcome = "retry_failed"
            elif not is_retryable(exc):
                outcome = "not_retryable"
            # Re-read: the diagnostics' DNS and egress lookups take seconds.
            elif not _retry_fits(first_started):
                outcome = "over_budget"
            else:
                emit_metric("ProviderRetry", 1)
                log_event("provider_retry", level=logging.WARNING, retry_delay_s=_RETRY_DELAY_S, **failure)
                _sleep(_RETRY_DELAY_S)
                attempt += 1
                continue

            emit_metric("ProviderFailure", 1)
            log_event("collection_failure", level=logging.WARNING, outcome=outcome, **failure)
            return None

        if fetched or attempt > 1 or not _retry_fits(first_started):
            return fetched
        zero: dict[str, Any] = zero_result_diagnostics()
        # Re-read, as above; if the lookups spent the budget, `provider_zero_result` logs them instead.
        if not _retry_fits(first_started):
            return fetched
        emit_metric("ProviderRetry", 1)
        log_event(
            "provider_retry",
            level=logging.WARNING,
            reason="zero_result",
            retry_delay_s=_RETRY_DELAY_S,
            **_attempt_fields(provider, attempt, attempt_started, first_started),
            **zero,
        )
        _sleep(_RETRY_DELAY_S)
        attempt += 1


def _attempt_fields(
    provider: ListingsSource, attempt: int, attempt_started: float, first_started: float
) -> dict[str, Any]:
    now = _monotonic()
    return {
        "provider": provider.name,
        "attempt": attempt,
        "elapsed_ms": round((now - attempt_started) * 1000),
        "total_elapsed_ms": round((now - first_started) * 1000),
    }


def _retry_fits(first_started: float) -> bool:
    return _monotonic() - first_started + _RETRY_DELAY_S <= _RETRY_START_DEADLINE_S
