"""Tests for titles.py — stripping cinema title suffixes and keeping their meaning."""

import pytest

from models import Movie, Showtime
from titles import TitleParts, clean_movie, parse_title


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Vengadores: Endgame (Reestreno)", TitleParts("Vengadores: Endgame", rerelease=True)),
        ("Dune (Reestrena)", TitleParts("Dune", rerelease=True)),
        ("Alien (Re-release)", TitleParts("Alien", rerelease=True)),
        ("La Odisea: The IMAX Experience", TitleParts("La Odisea", imax=True)),
        ("Oppenheimer - The IMAX Experience", TitleParts("Oppenheimer", imax=True)),
        ("Interstellar (IMAX)", TitleParts("Interstellar", imax=True)),
        ("Anora (VOSE)", TitleParts("Anora")),
        ("Anora (V.O.S.E.)", TitleParts("Anora")),
        ("Anora (VOSC)", TitleParts("Anora")),
        ("Avatar (3D)", TitleParts("Avatar")),
        ("Dune (Reestreno) (VOSE)", TitleParts("Dune", rerelease=True)),
        ("Tenet: The IMAX Experience (Reestreno)", TitleParts("Tenet", rerelease=True, imax=True)),
    ],
)
def test_strips_known_suffixes_and_keeps_their_meaning(raw: str, expected: TitleParts) -> None:
    assert parse_title(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "Mission: Impossible",
        "Spider-Man: Across the Spider-Verse",
        "Mission: Impossible (The Final Reckoning)",
        "(500) Days of Summer",
        "Avengers: Endgame",
        "IMAX",
        "(Reestreno)",
        "Blade Runner 2049",
    ],
)
def test_leaves_real_titles_alone(raw: str) -> None:
    assert parse_title(raw) == TitleParts(raw)


def test_a_suffix_before_an_unknown_parenthetical_is_kept() -> None:
    """Stripping stops at the first suffix it does not know."""
    assert parse_title("Dune (Reestreno) (Part Two)").title == "Dune (Reestreno) (Part Two)"


def _showtime() -> Showtime:
    return Showtime(cinema="CinDigMar", neighborhood="", address="", date="2026-10-15", time="20:00")


def _movie(title: str, showtimes: list[Showtime]) -> Movie:
    return Movie(
        title=title,
        tmdb_id=None,
        imdb_id=None,
        year=None,
        poster_url=None,
        synopsis=None,
        rating=None,
        runtime_mins=None,
        genres=None,
        showtimes=showtimes,
    )


def test_clean_movie_tags_imax_showtimes() -> None:
    cleaned = clean_movie(_movie("La Odisea: The IMAX Experience", [_showtime()]))
    assert cleaned["title"] == "La Odisea"
    assert cleaned["showtimes"][0]["premium_format"] == "imax"
    assert "rerelease" not in cleaned


def test_clean_movie_flags_a_rerelease() -> None:
    rerelease = clean_movie(_movie("Vengadores: Endgame (Reestreno)", [_showtime()]))
    assert rerelease["rerelease"] is True
    assert "premium_format" not in rerelease["showtimes"][0]


def test_clean_movie_returns_an_unsuffixed_movie_unchanged() -> None:
    movie = _movie("The Odyssey", [_showtime()])
    assert clean_movie(movie) is movie
