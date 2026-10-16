"""
Cinema title suffixes: what a feed appends to a film's title, and what it means.

Feeds decorate titles with screening details — "Vengadores: Endgame
(Reestreno)", "La Odisea: The IMAX Experience", "Anora (VOSE)". Left on, the
decoration hides the film from TMDb (no match, so no poster or rating) and from
Reconciliation (no imdb_id, and a title that equals no other copy's), so the
same film is listed twice. `parse_title` strips the known suffixes and keeps
what they say: a re-release, an IMAX screening, or the year the cinema gives.

Only known suffixes are stripped. An unrecognised parenthetical is part of the
title ("Mission: Impossible (The Final Reckoning)" stays as it is).
"""

from __future__ import annotations

import re
import unicodedata
from typing import NamedTuple

from models import Movie

# Suffix kinds. A version tag ("VOSE", "3D") only carries screening details
# the Showtimes already state, so it is dropped without a trace.
_RERELEASE = "rerelease"
_IMAX = "imax"
_VERSION = "version"

# Keyed by the suffix casefolded, accents and every non-alphanumeric removed:
# "V.O.S.E." and "vose" are the same key.
_SUFFIXES = {
    "reestreno": _RERELEASE,
    "reestrena": _RERELEASE,
    "rerelease": _RERELEASE,
    "imax": _IMAX,
    "enimax": _IMAX,
    "imax3d": _IMAX,
    "imaxexperience": _IMAX,
    "theimaxexperience": _IMAX,
    "vo": _VERSION,
    "vos": _VERSION,
    "vose": _VERSION,
    "vosc": _VERSION,
    "vosi": _VERSION,
    "vocat": _VERSION,
    "versionoriginal": _VERSION,
    "versiooriginal": _VERSION,
    "versionoriginalsubtitulada": _VERSION,
    "versiooriginalsubtitulada": _VERSION,
    "3d": _VERSION,
    "4k": _VERSION,
}

# "Title (Reestreno)" / "Title [VOSE]": a trailing bracketed group.
_BRACKETED_RE = re.compile(r"\s*[(\[]([^()\[\]]+)[)\]]\s*$")
# "Title: The IMAX Experience" / "Title - VOSE": a trailing separated tag.
# The separator needs whitespace on its right so a hyphenated title word
# ("Spider-Man") is never split.
_SEPARATED_RE = re.compile(r"\s*(?::|\s[-–—])\s+([^:\-–—]+?)\s*$")
_YEAR_RE = re.compile(r"(19|20)\d\d")


class TitleParts(NamedTuple):
    title: str
    year: int | None = None
    rerelease: bool = False
    imax: bool = False


def _suffix_key(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in decomposed if ch.isalnum() and ch.isascii())


def parse_title(raw: str) -> TitleParts:
    """
    Split a feed title into the film's title and what its suffixes say.

    Strips repeatedly, so "Dune (Reestreno) (VOSE)" loses both. A bracketed
    four-digit year is the cinema's year for the film. Never strips the whole
    title: "IMAX" alone stays "IMAX".
    """
    title = raw.strip()
    year: int | None = None
    rerelease = False
    imax = False
    while True:
        match = _BRACKETED_RE.search(title) or _SEPARATED_RE.search(title)
        if match is None or match.start() == 0:
            break
        inner = match.group(1).strip()
        kind = _SUFFIXES.get(_suffix_key(inner))
        if kind is None and match.re is _BRACKETED_RE and _YEAR_RE.fullmatch(inner) and year is None:
            year = int(inner)
        elif kind == _RERELEASE:
            rerelease = True
        elif kind == _IMAX:
            imax = True
        elif kind is None:
            break
        title = title[: match.start()].rstrip()
    return TitleParts(title=title, year=year, rerelease=rerelease, imax=imax)


def clean_movie(movie: Movie) -> Movie:
    """
    `movie` with its title's known suffixes stripped and their meaning kept:
    a cinema year fills `year`, a re-release sets `rerelease`, and an IMAX
    suffix tags every Showtime that does not already name a premium format.
    Returns `movie` itself when the title has nothing to strip.
    """
    parts = parse_title(movie["title"])
    if parts.title == movie["title"]:
        return movie
    cleaned: Movie = {**movie, "title": parts.title}
    if parts.year is not None and cleaned.get("year") is None:
        cleaned["year"] = parts.year
    if parts.rerelease:
        cleaned["rerelease"] = True
    if parts.imax:
        cleaned["showtimes"] = [
            showtime if showtime.get("premium_format") else {**showtime, "premium_format": "imax"}
            for showtime in movie["showtimes"]
        ]
    return cleaned
