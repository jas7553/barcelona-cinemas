"""
Orchestration layer: coordinates listing retrieval, enrichment, and caching.
app.py calls this module; it knows nothing about HTTP.
"""

import json
import logging
import os
from datetime import UTC, datetime
from typing import TypedDict, cast

import cache
import enricher
from models import CinemaRegistry, Listings, Movie
from observability import emit_metric, log_event, now_ms
from providers import get_providers
from validation import normalize_movies

logger = logging.getLogger(__name__)

_CINEMAS_FILE = "cinemas.json"
_CACHE_TTL_HOURS = int(os.environ.get("CACHE_TTL_HOURS", 12))


class RefreshStats(TypedDict):
    provider: str
    movie_count: int
    showtime_count: int
    tmdb_enriched_count: int
    tmdb_cache_hit_count: int
    tmdb_failure_count: int


def load_cinemas() -> CinemaRegistry:
    with open(_CINEMAS_FILE) as f:
        return cast(CinemaRegistry, json.load(f))


def get_listings() -> Listings:
    """
    Return cached listings for public requests.

    User-facing requests never trigger a refresh. If the cache is older than the
    configured TTL, the payload is marked stale so the frontend can surface that
    state while the scheduled refresh path repopulates the cache.
    """
    cached = cache.read()
    if cached is None:
        raise RuntimeError("Listings cache unavailable")

    cache_age = cache.age_hours(cached)
    emit_metric("CacheAgeHours", cache_age, unit="None")
    if cache_age >= _CACHE_TTL_HOURS:
        return {**cached, "stale": True}
    return cached


def force_refresh() -> Listings:
    """Ignore TTL and always fetch fresh listings."""
    started_ms = now_ms()
    try:
        result, stats = _refresh()
    except Exception:
        emit_metric("RefreshFailure", 1)
        raise

    duration_ms = round(now_ms() - started_ms, 2)
    emit_metric("RefreshSuccess", 1)
    emit_metric("RefreshDurationMs", duration_ms, unit="Milliseconds")
    emit_metric("MoviesCollected", stats["movie_count"])
    emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
    emit_metric("CacheAgeHours", 0, unit="None")
    log_event(
        "refresh_summary",
        trigger="schedule",
        duration_ms=duration_ms,
        success=True,
        **stats,
    )
    return result


def _refresh() -> tuple[Listings, RefreshStats]:
    cinemas = load_cinemas()
    existing = cache.read()
    cached_movies: list[Movie] = existing["movies"] if existing else []

    movies, provider_name = _collect_movies(cinemas)
    enriched, enrichment_stats = enricher.enrich(movies, cached_movies)

    result: Listings = {
        "fetched_at": datetime.now(UTC).isoformat(),
        "stale": False,
        "movies": enriched,
    }
    cache.write(result)
    return (
        result,
        RefreshStats(
            provider=provider_name,
            movie_count=len(movies),
            showtime_count=sum(len(movie["showtimes"]) for movie in movies),
            tmdb_enriched_count=enrichment_stats["tmdb_enriched_count"],
            tmdb_cache_hit_count=enrichment_stats["tmdb_cache_hit_count"],
            tmdb_failure_count=enrichment_stats["tmdb_failure_count"],
        ),
    )


def _collect_movies(cinemas: CinemaRegistry) -> tuple[list[Movie], str]:
    """Try providers in priority order; raise RuntimeError if all fail."""
    started_ms = now_ms()
    for provider in get_providers():
        try:
            fetched = provider.fetch(cinemas)
            movies = normalize_movies(fetched, source=f"{type(provider).__name__} output")
            log_event(
                "collection_summary",
                provider=type(provider).__name__,
                duration_ms=round(now_ms() - started_ms, 2),
                movie_count=len(movies),
                showtime_count=sum(len(movie["showtimes"]) for movie in movies),
            )
            return movies, type(provider).__name__
        except Exception as exc:
            logger.warning("%s failed: %s", type(provider).__name__, exc)
            emit_metric("CollectionFailure", 1)
            log_event(
                "collection_failure",
                provider=type(provider).__name__,
                exception_type=type(exc).__name__,
            )
    raise RuntimeError("All providers failed to return listings")
