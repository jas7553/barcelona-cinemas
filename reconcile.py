"""
Reconciliation: collapse many raw Movies into one per identity.

The single home for "are these the same film, and how do we merge them."
Called twice in pipeline.py: once pre-enrichment (title-based matching) and
once post-enrichment (imdb_id-based matching to catch title-variant duplicates).

`dedup_showtimes` is reused by the public transform with a different key function.
"""

from __future__ import annotations

import string
from collections.abc import Callable, Hashable, Iterable, Mapping

from models import Movie, Showtime

_TITLE_EDGE_CHARS = f"{string.whitespace}{string.punctuation}“”‘’`"


def normalize_title(title: str) -> str:
    """Casefold a title and collapse whitespace, stripping edge punctuation."""
    return " ".join(title.strip(_TITLE_EDGE_CHARS).casefold().split())


def same_movie(left: Movie, right: Movie) -> bool:
    """
    Identity test: same film if both carry an imdb_id and they are equal,
    otherwise if normalized titles are equal. A movie with an imdb still
    matches a same-title movie that lacks one.
    """
    left_imdb = left.get("imdb_id")
    right_imdb = right.get("imdb_id")
    if left_imdb and right_imdb:
        return left_imdb == right_imdb
    return normalize_title(left["title"]) == normalize_title(right["title"])


def reconcile(movies: list[Movie]) -> list[Movie]:
    """
    Collapse movies that satisfy `same_movie` into one each, in first-seen
    order. Merges showtimes (deduped, booking links preserved) and coalesces
    every other field to the first non-null value seen.
    """
    merged: list[Movie] = []
    for movie in movies:
        for index, existing in enumerate(merged):
            if same_movie(existing, movie):
                merged[index] = _merge_pair(existing, movie)
                break
        else:
            merged.append(movie)
    return merged


def _showtime_info_score(showtime: Mapping[str, object]) -> tuple[int, int, int]:
    """
    Rank how much a showtime carries: booking link, known subtitles, premium format.

    Compared lexicographically, so the dimensions are ranked, not summed: a
    premium-format-only copy never outranks one carrying a booking link. Format
    breaks only what would otherwise be ties.
    """
    return (
        1 if showtime.get("booking_url") else 0,
        1 if showtime.get("subtitle_lang") else 0,
        1 if showtime.get("premium_format") else 0,
    )


def dedup_showtimes[S: Mapping[str, object], K: Hashable](showtimes: Iterable[S], key: Callable[[S], K]) -> list[S]:
    """
    Drop duplicate showtimes sharing a key, in first-seen order. On a collision
    the more informative copy wins (booking link, known subtitle language), so a
    bare duplicate never clobbers a richer one regardless of provider order.
    Works on any showtime-shaped mapping: the internal Showtime, or the public
    API showtime dict produced by transform.py.
    """
    deduped: dict[K, S] = {}
    for showtime in showtimes:
        showtime_key = key(showtime)
        existing = deduped.get(showtime_key)
        if existing is not None and _showtime_info_score(existing) > _showtime_info_score(showtime):
            continue
        deduped[showtime_key] = showtime
    return list(deduped.values())


def _canonical_language(showtime: Showtime) -> str:
    language = showtime.get("language")
    return language if language in {"vo", "dub"} else "vo"


def _showtime_identity(showtime: Showtime) -> tuple[str, str, str, str]:
    return (
        showtime["date"],
        showtime["time"],
        showtime["cinema"],
        _canonical_language(showtime),
    )


def _pick_title(left: str, right: str) -> str:
    return min(left, right, key=lambda v: (-len(v), v.casefold()))


def _coalesce[T](left: T | None, right: T | None) -> T | None:
    """First non-null wins."""
    return left if left is not None else right


def _merge_pair(left: Movie, right: Movie) -> Movie:
    merged_showtimes = sorted(
        dedup_showtimes([*left["showtimes"], *right["showtimes"]], key=_showtime_identity),
        key=_showtime_identity,
    )
    merged = Movie(
        title=_pick_title(left["title"], right["title"]),
        tmdb_id=_coalesce(left.get("tmdb_id"), right.get("tmdb_id")),
        imdb_id=_coalesce(left.get("imdb_id"), right.get("imdb_id")),
        year=_coalesce(left.get("year"), right.get("year")),
        poster_url=_coalesce(left.get("poster_url"), right.get("poster_url")),
        synopsis=_coalesce(left.get("synopsis"), right.get("synopsis")),
        rating=_coalesce(left.get("rating"), right.get("rating")),
        runtime_mins=_coalesce(left.get("runtime_mins"), right.get("runtime_mins")),
        genres=_coalesce(left.get("genres"), right.get("genres")),
        showtimes=merged_showtimes,
    )
    english_title = _coalesce(left.get("english_title"), right.get("english_title"))
    if english_title is not None:
        merged["english_title"] = english_title
    backdrop_url = _coalesce(left.get("backdrop_url"), right.get("backdrop_url"))
    if backdrop_url is not None:
        merged["backdrop_url"] = backdrop_url
    trailer_url = _coalesce(left.get("trailer_url"), right.get("trailer_url"))
    if trailer_url is not None:
        merged["trailer_url"] = trailer_url
    tagline = _coalesce(left.get("tagline"), right.get("tagline"))
    if tagline is not None:
        merged["tagline"] = tagline
    original_lang = _coalesce(left.get("original_lang"), right.get("original_lang"))
    if original_lang is not None:
        merged["original_lang"] = original_lang
    director = _coalesce(left.get("director"), right.get("director"))
    if director is not None:
        merged["director"] = director
    cast = _coalesce(left.get("cast"), right.get("cast"))
    if cast is not None:
        merged["cast"] = cast
    return merged
