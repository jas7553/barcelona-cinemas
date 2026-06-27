"""
TMDb enrichment: adds synopsis, rating, runtime, and genres to collected movies.

For each movie title not already in the cache, TMDb is queried:
  1. /3/search/movie       — find best match and retrieve the TMDb ID
  2. /3/movie/{id}         — retrieve runtime and named genres (search only returns IDs)
  3. /3/movie/{id}/videos  — retrieve trailer URL (non-fatal on failure)
  4. /3/movie/{id}/credits — retrieve director + top cast (non-fatal on failure)

Failures are logged and result in null metadata fields; this module never raises.
"""

import logging
from typing import Any, NamedTuple, TypedDict, cast

import requests

from listings_config import resolve_env_or_ssm
from models import Movie
from observability import emit_metric, log_event
from validation import normalize_tmdb_payload

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.themoviedb.org/3"


class EnrichmentStats(TypedDict):
    tmdb_enriched_count: int
    tmdb_cache_hit_count: int
    tmdb_failure_count: int


class _LookupResult(NamedTuple):
    movie: Movie
    enriched: bool
    failed: bool


def _api_key() -> str:
    return resolve_env_or_ssm("TMDB_API_KEY", "TMDB_SSM_PARAMETER", "TMDB")


def enrich(movies: list[Movie], cached_movies: list[Movie]) -> tuple[list[Movie], EnrichmentStats]:
    """
    Return a new list of movies with TMDb metadata filled in.
    Reuses cached data for titles already seen; never mutates the input lists.
    """
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

    cached_by_imdb: dict[str, Movie] = {imdb_id: m for m in cached_movies if (imdb_id := m.get("imdb_id"))}
    cached_by_title: dict[str, Movie] = {m["title"].lower(): m for m in cached_movies}

    with requests.Session() as session:
        enriched: list[Movie] = []
        for movie in movies:
            cached = _find_cached_movie(movie, cached_by_imdb, cached_by_title)
            if cached and cached.get("tmdb_id") is not None:
                stats["tmdb_cache_hit_count"] += 1
                enriched.append({**cached, "showtimes": movie["showtimes"]})
            else:
                result = _lookup_and_merge(movie, session, key)
                if result.enriched:
                    stats["tmdb_enriched_count"] += 1
                if result.failed:
                    stats["tmdb_failure_count"] += 1
                enriched.append(result.movie)
        if stats["tmdb_failure_count"]:
            emit_metric("TmdbLookupFailure", stats["tmdb_failure_count"])
        emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return enriched, stats


def _find_cached_movie(
    movie: Movie,
    cached_by_imdb: dict[str, Movie],
    cached_by_title: dict[str, Movie],
) -> Movie | None:
    imdb_id = movie.get("imdb_id")
    if imdb_id:
        cached = cached_by_imdb.get(imdb_id)
        if cached is not None:
            return cached
    return cached_by_title.get(movie["title"].lower())


def _lookup_and_merge(movie: Movie, session: requests.Session, api_key: str) -> _LookupResult:
    """Look up a movie on TMDb and merge metadata into the Movie dict."""
    try:
        raw_detail, raw_videos, raw_credits = _fetch_tmdb(movie["title"], session, api_key)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        detail = f"HTTP {status}" if status else type(exc).__name__
        logger.warning("TMDb lookup failed for %r: %s", movie["title"], detail)
        return _LookupResult(movie, enriched=False, failed=True)

    tmdb_data = (
        normalize_tmdb_payload(raw_detail, title=movie["title"], videos=raw_videos, credits=raw_credits)
        if raw_detail is not None
        else None
    )

    if tmdb_data is None:
        return _LookupResult(movie, enriched=False, failed=False)

    genres: list[str] = tmdb_data.get("genres") or []
    return _LookupResult(
        {
            **movie,
            "tmdb_id": tmdb_data.get("id"),
            "imdb_id": tmdb_data.get("imdb_id"),
            "year": tmdb_data.get("year"),
            "poster_url": tmdb_data.get("poster_url"),
            "backdrop_url": tmdb_data.get("backdrop_url"),
            "trailer_url": tmdb_data.get("trailer_url"),
            "synopsis": tmdb_data.get("overview"),
            "tagline": tmdb_data.get("tagline"),
            "rating": tmdb_data.get("vote_average"),
            "runtime_mins": tmdb_data.get("runtime"),
            "genres": genres or None,
            "director": tmdb_data.get("director"),
            "cast": tmdb_data.get("cast"),
        },
        enriched=True,
        failed=False,
    )


def _optional_get(
    session: requests.Session, url: str, params: dict[str, str], title: str, label: str
) -> dict[str, Any] | None:
    try:
        resp = session.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        detail = f"HTTP {status}" if status else type(exc).__name__
        logger.warning("TMDb %s fetch failed for %r: %s", label, title, detail)
        return None


def _fetch_tmdb(
    title: str, session: requests.Session, api_key: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    """Search TMDb for a title; return (detail, videos, credits), or all None on no results."""
    common = {"language": "en-US", "api_key": api_key}
    search_resp = session.get(
        f"{_BASE_URL}/search/movie",
        params={"query": title, **common},
        timeout=10,
    )
    search_resp.raise_for_status()
    results: list[dict[str, Any]] = search_resp.json().get("results", [])

    if not results:
        logger.debug("No TMDb results for %r", title)
        return None, None, None

    title_lower = title.lower()
    match = next(
        (r for r in results if r.get("title", "").lower() == title_lower),
        results[0],
    )

    movie_url = f"{_BASE_URL}/movie/{match['id']}"
    detail_resp = session.get(movie_url, params=common, timeout=10)
    detail_resp.raise_for_status()
    detail_data = cast(dict[str, Any], detail_resp.json())

    videos_data = _optional_get(session, f"{movie_url}/videos", common, title, "videos")
    credits_data = _optional_get(session, f"{movie_url}/credits", common, title, "credits")

    return detail_data, videos_data, credits_data
