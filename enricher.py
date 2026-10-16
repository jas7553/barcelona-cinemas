"""
TMDb enrichment: adds synopsis, rating, runtime, and genres to collected movies.

For each movie title not already in the cache, TMDb is queried:
  1. /3/search/movie       — rank the candidates (see `_fetch_tmdb` for the rules)
  2. /3/movie/{id}         — retrieve runtime and named genres (search only returns IDs);
                             a short or TV movie is skipped for the next candidate
  3. /3/movie/{id}/videos  — retrieve trailer URL (non-fatal on failure)
  4. /3/movie/{id}/credits — retrieve director + top cast (non-fatal on failure)

Failures are logged and result in null metadata fields; this module never raises.
"""

import logging
import os
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
            # A cached short or TV movie is a wrong match from before the
            # matching rules: look it up again, and never fall back to it.
            if cached is not None and cached.get("tmdb_id") is not None and _is_excluded_cached(cached):
                cached = None
            if cached and cached.get("tmdb_id") is not None and not _needs_reenrichment(cached):
                stats["tmdb_cache_hit_count"] += 1
                enriched.append(_with_fresh_listing(cached, movie))
            else:
                if cached and cached.get("tmdb_id") is not None:
                    stats["tmdb_reenriched_count"] += 1
                result = _lookup_and_merge(
                    movie,
                    session,
                    key,
                    search_title=cached.get("english_title") if cached else None,
                )
                if result.enriched:
                    stats["tmdb_enriched_count"] += 1
                if result.failed:
                    stats["tmdb_failure_count"] += 1
                # A re-enrichment that produced nothing (network failure or no
                # TMDb match) must not discard good cached metadata — keep the
                # cached copy with fresh showtimes rather than reverting to the
                # bare scraped listing. Uncached titles still fall through.
                if not result.enriched and cached is not None and cached.get("tmdb_id") is not None:
                    enriched.append(_with_fresh_listing(cached, movie))
                else:
                    enriched.append(result.movie)
        if stats["tmdb_failure_count"]:
            emit_metric("TmdbLookupFailure", stats["tmdb_failure_count"])
        emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return enriched, stats


def _with_fresh_listing(cached: Movie, movie: Movie) -> Movie:
    """Cached TMDb metadata with this run's provider-known facts: Showtimes and the re-release flag."""
    reused: Movie = {**cached, "showtimes": movie["showtimes"]}
    reused.pop("rerelease", None)
    if movie.get("rerelease"):
        reused["rerelease"] = True
    return reused


def _needs_reenrichment(cached: Movie) -> bool:
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
    return cached_by_title.get(movie["title"].lower())


def _lookup_and_merge(
    movie: Movie, session: requests.Session, api_key: str, *, search_title: str | None = None
) -> _LookupResult:
    """Look up a movie on TMDb and merge metadata into the Movie dict."""
    query = search_title or movie["title"]
    try:
        raw_detail, raw_videos, raw_credits = _fetch_tmdb(query, session, api_key, year=movie.get("year"))
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
        "tmdb_id": tmdb_data.get("id"),
        "imdb_id": tmdb_data.get("imdb_id"),
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
    return _LookupResult(merged, enriched=True, failed=False)


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


# TMDb's "TV Movie" genre. A cinema never screens one, but TMDb lists TV
# remakes under the same title (The Miracle Worker, 1962 vs. the 2000 TV movie).
_TV_MOVIE_GENRE_ID = 10770
_TV_MOVIE_GENRE = "TV Movie"

# A short by the Academy's definition: 40 minutes or less. A cinema listing
# is a feature, so a short sharing its title (Stranger Than Paradise's 1982
# short) is never the film.
_MAX_SHORT_RUNTIME_MINS = 40

# Detail lookups spent finding a feature among same-title candidates before
# giving up: each is one more TMDb request for this film.
_MAX_CANDIDATES = 3


def _is_excluded(detail: dict[str, Any]) -> bool:
    """A TMDb match no cinema listing can be: a short or a TV movie."""
    runtime = detail.get("runtime")
    # Unknown runtime (TMDb's 0 for a new release) is not evidence of a short.
    if isinstance(runtime, int) and 0 < runtime <= _MAX_SHORT_RUNTIME_MINS:
        return True
    genres = detail.get("genres") or []
    return any(
        isinstance(g, dict) and (g.get("id") == _TV_MOVIE_GENRE_ID or g.get("name") == _TV_MOVIE_GENRE) for g in genres
    )


def _is_excluded_cached(movie: Movie) -> bool:
    """`_is_excluded` for an already-enriched Movie: a wrong match to redo."""
    runtime = movie.get("runtime_mins")
    if runtime is not None and runtime <= _MAX_SHORT_RUNTIME_MINS:
        return True
    return _TV_MOVIE_GENRE in (movie.get("genres") or [])


def _release_year(result: dict[str, Any]) -> int | None:
    release_date = result.get("release_date")
    if isinstance(release_date, str) and len(release_date) >= 4 and release_date[:4].isdigit():
        return int(release_date[:4])
    return None


def _rank_candidates(results: list[dict[str, Any]], title: str, year: int | None) -> list[dict[str, Any]]:
    """
    Search results in the order to try them: TV movies out; then the
    cinema's year (within a year either way: festival vs. release dates);
    then an exact title; then TMDb's own relevance order.
    """
    wanted = title.casefold()

    def key(indexed: tuple[int, dict[str, Any]]) -> tuple[bool, bool, int]:
        index, result = indexed
        titles = {str(result.get("title", "")).casefold(), str(result.get("original_title", "")).casefold()}
        result_year = _release_year(result)
        year_fits = year is None or (result_year is not None and abs(result_year - year) <= 1)
        return (not year_fits, wanted not in titles, index)

    features = [r for r in results if _TV_MOVIE_GENRE_ID not in (r.get("genre_ids") or [])]
    return [result for _, result in sorted(enumerate(features), key=key)]


def _fetch_tmdb(
    title: str, session: requests.Session, api_key: str, *, year: int | None = None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    """
    Search TMDb for a title; return (detail, videos, credits), or all None
    when nothing matches.

    Matching rules (no per-film overrides): never a short or a TV movie; the
    cinema's year when it gives one; among films sharing the title, the first
    whose runtime fits a feature.
    """
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

    detail_data: dict[str, Any] | None = None
    match_id: object = None
    for candidate in _rank_candidates(results, title, year)[:_MAX_CANDIDATES]:
        detail_resp = session.get(f"{_BASE_URL}/movie/{candidate['id']}", params=common, timeout=10)
        detail_resp.raise_for_status()
        detail = cast(dict[str, Any], detail_resp.json())
        if not _is_excluded(detail):
            detail_data, match_id = detail, candidate["id"]
            break
        logger.info("Skipped TMDb %s for %r: a short or TV movie", candidate.get("id"), title)

    if detail_data is None:
        logger.debug("No feature-length TMDb match for %r", title)
        return None, None, None

    movie_url = f"{_BASE_URL}/movie/{match_id}"
    videos_data = _optional_get(session, f"{movie_url}/videos", common, title, "videos")
    credits_data = _optional_get(session, f"{movie_url}/credits", common, title, "credits")

    return detail_data, videos_data, credits_data
