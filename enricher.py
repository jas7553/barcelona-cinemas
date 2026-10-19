"""
TMDb enrichment: adds synopsis, rating, runtime, and genres to collected movies.

For each movie title not already in the cache, TMDb is queried:
  1. /3/find/{imdb_id}     — when a Provider gave an IMDb id: an exact match
     /3/search/movie       — otherwise: candidates, filtered by the source's year
  2. /3/movie/{id}         — runtime and named genres; rules out shorts and TV
                             movies, and picks the candidate whose runtime fits
  3. /3/movie/{id}/videos  — retrieve trailer URL (non-fatal on failure)
  4. /3/movie/{id}/credits — retrieve director + top cast (non-fatal on failure)

Failures are logged and result in null metadata fields; this module never raises.
"""

import logging
import os
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple, TypedDict, cast

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from http_errors import http_status
from listings_config import resolve_env_or_ssm
from models import Movie
from observability import emit_metric, log_event
from providers.common import assume_utc
from validation import normalize_tmdb_payload

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.themoviedb.org/3"
_ENRICH_TTL_DAYS = int(os.environ.get("ENRICH_TTL_DAYS", "7"))
# Stamped on every enrichment. Bump it when the matching rules change, so the
# next refresh re-matches every cached film instead of waiting out the TTL.
MATCH_VERSION = 2


class EnrichmentStats(TypedDict):
    tmdb_enriched_count: int
    tmdb_reenriched_count: int
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
        "tmdb_reenriched_count": 0,
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

    _retry = Retry(
        total=2,
        backoff_factor=1,
        status_forcelist={500, 502, 503, 504},
        allowed_methods={"GET"},
        raise_on_status=False,
    )
    with requests.Session() as session:
        session.mount("https://", HTTPAdapter(max_retries=_retry))
        enriched: list[Movie] = []
        for movie in movies:
            cached = _find_cached_movie(movie, cached_by_imdb, cached_by_title)
            if cached and cached.get("tmdb_id") is not None and not _needs_reenrichment(cached):
                stats["tmdb_cache_hit_count"] += 1
                enriched.append(_with_fresh_listing(cached, movie))
            else:
                if cached and cached.get("tmdb_id") is not None:
                    stats["tmdb_reenriched_count"] += 1
                # An older matcher's English title may name the wrong film.
                trusted = cached is not None and _current_match(cached)
                result = _lookup_and_merge(
                    movie,
                    session,
                    key,
                    search_title=cached.get("english_title") if cached and trusted else None,
                )
                if result.enriched:
                    stats["tmdb_enriched_count"] += 1
                if result.failed:
                    stats["tmdb_failure_count"] += 1
                # A re-enrichment that produced nothing (network failure or no
                # TMDb match) must not discard good cached metadata — keep the
                # cached copy with fresh showtimes rather than reverting to the
                # bare scraped listing. Uncached titles still fall through. An
                # older matcher's copy is only kept through a failure: if the
                # current rules find no match, its match was not one either.
                if (
                    not result.enriched
                    and cached is not None
                    and cached.get("tmdb_id") is not None
                    and (trusted or result.failed)
                ):
                    enriched.append(_with_fresh_listing(cached, movie))
                else:
                    enriched.append(result.movie)
        if stats["tmdb_failure_count"]:
            emit_metric("TmdbLookupFailure", stats["tmdb_failure_count"])
        emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return enriched, stats


def _current_match(cached: Movie) -> bool:
    return cached.get("match_version", 1) >= MATCH_VERSION


_SOURCE_FIELDS = ("original_title", "source_year", "source_runtime_mins", "rerelease")


def _with_fresh_listing(cached: Movie, movie: Movie) -> Movie:
    """The cached TMDb metadata with this run's showtimes and source fields."""
    reused = cast(Movie, {k: v for k, v in cached.items() if k not in _SOURCE_FIELDS})
    reused.update({k: v for k, v in movie.items() if k in _SOURCE_FIELDS})  # type: ignore[typeddict-item]
    reused["showtimes"] = movie["showtimes"]
    return reused


