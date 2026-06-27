"""
Orchestration layer: coordinates listing retrieval, enrichment, and caching.
app.py calls this module; it knows nothing about HTTP.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from itertools import chain
from typing import TYPE_CHECKING, Any, cast

import cache
import transform
from models import CinemaRegistry, Listings, Movie
from observability import emit_metric, log_event, now_ms
from reconcile import reconcile
from validation import normalize_movies

if TYPE_CHECKING:
    from providers import ListingsSource

logger = logging.getLogger(__name__)

_CINEMAS_FILE = "cinemas.json"
_CACHE_TTL_HOURS = int(os.environ.get("CACHE_TTL_HOURS", 12))


def _s3() -> Any:
    import boto3  # type: ignore[import-untyped]

    return boto3.client("s3")


def _lambda() -> Any:
    import boto3

    return boto3.client("lambda")


_cinemas_cache: CinemaRegistry | None = None


def load_cinemas() -> CinemaRegistry:
    global _cinemas_cache
    if _cinemas_cache is None:
        with open(_CINEMAS_FILE) as f:
            _cinemas_cache = cast(CinemaRegistry, json.load(f))
        if not (isinstance(_cinemas_cache, dict) and _cinemas_cache):
            raise RuntimeError(f"{_CINEMAS_FILE} loaded empty or non-dict — registry is corrupted")
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
    _publish_static_site(result)
    return result


def _publish_static_site(listings: Listings) -> None:
    """Regenerate the static SSG site from fresh listings (Option A).

    Writes the public listings JSON to the frontend bucket, then asynchronously
    invokes the Node SSG renderer Lambda, which re-renders every page and
    invalidates CloudFront. No-ops in local dev (env vars absent) and swallows
    all exceptions so a publish failure never masks a successful refresh — the
    old static pages keep serving and the age-based "out of date" banner appears
    naturally (reproducing the old stale-while-revalidate behaviour).
    """
    bucket = os.environ.get("FRONTEND_BUCKET")
    if not bucket:
        return

    try:
        public = transform.to_api_response(listings, load_cinemas())
        _s3().put_object(
            Bucket=bucket,
            Key="data/listings.json",
            Body=json.dumps(public).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache",
        )
        log_event("ssg_data_published", bucket=bucket, movies=len(public["movies"]))
    except Exception:
        logger.warning("Failed to publish SSG data to frontend bucket", exc_info=True)
        return

    function_name = os.environ.get("SSG_FUNCTION_NAME")
    if not function_name:
        return
    try:
        # Async (Event): the renderer regenerates pages + invalidates CloudFront
        # on its own; the refresh need not block on it.
        _lambda().invoke(FunctionName=function_name, InvocationType="Event")
        log_event("ssg_render_invoked", function=function_name)
    except Exception:
        logger.warning("Failed to invoke SSG renderer Lambda", exc_info=True)


def _refresh() -> Listings:
    import enricher  # noqa: PLC0415

    cinemas = load_cinemas()
    existing = cache.read()
    cached_movies: list[Movie] = existing["movies"] if existing else []

    movies = _collect_movies(cinemas)
    enriched, enrichment_stats = enricher.enrich(movies, cached_movies)
    enriched = reconcile(enriched)

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
    from providers import all_providers  # noqa: PLC0415

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
        raise RuntimeError("All providers failed to return listings")

    movies = reconcile(list(chain.from_iterable(provider_results)))
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
