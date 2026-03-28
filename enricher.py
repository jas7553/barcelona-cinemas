"""
TMDb enrichment: adds synopsis, rating, runtime, and genres to collected movies.

For each movie title not already in the cache, two TMDb calls are made:
  1. /3/search/movie  — find best match and retrieve the TMDb ID
  2. /3/movie/{id}    — retrieve runtime and named genres (search only returns IDs)

Failures are logged and result in null metadata fields; this module never raises.
"""

import logging
import os
from typing import Any, TypedDict, cast

import requests

from models import Movie
from observability import emit_metric, log_event
from validation import normalize_tmdb_payload

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.themoviedb.org/3"
_cached_api_key: str | None = None


class EnrichmentStats(TypedDict):
    tmdb_enriched_count: int
    tmdb_cache_hit_count: int
    tmdb_failure_count: int


def _api_key() -> str:
    global _cached_api_key
    if _cached_api_key:
        return _cached_api_key

    # Local dev: read directly from environment.
    key = os.environ.get("TMDB_API_KEY", "")
    if key:
        _cached_api_key = key
        return key

    # Lambda: fetch from SSM at runtime (SecureString, decrypted).
    param_name = os.environ.get("TMDB_SSM_PARAMETER", "")
    if not param_name:
        raise OSError("Neither TMDB_API_KEY nor TMDB_SSM_PARAMETER is set")

    import boto3  # type: ignore[import-untyped]  # imported here to avoid overhead in local dev

    ssm: Any = boto3.client("ssm")
    response = ssm.get_parameter(Name=param_name, WithDecryption=True)
    parameter = cast(dict[str, Any], response.get("Parameter", {}))
    key = cast(str, parameter.get("Value", ""))
    if not key:
        raise OSError(f"TMDB SSM parameter {param_name!r} did not contain a value")
    _cached_api_key = key
    return key


def enrich(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
    """
    Return a new list of movies with TMDb metadata filled in.
    Reuses cached data for titles already seen; never mutates the input lists.
    """
    cache_by_title = {m["title"].lower(): m for m in cached_movies}
    stats: EnrichmentStats = {
        "tmdb_enriched_count": 0,
        "tmdb_cache_hit_count": 0,
        "tmdb_failure_count": 0,
    }

    try:
        key = _api_key()
    except OSError as exc:
        logger.error("%s — skipping enrichment", exc)
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return movies, stats

    with requests.Session() as session:
        enriched: list[Movie] = []
        for movie in movies:
            cached = cache_by_title.get(movie["title"].lower())
            if cached and cached.get("tmdb_id") is not None:
                # Reuse cached TMDb metadata; replace showtimes with fresh ones.
                stats["tmdb_cache_hit_count"] += 1
                enriched.append({**cached, "showtimes": movie["showtimes"]})
            else:
                merged, was_enriched, failed = _lookup_and_merge(movie, session, key)
                if was_enriched:
                    stats["tmdb_enriched_count"] += 1
                if failed:
                    stats["tmdb_failure_count"] += 1
                enriched.append(merged)
        if stats["tmdb_failure_count"]:
            emit_metric("TmdbLookupFailure", stats["tmdb_failure_count"])
        emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return enriched, stats


def _lookup_and_merge(
    movie: Movie, session: requests.Session, api_key: str
) -> tuple[Movie, bool, bool]:
    """Look up a movie on TMDb and merge metadata into the Movie dict."""
    try:
        raw_tmdb_data = _fetch_tmdb(movie["title"], session, api_key)
    except Exception as exc:
        logger.warning("TMDb lookup failed for %r: %s", movie["title"], exc)
        raw_tmdb_data = None
        return movie, False, True

    tmdb_data = (
        normalize_tmdb_payload(raw_tmdb_data, title=movie["title"])
        if raw_tmdb_data is not None
        else None
    )

    if tmdb_data is None:
        return movie, False, False

    genres: list[str] = [g["name"] for g in (tmdb_data.get("genres") or [])]
    return (
        {
            **movie,
            "tmdb_id":      tmdb_data.get("id"),
            "synopsis":     tmdb_data.get("overview") or None,
            "rating":       tmdb_data.get("vote_average") or None,
            "runtime_mins": tmdb_data.get("runtime") or None,
            "genres":       genres or None,
        },
        True,
        False,
    )


def _fetch_tmdb(title: str, session: requests.Session, api_key: str) -> dict[str, Any] | None:
    """
    Search TMDb for a title and return the details dict, or None on failure.
    Prefers an exact title match; falls back to the first (most popular) result.
    """
    search_resp = session.get(
        f"{_BASE_URL}/search/movie",
        params={"query": title, "language": "en-US", "api_key": api_key},
        timeout=10,
    )
    search_resp.raise_for_status()
    results: list[dict[str, Any]] = search_resp.json().get("results", [])

    if not results:
        logger.debug("No TMDb results for %r", title)
        return None

    # Prefer exact title match (case-insensitive); otherwise take first by popularity.
    title_lower = title.lower()
    match = next(
        (r for r in results if r.get("title", "").lower() == title_lower),
        results[0],
    )

    # Fetch full details to get runtime and named genres.
    detail_resp = session.get(
        f"{_BASE_URL}/movie/{match['id']}",
        params={"language": "en-US", "api_key": api_key},
        timeout=10,
    )
    detail_resp.raise_for_status()
    return cast(dict[str, Any], detail_resp.json())
