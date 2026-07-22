"""
Transform internal Listings data to the public API shape defined in HANDOFF.md §3.

Called at the HTTP boundary (app.py) so internal models stay decoupled from the
API contract.  Also handles the stale-cache fallback path.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from models import PREMIUM_FORMATS, CinemaInfo, CinemaRegistry, Listings, Movie, Showtime
from observability import log_event
from reconcile import dedup_showtimes

logger = logging.getLogger(__name__)

# Cap the excluded-title list so one bad refresh cannot balloon a log line.
_MAX_LOGGED_TITLES = 25


@dataclass
class _TransformStats:
    """
    Running account of everything `to_api_response` drops.

    The public payload is much smaller than the cache it comes from, and every
    reduction here is silent by construction (a filtered movie simply never
    reaches the output list). Counting them is what makes the gap between
    `MoviesCollected` and `ssg_data_published` explainable.
    """

    movies_in: int = 0
    movies_out: int = 0
    excluded_no_title: int = 0
    excluded_no_showtimes: int = 0
    excluded_malformed: int = 0
    excluded_titles: list[str] = field(default_factory=list)
    showtimes_in: int = 0
    showtimes_out: int = 0
    dropped_unknown_cinema: int = 0
    dropped_beyond_cutoff: int = 0
    dropped_malformed: int = 0
    showtimes_deduped: int = 0
    # A cinema key that stops matching cinemas.json drops every one of its
    # showtimes without failing anything — name the offenders.
    unknown_cinemas: set[str] = field(default_factory=set)

    def log(self) -> None:
        payload = asdict(self)
        payload["excluded_titles"] = self.excluded_titles[:_MAX_LOGGED_TITLES]
        payload["unknown_cinemas"] = sorted(self.unknown_cinemas)
        log_event("transform_summary", **payload)


def to_api_response(listings: Listings | Mapping[str, Any], cinemas: CinemaRegistry) -> dict[str, Any]:
    """
    Convert an internal Listings dict to the spec-compliant API shape:
      { generated_at, stale, theaters[], movies[] }

    Safe to call with old cached data that predates the year/imdb_id fields —
    missing values are treated as None.
    """
    generated_at: str = listings.get("fetched_at", "")
    stale: bool = bool(listings.get("stale", False))
    raw_movies = listings.get("movies", [])

    cutoff = _parse_cutoff(generated_at)

    seen_theater_ids: set[str] = set()
    stats = _TransformStats(movies_in=len(raw_movies))

    movies_out: list[dict[str, Any]] = []
    for movie in raw_movies:
        if not isinstance(movie, Mapping):
            stats.excluded_malformed += 1
            continue
        transformed = _transform_movie(movie, cinemas, cutoff, seen_theater_ids, stats)
        if transformed is not None:
            movies_out.append(transformed)

    stats.movies_out = len(movies_out)
    stats.log()

    theaters_out = _build_theaters(cinemas, seen_theater_ids)

    return {
        "generated_at": generated_at,
        "stale": stale,
        "theaters": theaters_out,
        "movies": movies_out,
    }


def _parse_cutoff(generated_at: str) -> datetime | None:
    """Return the datetime 7 days after generated_at, or None if unparseable."""
    if not generated_at:
        return None
    try:
        dt = datetime.fromisoformat(generated_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt + timedelta(days=7)
    except ValueError:
        return None


def _transform_movie(
    movie: Movie | Mapping[str, Any],
    cinema_lookup: dict[str, CinemaInfo],
    cutoff: datetime | None,
    seen_theater_ids: set[str],
    stats: _TransformStats,
) -> dict[str, Any] | None:
    title: str = movie.get("english_title") or movie.get("title", "")
    if not title:
        stats.excluded_no_title += 1
        return None

    tmdb_id: int | None = movie.get("tmdb_id")
    imdb_id: str | None = movie.get("imdb_id")

    showtimes_out = _transform_showtimes(
        movie.get("showtimes") or [],
        cinema_lookup,
        cutoff,
        seen_theater_ids,
        stats,
    )

    if not showtimes_out:
        stats.excluded_no_showtimes += 1
        stats.excluded_titles.append(title)
        return None

    # A rating of 0.0 with zero votes means "not yet rated", not "rated zero" —
    # suppress it so the frontend doesn't render a misleading "0.0" badge.
    vote_count = movie.get("vote_count")
    rating = movie.get("rating") if vote_count != 0 else None

    return {
        "id": str(tmdb_id) if tmdb_id is not None else title.lower().replace(" ", "-"),
        "title": title,
        "year": movie.get("year"),
        "runtime_minutes": movie.get("runtime_mins"),
        "poster_url": movie.get("poster_url"),
        "backdrop_url": movie.get("backdrop_url"),
        "trailer_url": movie.get("trailer_url"),
        "genres": movie.get("genres") or [],
        "rating": rating,
        "vote_count": vote_count,
        "original_lang": movie.get("original_lang"),
        "director": movie.get("director"),
        "cast": movie.get("cast") or [],
        "synopsis": movie.get("synopsis") or "",
        "tagline": movie.get("tagline"),
        "links": {
            "imdb": f"https://www.imdb.com/title/{imdb_id}" if imdb_id else None,
            "imdb_id": imdb_id,
        },
        "showtimes": showtimes_out,
    }


def _transform_showtimes(
    showtimes: list[Showtime] | list[Mapping[str, Any]],
    cinema_lookup: dict[str, CinemaInfo],
    cutoff: datetime | None,
    seen_theater_ids: set[str],
    stats: _TransformStats,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    stats.showtimes_in += len(showtimes)

    for st in showtimes:
        if not isinstance(st, Mapping):
            stats.dropped_malformed += 1
            continue
        cinema_name: str = st.get("cinema", "")
        info = cinema_lookup.get(cinema_name)
        if info is None:
            stats.dropped_unknown_cinema += 1
            stats.unknown_cinemas.add(cinema_name)
            continue

        show_date: str = st.get("date", "")
        show_time: str = st.get("time", "")

        if cutoff is not None and show_date:
            try:
                d = datetime.fromisoformat(show_date).replace(tzinfo=UTC)
                if d >= cutoff:
                    stats.dropped_beyond_cutoff += 1
                    continue
            except ValueError:
                pass

        lang_raw = st.get("language", "vo")
        language = lang_raw if isinstance(lang_raw, str) else "vo"

        if language not in ("vo", "dub"):
            logger.warning("Unknown language value %r for showtime at %s %s", language, cinema_name, show_date)

        booking_url = v if isinstance(v := st.get("booking_url"), str) else None
        audio_lang = v if (v := st.get("audio_lang")) in ("en", "other") else None
        subtitle_lang = v if (v := st.get("subtitle_lang")) in ("en", "es", "ca") else None
        premium_format = v if (v := st.get("premium_format")) in PREMIUM_FORMATS else None

        candidates.append(
            {
                "theater_id": info["id"],
                "date": show_date,
                "time": show_time,
                "language": language,
                "audio_lang": audio_lang,
                "subtitle_lang": subtitle_lang,
                "booking_url": booking_url,
                "premium_format": premium_format,
            }
        )

    out = dedup_showtimes(
        candidates,
        key=lambda s: (s["theater_id"], s["date"], s["time"], s["language"]),
    )
    stats.showtimes_deduped += len(candidates) - len(out)
    stats.showtimes_out += len(out)
    for showtime in out:
        seen_theater_ids.add(showtime["theater_id"])
    return out


def _build_theaters(
    cinema_lookup: dict[str, CinemaInfo],
    seen_theater_ids: set[str],
) -> list[dict[str, Any]]:
    """Return Theater objects only for theaters that appear in the filtered showtimes."""
    theaters: list[dict[str, Any]] = []
    # Preserve cinemas.json order (Python dicts are insertion-ordered).
    for info in cinema_lookup.values():
        if info["id"] in seen_theater_ids:
            theaters.append(
                {
                    "id": info["id"],
                    "name": info["name"],
                    "address": info["address"],
                    "neighborhood": info["neighborhood"],
                    "website_url": info["website_url"],
                    "maps_url": info["maps_url"],
                    "lat": info.get("lat"),
                    "lng": info.get("lng"),
                }
            )
    return theaters