def _needs_reenrichment(cached: Movie) -> bool:
    if not _current_match(cached):
        return True
    enriched_at_str = cached.get("enriched_at")
    if not enriched_at_str:
        return True
    try:
        enriched_at = assume_utc(datetime.fromisoformat(enriched_at_str))
        return datetime.now(UTC) - enriched_at > timedelta(days=_ENRICH_TTL_DAYS)
    except ValueError:
        return True


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
    cached = cached_by_title.get(movie["title"].lower())
    # Same title, different IMDb id: another film of that name, or a wrong match.
    if cached is not None and imdb_id and cached.get("imdb_id") not in (None, imdb_id):
        return None
    return cached


def _lookup_and_merge(
    movie: Movie, session: requests.Session, api_key: str, *, search_title: str | None = None
) -> _LookupResult:
    """Look up a movie on TMDb and merge metadata into the Movie dict."""
    query = search_title or movie["title"]
    try:
        raw_detail, raw_videos, raw_credits = _fetch_tmdb(movie, query, session, api_key)
    except Exception as exc:
        status = http_status(exc)
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
    merged: Movie = {
        **movie,
        "enriched_at": datetime.now(UTC).isoformat(),
        "match_version": MATCH_VERSION,
        "tmdb_id": tmdb_data.get("id"),
        "imdb_id": tmdb_data.get("imdb_id") or movie.get("imdb_id"),
        "year": tmdb_data.get("year"),
        "poster_url": tmdb_data.get("poster_url"),
        "backdrop_url": tmdb_data.get("backdrop_url"),
        "trailer_url": tmdb_data.get("trailer_url"),
        "synopsis": tmdb_data.get("overview"),
        "tagline": tmdb_data.get("tagline"),
        "rating": tmdb_data.get("vote_average"),
        "vote_count": tmdb_data.get("vote_count"),
        "runtime_mins": tmdb_data.get("runtime"),
        "genres": genres or None,
        "director": tmdb_data.get("director"),
        "cast": tmdb_data.get("cast"),
    }
    english_title = tmdb_data.get("title")
    if english_title is not None:
        merged["english_title"] = english_title
    merged["original_lang"] = tmdb_data.get("original_lang")
    _log_source_disagreement(merged)
    return _LookupResult(merged, enriched=True, failed=False)


def _log_source_disagreement(movie: Movie) -> None:
    """
    Flag a match whose year or runtime is off the source's. An IMDb-id match
    skips both filters, and a runtime that fits no candidate falls back to the
    first, so this is the only trace of a match worth a second look.
    """
    source_year = movie.get("source_year")
    source_runtime = movie.get("source_runtime_mins")
    year, runtime = movie.get("year"), movie.get("runtime_mins")
    year_off = source_year is not None and year is not None and not _within(year, source_year, _YEAR_TOLERANCE)
    runtime_off = (
        source_runtime is not None
        and runtime is not None
        and not _within(runtime, source_runtime, _RUNTIME_TOLERANCE_MINS)
    )
    if year_off or runtime_off:
        log_event(
            "tmdb_match_disagrees",
            level=logging.WARNING,
            title=movie["title"],
            tmdb_id=movie.get("tmdb_id"),
            year=year,
            source_year=source_year,
            runtime_mins=runtime,
            source_runtime_mins=source_runtime,
        )


def _optional_get(
    session: requests.Session, url: str, params: dict[str, str], title: str, label: str
) -> dict[str, Any] | None:
    try:
        resp = session.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())
    except Exception as exc:
        status = http_status(exc)
        detail = f"HTTP {status}" if status else type(exc).__name__
        logger.warning("TMDb %s fetch failed for %r: %s", label, title, detail)
        return None


def _get_json(session: requests.Session, url: str, params: dict[str, str]) -> dict[str, Any]:
    resp = session.get(url, params=params, timeout=10)
    resp.raise_for_status()
    return cast(dict[str, Any], resp.json())


