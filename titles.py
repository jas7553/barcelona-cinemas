"""
Cinema title suffixes: what a feed appends to a film's title, and what it means.

Feeds decorate titles with screening details — "Vengadores: Endgame
(Reestreno)", "La Odisea: The IMAX Experience", "Anora (VOSE)". Left on, the
decoration hides the film from TMDb and from Reconciliation, so the same film
is listed twice. Only known suffixes are stripped; an unrecognised
parenthetical is part of the title.
"""

from __future__ import annotations

import re
from typing import NamedTuple

from models import Movie

_RERELEASE_RE = re.compile(r"\s*\((?:re-?estren[oa]|re-?release)\)$", re.IGNORECASE)
_IMAX_RE = re.compile(r"\s*(?:\(imax\)|[:-]\s*the imax experience)$", re.IGNORECASE)
_VERSION_RE = re.compile(r"\s*\((?:v\.?o\.?(?:s\.?[eci]?\.?)?|3d|4k)\)$", re.IGNORECASE)


class TitleParts(NamedTuple):
    title: str
    rerelease: bool = False
    imax: bool = False


def parse_title(raw: str) -> TitleParts:
    """Strip known suffixes, in any order and number; never the whole title."""
    title, rerelease, imax = raw.strip(), False, False
    while True:
        for pattern in (_RERELEASE_RE, _IMAX_RE, _VERSION_RE):
            match = pattern.search(title)
            if match and match.start() > 0:
                title = title[: match.start()]
                rerelease |= pattern is _RERELEASE_RE
                imax |= pattern is _IMAX_RE
                break
        else:
            return TitleParts(title, rerelease, imax)


def clean_movie(movie: Movie) -> Movie:
    """
    `movie` with its title's suffixes stripped and their meaning kept: a
    re-release sets `rerelease`, an IMAX suffix tags every Showtime.
    """
    parts = parse_title(movie["title"])
    if parts.title == movie["title"]:
        return movie
    cleaned: Movie = {**movie, "title": parts.title}
    if parts.rerelease:
        cleaned["rerelease"] = True
    if parts.imax:
        cleaned["showtimes"] = [{**showtime, "premium_format": "imax"} for showtime in movie["showtimes"]]
    return cleaned
