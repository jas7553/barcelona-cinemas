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
from typing import cast

from models import Movie, Showtime
from observability import log_event

_TITLE_EDGE_CHARS = f"{string.whitespace}{string.punctuation}“”‘’`"

# Cap the merge list so one pathological run cannot balloon a log line.
_MAX_LOGGED_MERGES = 25


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


def reconcile(movies: list[Movie], *, stage: str | None = None) -> list[Movie]:
    """
    Collapse movies that satisfy `same_movie` into one each, in first-seen
    order. Merges showtimes (deduped, booking links preserved) and coalesces
    every other field to the first non-null value seen.

    Pass `stage` to log a `reconcile_summary` for the collapse. Without it the
    reconcile is silent — providers reconcile their own output before the
    pipeline ever sees it, and those counts are already covered by
    `provider_collection_summary`.
    """
    merged: list[Movie] = []
    cross_title_merges: list[str] = []
    for movie in movies:
        for index, existing in enumerate(merged):
            if same_movie(existing, movie):
                # Only the logged stages pay for the title comparison; providers
                # reconcile their own output on every fetch.
                if stage is not None and normalize_title(existing["title"]) != normalize_title(movie["title"]):
                    cross_title_merges.append(f"{existing['title']} ← {movie['title']}")
                merged[index] = _merge_pair(existing, movie)
                break
        else:
            merged.append(movie)
    if stage is not None:
        _log_reconcile_summary(stage, movies, merged, cross_title_merges)
    return merged


def _log_reconcile_summary(
    stage: str,
    before: list[Movie],
    after: list[Movie],
    cross_title_merges: list[str],
) -> None:
    """
    Account for every movie and showtime the collapse removed.

    `cross_title_merges` is the diagnostic that matters: same-title merges are
    routine, but two differently-titled films collapsing into one is either an
    imdb_id match doing its job or an over-merge silently hiding a film. Naming
    them is the only way to tell the two apart after the fact.
    """
    showtimes_in = sum(len(movie["showtimes"]) for movie in before)
    showtimes_out = sum(len(movie["showtimes"]) for movie in after)
    log_event(
        "reconcile_summary",
        stage=stage,
        movies_in=len(before),
        movies_out=len(after),
        movies_merged=len(before) - len(after),
        showtimes_in=showtimes_in,
        showtimes_out=showtimes_out,
        showtimes_deduped=showtimes_in - showtimes_out,
        cross_title_merge_count=len(cross_title_merges),
        cross_title_merges=cross_title_merges[:_MAX_LOGGED_MERGES],
    )


# Every field a duplicate copy may or may not carry: the dedup key pins only
# the identity fields (and canonicalizes `language`, so a copy stating it
# outranks one leaving it absent). Coalescing them all makes the merge lossless
# whatever the provider order.
_INFO_FIELDS = ("language", "booking_url", "audio_lang", "subtitle_lang", "premium_format")


def _merge_showtime_info[S: Mapping[str, object]](base: S, other: S) -> S:
    """
    Fill the `_INFO_FIELDS` `base` lacks from `other`, leaving everything else
    to `base`. The two are duplicates by key, so their identity fields agree;
    only the optional enrichment differs, and each provider carries a different
    subset of it (SensaCine has booking links, the ECB feed has IMAX badges).
    Returns `base` untouched when there is nothing to add.
    """
    extras = {field: value for field in _INFO_FIELDS if (value := other.get(field)) and not base.get(field)}
    if not extras:
        return base
    return cast(S, {**base, **extras})


def dedup_showtimes[S: Mapping[str, object], K: Hashable](showtimes: Iterable[S], key: Callable[[S], K]) -> list[S]:
    """
    Collapse duplicate showtimes sharing a key, in first-seen order. Merging is
    lossless for `_INFO_FIELDS`: whichever copy carries a booking link, a known
    subtitle language or a premium format contributes it, regardless of provider
    order. The first-seen copy is the base and supplies everything else.
    Works on any showtime-shaped mapping: the internal Showtime, or the public
    API showtime dict produced by transform.py.
    """
    deduped: dict[K, S] = {}
    for showtime in showtimes:
        showtime_key = key(showtime)
        existing = deduped.get(showtime_key)
        deduped[showtime_key] = showtime if existing is None else _merge_showtime_info(existing, showtime)
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
    vote_count = _coalesce(left.get("vote_count"), right.get("vote_count"))
    if vote_count is not None:
        merged["vote_count"] = vote_count
    # Preserve enriched_at: without it the merged movie reads as never-enriched,
    # so the next refresh re-enriches it every cycle (post-enrichment reconcile
    # runs after enrich(), so both copies carry it).
    enriched_at = _coalesce(left.get("enriched_at"), right.get("enriched_at"))
    if enriched_at is not None:
        merged["enriched_at"] = enriched_at
    return merged
