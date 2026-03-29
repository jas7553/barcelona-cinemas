"""Validation and normalization for cached and fetched movie listing data."""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Mapping
from contextlib import suppress
from datetime import date, datetime
from typing import Any

from models import Listings, Movie, Showtime

logger = logging.getLogger(__name__)

_IMDB_ID_RE = re.compile(r"tt\d+")
_TMDB_POSTER_PATH_RE = re.compile(r"/[^?#]+")
_TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342"


def normalize_listings(data: object, *, source: str) -> Listings | None:
    """Validate a listings payload and return a normalized copy."""
    if not isinstance(data, Mapping):
        logger.warning("Rejected %s: listings payload is not an object", source)
        return None

    fetched_at = _as_iso_datetime(data.get("fetched_at"))
    stale = data.get("stale")
    movies_raw = data.get("movies")
    if fetched_at is None or not isinstance(stale, bool) or not isinstance(movies_raw, list):
        logger.warning("Rejected %s: listings payload has invalid top-level fields", source)
        return None

    movies = normalize_movies(movies_raw, source=source)
    return Listings(fetched_at=fetched_at, stale=stale, movies=movies)


def normalize_movies(data: object, *, source: str) -> list[Movie]:
    """Validate a movie list and drop invalid entries."""
    if not isinstance(data, list):
        logger.warning("Rejected %s: movies payload is not a list", source)
        return []

    movies: list[Movie] = []
    for index, movie_raw in enumerate(data):
        movie = normalize_movie(movie_raw, source=f"{source} movie[{index}]")
        if movie is not None:
            movies.append(movie)
    return movies


def normalize_movie(data: object, *, source: str) -> Movie | None:
    """Validate a movie payload and return a normalized copy."""
    if not isinstance(data, Mapping):
        logger.warning("Rejected %s: movie is not an object", source)
        return None

    title = _as_non_empty_string(data.get("title"))
    showtimes_raw = data.get("showtimes")
    if title is None or not isinstance(showtimes_raw, list):
        logger.warning("Rejected %s: movie is missing a valid title or showtimes list", source)
        return None

    showtimes = normalize_showtimes(showtimes_raw, source=source)
    return Movie(
        title=title,
        tmdb_id=_as_optional_int(data.get("tmdb_id"), source=f"{source} tmdb_id"),
        imdb_id=_as_optional_imdb_id(data.get("imdb_id"), source=f"{source} imdb_id"),
        year=_as_optional_positive_int(data.get("year"), source=f"{source} year"),
        poster_url=_as_optional_string(data.get("poster_url"), source=f"{source} poster_url"),
        synopsis=_as_optional_string(data.get("synopsis"), source=f"{source} synopsis"),
        rating=_as_optional_rating(data.get("rating"), source=f"{source} rating"),
        runtime_mins=_as_optional_positive_int(data.get("runtime_mins"), source=f"{source} runtime_mins"),
        genres=_as_optional_genres(data.get("genres"), source=f"{source} genres"),
        showtimes=showtimes,
    )


def normalize_showtimes(data: object, *, source: str) -> list[Showtime]:
    """Validate a showtime list and drop invalid entries."""
    if not isinstance(data, list):
        logger.warning("Rejected %s: showtimes payload is not a list", source)
        return []

    showtimes: list[Showtime] = []
    for index, showtime_raw in enumerate(data):
        showtime = normalize_showtime(showtime_raw, source=f"{source} showtime[{index}]")
        if showtime is not None:
            showtimes.append(showtime)
    return showtimes


def normalize_showtime(data: object, *, source: str) -> Showtime | None:
    """Validate a showtime payload and return a normalized copy."""
    if not isinstance(data, Mapping):
        logger.warning("Rejected %s: showtime is not an object", source)
        return None

    cinema = _as_non_empty_string(data.get("cinema"))
    neighborhood = _as_non_empty_string(data.get("neighborhood"))
    address = _as_string(data.get("address"))
    show_date = _as_iso_date(data.get("date"))
    show_time = _as_clock_time(data.get("time"))
    if cinema is None or neighborhood is None or address is None or show_date is None or show_time is None:
        logger.warning("Rejected %s: showtime has invalid required fields", source)
        return None

    showtime = Showtime(
        cinema=cinema,
        neighborhood=neighborhood,
        address=address,
        date=show_date,
        time=show_time,
    )
    language = _as_optional_language(data.get("language"), source=f"{source} language")
    if language is not None:
        showtime["language"] = language
    return showtime