def _fetch_tmdb(
    movie: Movie, query: str, session: requests.Session, api_key: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    """
    Find the movie on TMDb; return (detail, videos, credits), or all None when
    nothing acceptable matches. A source IMDb id is exact, so it is looked up
    directly; otherwise the original title, then `query`, are searched.
    """
    common = {"language": "en-US", "api_key": api_key}
    detail: dict[str, Any] | None = None
    if imdb_id := movie.get("imdb_id"):
        found = _get_json(session, f"{_BASE_URL}/find/{imdb_id}", {"external_source": "imdb_id", **common})
        if results := found.get("movie_results"):
            detail = _get_json(session, f"{_BASE_URL}/movie/{results[0]['id']}", common)
            if not _is_feature(detail):
                detail = None
    if detail is None:
        for title in dict.fromkeys(t for t in (movie.get("original_title"), query) if t):
            if (detail := _search_match(movie, title, session, common)) is not None:
                break
    if detail is None:
        logger.debug("No acceptable TMDb match for %r", movie["title"])
        return None, None, None

    movie_url = f"{_BASE_URL}/movie/{detail['id']}"
    videos_data = _optional_get(session, f"{movie_url}/videos", common, query, "videos")
    credits_data = _optional_get(session, f"{movie_url}/credits", common, query, "credits")
    return detail, videos_data, credits_data


_TV_MOVIE_GENRE_ID = 10770
_TV_MOVIE_GENRE = "TV Movie"
# The Academy's line between a short and a feature.
_MIN_FEATURE_RUNTIME_MINS = 40
_YEAR_TOLERANCE = 1
_RUNTIME_TOLERANCE_MINS = 10
_MAX_DETAIL_LOOKUPS = 3


def _search_match(movie: Movie, title: str, session: requests.Session, common: dict[str, str]) -> dict[str, Any] | None:
    """
    The best search result for `title` that is a feature film, as its detail
    payload. TV movies and films off the source's year are never candidates;
    exact titles rank first, then films whose year is known (TMDb often has no
    date yet for a new release), then TMDb's own order. Shorts only show in the
    detail's runtime, so up to `_MAX_DETAIL_LOOKUPS` candidates are fetched,
    stopping at the first whose runtime fits the source's.
    """
    results: list[dict[str, Any]] = _get_json(session, f"{_BASE_URL}/search/movie", {"query": title, **common}).get(
        "results", []
    )
    source_year = movie.get("source_year")
    names = {t.casefold() for t in (title, movie["title"], movie.get("original_title")) if t}
    candidates = [
        result
        for result in results
        if _TV_MOVIE_GENRE_ID not in (result.get("genre_ids") or [])
        and (
            source_year is None
            or _release_year(result) is None
            or _within(_release_year(result), source_year, _YEAR_TOLERANCE)
        )
    ]
    candidates.sort(
        key=lambda result: (
            str(result.get("title", "")).casefold() not in names,
            source_year is not None and _release_year(result) is None,
        )
    )

    source_runtime = movie.get("source_runtime_mins")
    fallback: dict[str, Any] | None = None
    for candidate in candidates[:_MAX_DETAIL_LOOKUPS]:
        detail = _get_json(session, f"{_BASE_URL}/movie/{candidate['id']}", common)
        if not _is_feature(detail):
            continue
        if source_runtime is None or _within(detail.get("runtime"), source_runtime, _RUNTIME_TOLERANCE_MINS):
            return detail
        fallback = fallback or detail
    return fallback


def _release_year(result: Mapping[str, Any]) -> int | None:
    release_date = result.get("release_date")
    if isinstance(release_date, str) and release_date[:4].isdigit():
        return int(release_date[:4])
    return None


def _within(value: object, target: int, tolerance: int) -> bool:
    return isinstance(value, int) and abs(value - target) <= tolerance


def _is_feature(detail: Mapping[str, Any]) -> bool:
    """Not a TV movie, and not a short. An unknown (0 or absent) runtime passes."""
    genres = detail.get("genres") or []
    if any(isinstance(genre, Mapping) and genre.get("name") == _TV_MOVIE_GENRE for genre in genres):
        return False
    runtime = detail.get("runtime")
    return not (isinstance(runtime, int) and 0 < runtime < _MIN_FEATURE_RUNTIME_MINS)
