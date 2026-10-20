"""
TMDb enrichment: adds synopsis, rating, runtime, and genres to collected movies.

For each movie title not already in the cache, TMDb is queried:
  1. /3/search/movie       — find best match and retrieve the TMDb ID
  2. /3/movie/{id}         — retrieve runtime, named genres and release dates (search only returns IDs)
  3. /3/movie/{id}/videos  — retrieve trailer URL (non-fatal on failure)
  4. /3/movie/{id}/credits — retrieve director + top cast (non-fatal on failure)

Failures are logged and result in null metadata fields; this module never raises.
"""

import logging
import os
from datetime import UTC, date, datetime, timedelta
from typing import Any, NamedTuple, TypedDict, cast

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from http_errors import http_status
from listings_config import resolve_env_or_ssm
from models import Movie
from observability import emit_metric, log_event
from providers.common import assume_utc, madrid_today
from reconcile import normalize_title
from validation import normalize_tmdb_payload

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.themoviedb.org/3"
_ENRICH_TTL_DAYS = int(os.environ.get("ENRICH_TTL_DAYS", "7"))

# Bump when the matching rules change, so cached matches made under the old
# rules are looked up again on the next refresh instead of at their TTL.
_MATCH_VERSION = 2

_TV_MOVIE_GENRE_ID = 10770
# Release windows for a new film (see `_rank_candidates`). The primary release
# may be a festival premiere well before the Spanish one; ahead admits previews.
_RECENT_RELEASE_BEFORE = timedelta(days=730)
_FIRST_RUN_BEFORE = timedelta(days=365)
_RELEASE_AHEAD = timedelta(days=90)
# TMDb release types: premiere, limited theatrical, theatrical.
_CINEMA_RELEASE_TYPES = {1, 2, 3}
# Below this, a runtime marks a short (the Academy's cut-off).
_MIN_FEATURE_RUNTIME = 40
_MAX_FIRST_RUN_PROBES = 2
_MAX_DETAIL_PROBES = 3


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
    # English titles too: the cached copy may be held by another provider's Spanish-titled listing.
    cached_by_title: dict[str, Movie] = {
        english_title.lower(): m for m in cached_movies if (english_title := m.get("english_title"))
    }
    cached_by_title.update({m["title"].lower(): m for m in cached_movies})

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
                enriched.append({**cached, "showtimes": movie["showtimes"]})
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
                    enriched.append({**cached, "showtimes": movie["showtimes"]})
                else:
                    enriched.append(result.movie)
        if stats["tmdb_failure_count"]:
            emit_metric("TmdbLookupFailure", stats["tmdb_failure_count"])
        emit_metric("MoviesEnriched", stats["tmdb_enriched_count"])
        log_event("tmdb_enrichment_summary", movie_count=len(movies), **stats)
        return enriched, stats


def _needs_reenrichment(cached: Movie) -> bool:
    if cached.get("tmdb_match_version", 1) < _MATCH_VERSION:
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
    return cached_by_title.get(movie["title"].lower())


def _lookup_and_merge(
    movie: Movie, session: requests.Session, api_key: str, *, search_title: str | None = None
) -> _LookupResult:
    """Look up a movie on TMDb and merge metadata into the Movie dict."""
    query = search_title or movie["title"]
    try:
        raw_detail, raw_videos, raw_credits = _fetch_tmdb(
            query, session, api_key, year=movie.get("year"), today=madrid_today()
        )
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
        "tmdb_match_version": _MATCH_VERSION,
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


def _parse_date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _released_within(value: object, today: date, before: timedelta) -> bool:
    released = _parse_date(value)
    return released is not None and today - before <= released <= today + _RELEASE_AHEAD