def normalize_tmdb_payload(data: object, *, title: str) -> dict[str, Any] | None:
    """Validate TMDb detail payload fields we merge into the app model."""
    if not isinstance(data, Mapping):
        logger.warning("Rejected TMDb payload for %r: detail payload is not an object", title)
        return None

    tmdb_id = _as_optional_int(data.get("id"), source=f"TMDb id for {title!r}")
    if tmdb_id is None:
        logger.warning("Rejected TMDb payload for %r: missing valid id", title)
        return None

    normalized: dict[str, Any] = {"id": tmdb_id}

    overview = _as_optional_string(data.get("overview"), source=f"TMDb overview for {title!r}")
    if overview is not None:
        normalized["overview"] = overview

    rating = _as_optional_rating(data.get("vote_average"), source=f"TMDb vote_average for {title!r}")
    if rating is not None:
        normalized["vote_average"] = rating

    runtime = _as_optional_positive_int(data.get("runtime"), source=f"TMDb runtime for {title!r}")
    if runtime is not None:
        normalized["runtime"] = runtime

    genres = _as_optional_genres_from_tmdb(data.get("genres"), title=title)
    if genres is not None:
        normalized["genres"] = genres

    poster_url = _as_tmdb_poster_url(data.get("poster_path"), title=title)
    if poster_url is not None:
        normalized["poster_url"] = poster_url

    # release_date is "YYYY-MM-DD"; extract the 4-digit year as int.
    release_date = data.get("release_date")
    if isinstance(release_date, str) and len(release_date) >= 4:
        with suppress(ValueError):
            normalized["year"] = int(release_date[:4])

    imdb_id = _as_optional_imdb_id(data.get("imdb_id"), source=f"TMDb imdb_id for {title!r}")
    if imdb_id is not None:
        normalized["imdb_id"] = imdb_id

    return normalized


def _as_non_empty_string(value: object) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            return stripped
    return None


def _as_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _as_optional_string(value: object, *, source: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    logger.warning("Discarded %s: expected string or null", source)
    return None


def _as_optional_imdb_id(value: object, *, source: str) -> str | None:
    imdb_id = _as_optional_string(value, source=source)
    if imdb_id is None:
        return None
    if _IMDB_ID_RE.fullmatch(imdb_id):
        return imdb_id
    logger.warning("Discarded %s: expected IMDb title id", source)
    return None


def _as_optional_language(value: object, *, source: str) -> str | None:
    language = _as_optional_string(value, source=source)
    if language is None:
        return None
    if language in ("vo", "dub"):
        return language
    logger.warning("Discarded %s: expected 'vo', 'dub', or null", source)
    return None


def _as_tmdb_poster_url(value: object, *, title: str) -> str | None:
    poster_path = _as_optional_string(value, source=f"TMDb poster_path for {title!r}")
    if poster_path is None:
        return None
    if _TMDB_POSTER_PATH_RE.fullmatch(poster_path):
        return f"{_TMDB_POSTER_BASE_URL}{poster_path}"
    logger.warning("Discarded TMDb poster_path for %r: expected image path", title)
    return None


def _as_optional_int(value: object, *, source: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        logger.warning("Discarded %s: expected integer or null", source)
        return None
    return value


def _as_optional_positive_int(value: object, *, source: str) -> int | None:
    parsed = _as_optional_int(value, source=source)
    if parsed is None:
        return None
    if parsed <= 0:
        logger.warning("Discarded %s: expected positive integer", source)
        return None
    return parsed


def _as_optional_rating(value: object, *, source: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        logger.warning("Discarded %s: expected numeric rating or null", source)
        return None

    rating = float(value)
    if not math.isfinite(rating) or not 0 <= rating <= 10:
        logger.warning("Discarded %s: rating is out of range", source)
        return None
    return rating


def _as_optional_genres(value: object, *, source: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        logger.warning("Discarded %s: expected list of genre strings or null", source)
        return None

    genres: list[str] = []
    for index, item in enumerate(value):
        genre = _as_non_empty_string(item)
        if genre is None:
            logger.warning("Discarded %s[%s]: expected non-empty genre string", source, index)
            continue
        genres.append(genre)

    return genres or None


def _as_optional_genres_from_tmdb(value: object, *, title: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        logger.warning("Discarded TMDb genres for %r: expected list", title)
        return None

    genres: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            logger.warning("Discarded TMDb genre %s for %r: expected object", index, title)
            continue
        name = _as_non_empty_string(item.get("name"))
        if name is None:
            logger.warning("Discarded TMDb genre %s for %r: invalid name", index, title)
            continue
        genres.append(name)

    return genres or None


def _as_iso_datetime(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.isoformat()


def _as_iso_date(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed.isoformat()


def _as_clock_time(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 2:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError:
        return None
    if not 0 <= hours <= 23 or not 0 <= minutes <= 59:
        return None
    return f"{hours:02d}:{minutes:02d}"
