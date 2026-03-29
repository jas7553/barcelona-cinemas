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
from validation import normalize_movie

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

    # Build a lookup of cinema short-name → CinemaInfo.  Only include cinemas
    # that have the new metadata fields (id, website_url, maps_url).
    cinema_lookup: dict[str, CinemaInfo] = {
        k: v for k, v in cinemas.items() if "id" in v
    }

    # Collect only the theater IDs that actually appear in surviving showtimes.
    seen_theater_ids: set[str] = set()

    movies_out: list[dict[str, Any]] = []
    for movie in raw_movies:
        if not isinstance(movie, Mapping):
            continue
        transformed = _transform_movie(movie, cinema_lookup, cutoff, seen_theater_ids)
        if transformed is not None:
            movies_out.append(transformed)

    theaters_out = _build_theaters(cinema_lookup, seen_theater_ids)

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
    normalized_movie = normalize_movie(movie, source="transform movie")
    imdb_id: str | None = normalized_movie["imdb_id"] if normalized_movie is not None else None
    year: int | None = movie.get("year")
    poster_url: str | None = movie.get("poster_url")
    synopsis: str | None = movie.get("synopsis")
    rating: float | None = movie.get("rating")
    runtime_mins: int | None = movie.get("runtime_mins")
    genres: list[str] = movie.get("genres") or []

    imdb_url: str | None = (
        f"https://www.imdb.com/title/{imdb_id}" if imdb_id else None
    )

    movie_id: str = str(tmdb_id) if tmdb_id is not None else title.lower().replace(" ", "-")

    showtimes_out = _transform_showtimes(
        movie.get("showtimes") or [],
        cinema_lookup,
        cutoff,
        seen_theater_ids,
    )

    return {
        "id": movie_id,
        "title": title,
        "year": year,
        "runtime_minutes": runtime_mins,
        "poster_url": poster_url,
        "genres": genres,
        "rating": rating,
        "synopsis": synopsis or "",
        "links": {
            "imdb": imdb_url,
            "letterboxd": None,
            "filmaffinity": None,
        },
        "showtimes": showtimes_out,
    }


def _transform_showtimes(
    showtimes: list[Showtime] | list[Mapping[str, Any]],
    cinema_lookup: dict[str, CinemaInfo],
    cutoff: datetime | None,
    seen_theater_ids: set[str],
) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str, str]] = set()
    out: list[dict[str, Any]] = []

    for st in showtimes:
        if not isinstance(st, Mapping):
            continue
        cinema_name: str = st.get("cinema", "")
        info = cinema_lookup.get(cinema_name)
        if info is None:
            continue

        show_date: str = st.get("date", "")
        show_time: str = st.get("time", "")

        # Filter to within 7 days of generated_at.
        if cutoff is not None and show_date:
            try:
                d = datetime.fromisoformat(show_date).replace(tzinfo=UTC)
                if d >= cutoff:
                    continue
            except ValueError:
                pass

        theater_id: str = info["id"]
        language_value = st.get("language", "vo")
        language = language_value if isinstance(language_value, str) else "vo"

        # Validate language; fall back with a warning.
        if language not in ("vo", "dub"):
            logger.warning("Unknown language value %r for showtime at %s %s", language, cinema_name, show_date)

        key = (theater_id, show_date, show_time, language)
        if key in seen:
            continue
        seen.add(key)

        seen_theater_ids.add(theater_id)
        out.append({
            "theater_id": theater_id,
            "date": show_date,
            "time": show_time,
            "language": language,
        })

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
            theaters.append({
                "id":           info["id"],
                "name":         info["name"],
                "neighborhood": info["neighborhood"],
                "website_url":  info["website_url"],
                "maps_url":     info["maps_url"],
            })
    return theaters