def _rank_candidates(
    title: str, results: list[dict[str, Any]], *, year: int | None, today: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    The search results that may be `title`: recent releases to try first, which
    win only in their Spanish first run, then every candidate in order.

    TV movies never match. A title match is exact; with none, TMDb's top result
    stands in, as that is how a Spanish-titled listing finds its film. Among
    several films sharing the title, those released in the provider's `year`
    (±1, for festival premieres) come first when it gives one. Otherwise a new
    release is the usual reason for a title clash, so recent ones are tried
    first; failing that, TMDb's popularity order stands, which is what keeps a
    repertory classic ahead of its obscure namesakes.
    """
    films = [r for r in results if _TV_MOVIE_GENRE_ID not in (r.get("genre_ids") or [])]
    key = normalize_title(title)
    exact = [r for r in films if normalize_title(str(r.get("title", ""))) == key]
    if not exact:
        return [], films[:1]
    if year is not None:

        def near_year(r: dict[str, Any]) -> bool:
            released = _parse_date(r.get("release_date"))
            return released is not None and abs(released.year - year) <= 1

        return [], sorted(exact, key=lambda r: not near_year(r))
    recent = [r for r in exact if _released_within(r.get("release_date"), today, _RECENT_RELEASE_BEFORE)]
    return recent[:_MAX_FIRST_RUN_PROBES], exact


def _in_spanish_first_run(detail: dict[str, Any], today: date) -> bool:
    countries = (detail.get("release_dates") or {}).get("results") or []
    return any(
        release.get("type") in _CINEMA_RELEASE_TYPES
        and _released_within(release.get("release_date"), today, _FIRST_RUN_BEFORE)
        for country in countries
        if country.get("iso_3166_1") == "ES"
        for release in country.get("release_dates") or []
    )


def _is_feature_length(detail: dict[str, Any]) -> bool:
    runtime = detail.get("runtime")
    # TMDb gives 0 for an unknown runtime, common before release.
    return not isinstance(runtime, int) or runtime == 0 or runtime >= _MIN_FEATURE_RUNTIME


def _fetch_tmdb(
    title: str, session: requests.Session, api_key: str, *, year: int | None, today: date
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    """Search TMDb for a title; return (detail, videos, credits), or all None on no match."""
    common = {"language": "en-US", "api_key": api_key}
    search_resp = session.get(
        f"{_BASE_URL}/search/movie",
        params={"query": title, **common},
        timeout=10,
    )
    search_resp.raise_for_status()
    results: list[dict[str, Any]] = search_resp.json().get("results", [])

    first_run, ordered = _rank_candidates(title, results, year=year, today=today)
    details: dict[int, dict[str, Any]] = {}

    def fetch_detail(candidate: dict[str, Any]) -> dict[str, Any]:
        movie_id = candidate["id"]
        if movie_id not in details:
            detail_resp = session.get(
                f"{_BASE_URL}/movie/{movie_id}", params={**common, "append_to_response": "release_dates"}, timeout=10
            )
            detail_resp.raise_for_status()
            details[movie_id] = cast(dict[str, Any], detail_resp.json())
        return details[movie_id]

    # Runtime and release dates are only in the detail. Without a recent film in
    # its Spanish first run, take the first feature-length candidate, else the top one.
    chosen = next(
        (
            c
            for c in first_run
            if _in_spanish_first_run(detail := fetch_detail(c), today) and _is_feature_length(detail)
        ),
        None,
    )
    if chosen is None:
        for candidate in ordered[:_MAX_DETAIL_PROBES]:
            if chosen is None:
                chosen = candidate
            if _is_feature_length(fetch_detail(candidate)):
                chosen = candidate
                break
    if chosen is None:
        logger.debug("No TMDb results for %r", title)
        return None, None, None
    detail_data = details[chosen["id"]]
    movie_url = f"{_BASE_URL}/movie/{chosen['id']}"

    videos_data = _optional_get(session, f"{movie_url}/videos", common, title, "videos")
    credits_data = _optional_get(session, f"{movie_url}/credits", common, title, "credits")

    return detail_data, videos_data, credits_data
