"""
Orchestration layer: coordinates listing retrieval, enrichment, and caching.
app.py calls this module; it knows nothing about HTTP.
"""

import json
import logging
import os
import string
from datetime import UTC, datetime
from itertools import chain
from typing import cast

import cache
import enricher
from models import CinemaRegistry, Listings, Movie, Showtime
from observability import emit_metric, log_event, now_ms
from providers import ListingsSource, all_providers
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
    provider_results: list[list[Movie]] = []
    failed_provider_count = 0

    for provider in all_providers():
        movies = _fetch_provider_movies(provider, cinemas)
        if movies is None:
            failed_provider_count += 1
            continue
        provider_results.append(movies)

    if not provider_results:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("Provider failed to return listings")

    movies = _merge_movies(list(chain.from_iterable(provider_results)))
    if not movies:
        emit_metric("CollectionFailure", 1)
        raise RuntimeError("Provider failed to return listings")
    log_event(
        "collection_summary",
        provider_count=len(provider_results),
        failed_provider_count=failed_provider_count,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return movies


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
    log_event(
        "provider_collection_summary",
        provider=provider.name,
        duration_ms=round(now_ms() - started_ms, 2),
        movie_count=len(movies),
        showtime_count=sum(len(movie["showtimes"]) for movie in movies),
    )
    return movies


def _merge_movies(movies: list[Movie]) -> list[Movie]:
    merged: list[Movie] = []
    for movie in movies:
        for index, existing in enumerate(merged):
            if _movies_are_compatible(existing, movie):
                merged[index] = _merge_movie_pair(existing, movie)
                break
        else:
            merged.append(movie)
    return merged


def _normalize_title(title: str) -> str:
    return " ".join(title.strip(_TITLE_EDGE_CHARS).casefold().split())


_TITLE_EDGE_CHARS = f"{string.whitespace}{string.punctuation}“”‘’`"


def _canonical_language(showtime: Showtime) -> str:
    language = showtime.get("language")
    return language if language in {"vo", "dub"} else "vo"


def _movies_are_compatible(left: Movie, right: Movie) -> bool:
    left_imdb = left.get("imdb_id")
    right_imdb = right.get("imdb_id")
    if left_imdb and right_imdb:
        return left_imdb == right_imdb
    return _normalize_title(left["title"]) == _normalize_title(right["title"])


def _pick_string(left: str | None, right: str | None) -> str | None:
    candidates = [value for value in (left, right) if value]
    if not candidates:
        return None
    return sorted(candidates, key=lambda value: (-len(value), value.casefold()))[0]


def _pick_int(left: int | None, right: int | None) -> int | None:
    candidates = [value for value in (left, right) if value is not None]
    if not candidates:
        return None
    return max(candidates)


def _pick_float(left: float | None, right: float | None) -> float | None:
    candidates = [value for value in (left, right) if value is not None]
    if not candidates:
        return None
    return max(candidates)


def _pick_genres(left: list[str] | None, right: list[str] | None) -> list[str] | None:
    candidates = [value for value in (left, right) if value]
    if not candidates:
        return None
    return sorted(candidates, key=lambda value: (-len(value), tuple(item.casefold() for item in value)))[0]


def _merge_movie_pair(left: Movie, right: Movie) -> Movie:
    deduped_showtimes: dict[tuple[str, str, str, str], Showtime] = {}
    for showtime in [*left["showtimes"], *right["showtimes"]]:
        deduped_showtimes[
            (
                showtime["date"],
                showtime["time"],
                showtime["cinema"],
                _canonical_language(showtime),
            )
        ] = showtime
    merged_showtimes = sorted(
        deduped_showtimes.values(),
        key=lambda showtime: (
            showtime["date"],
            showtime["time"],
            showtime["cinema"],
            _canonical_language(showtime),
        ),
    )
    return Movie(
        title=_pick_string(left["title"], right["title"]) or left["title"],
        tmdb_id=_pick_int(left.get("tmdb_id"), right.get("tmdb_id")),
        imdb_id=_pick_string(left.get("imdb_id"), right.get("imdb_id")),
        year=_pick_int(left.get("year"), right.get("year")),
        poster_url=_pick_string(left.get("poster_url"), right.get("poster_url")),
        synopsis=_pick_string(left.get("synopsis"), right.get("synopsis")),
        rating=_pick_float(left.get("rating"), right.get("rating")),
        runtime_mins=_pick_int(left.get("runtime_mins"), right.get("runtime_mins")),
        genres=_pick_genres(left.get("genres"), right.get("genres")),
        showtimes=merged_showtimes,
    )
