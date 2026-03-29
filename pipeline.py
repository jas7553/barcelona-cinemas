"""
Orchestration layer: coordinates listing retrieval, enrichment, and caching.
app.py calls this module; it knows nothing about HTTP.
"""

import json
import logging
import os
from datetime import UTC, datetime
from typing import cast

import cache
import enricher
from models import CinemaRegistry, Listings, Movie
from observability import emit_metric, log_event, now_ms
from providers.listings_provider import ListingsProvider
from validation import normalize_movies

logger = logging.getLogger(__name__)

_CINEMAS_FILE = "cinemas.json"
_CACHE_TTL_HOURS = int(os.environ.get("CACHE_TTL_HOURS", 12))


_cinemas_cache: CinemaRegistry | None = None


def load_cinemas() -> CinemaRegistry:
    global _cinemas_cache
    if _cinemas_cache is None:
        with open(_CINEMAS_FILE) as f:
            _cinemas_cache = cast(CinemaRegistry, json.load(f))
    return _cinemas_cache


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
        result = _refresh()
    except Exception:
        emit_metric("RefreshFailure", 1)
        raise

    duration_ms = round(now_ms() - started_ms, 2)
    emit_metric("RefreshSuccess", 1)
    emit_metric("RefreshDurationMs", duration_ms, unit="Milliseconds")
    emit_metric("CacheAgeHours", 0, unit="None")
    log_event("refresh_summary", trigger="schedule", duration_ms=duration_ms, success=True)
    return result


def _refresh() -> Listings:
    cinemas = load_cinemas()
    existing = cache.read()
    cached_movies: list[Movie] = existing["movies"] if existing else []

    movies = _collect_movies(cinemas)
    enriched, enrichment_stats = enricher.enrich(movies, cached_movies)

    emit_metric("MoviesCollected", len(movies))
    emit_metric("MoviesEnriched", enrichment_stats["tmdb_enriched_count"])

    result: Listings = {
        "fetched_at": datetime.now(UTC).isoformat(),
        "stale": False,
        "movies": enriched,
    }
    cache.write(result)
    return result


def _collect_movies(cinemas: CinemaRegistry) -> list[Movie]:
    started_ms = now_ms()
    try:
        fetched = ListingsProvider().fetch(cinemas)
    except Exception as exc:
        logger.warning("ListingsProvider failed: %s", exc)
        emit_metric("CollectionFailure", 1)
        log_event("collection_failure", provider="ListingsProvider", exception_type=type(exc).__name__)
        raise RuntimeError("Provider failed to return listings") from exc

    movies = normalize_movies(fetched, source="ListingsProvider output")
    log_event(
        "collection_summary",
        provider="ListingsProvider",
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return movies
