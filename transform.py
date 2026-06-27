"""
Transform internal Listings data to the public API shape defined in HANDOFF.md §3.

Called at the HTTP boundary (app.py) so internal models stay decoupled from the
API contract.  Also handles the stale-cache fallback path.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from models import CinemaInfo, CinemaRegistry, Listings, Movie, Showtime
from reconcile import dedup_showtimes

logger = logging.getLogger(__name__)


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

    movies_out: list[dict[str, Any]] = []
    for movie in raw_movies:
        if not isinstance(movie, Mapping):
            continue
        transformed = _transform_movie(movie, cinemas, cutoff, seen_theater_ids)
        if transformed is not None:
            movies_out.append(transformed)

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
) -> dict[str, Any] | None:
    title: str = movie.get("title", "")
    if not title:
        return None

    tmdb_id: int | None = movie.get("tmdb_id")
    imdb_id: str | None = movie.get("imdb_id")

    showtimes_out = _transform_showtimes(
        movie.get("showtimes") or [],
        cinema_lookup,
        cutoff,
        seen_theater_ids,
    )

    return {
        "id": str(tmdb_id) if tmdb_id is not None else title.lower().replace(" ", "-"),
        "title": title,
        "year": movie.get("year"),
        "runtime_minutes": movie.get("runtime_mins"),
        "poster_url": movie.get("poster_url"),
        "backdrop_url": movie.get("backdrop_url"),
        "trailer_url": movie.get("trailer_url"),
        "genres": movie.get("genres") or [],
        "rating": movie.get("rating"),
        "vote_count": movie.get("vote_count"),
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
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for st in showtimes:
        if not isinstance(st, Mapping):
            continue
        cinema_name: str = st.get("cinema", "")
        info = cinema_lookup.get(cinema_name)
        if info is None:
            continue

        show_date: str = st.get("date", "")
        show_time: str = st.get("time", "")

        if cutoff is not None and show_date:
            try:
                d = datetime.fromisoformat(show_date).replace(tzinfo=UTC)
                if d >= cutoff:
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

        candidates.append(
            {
                "theater_id": info["id"],
                "date": show_date,
                "time": show_time,
                "language": language,
                "audio_lang": audio_lang,
                "subtitle_lang": subtitle_lang,
                "booking_url": booking_url,
            }
        )

    out = dedup_showtimes(
        candidates,
        key=lambda s: (s["theater_id"], s["date"], s["time"], s["language"]),
    )
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
