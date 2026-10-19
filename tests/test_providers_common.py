"""Tests for the shared provider language normalizers."""

from datetime import UTC, date, datetime

import pytest

from models import Showtime
from providers.common import (
    base_movie,
    clean_title,
    madrid_today,
    normalize_audio_lang,
    normalize_premium_format,
    normalize_subtitle_lang,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("English", "en"),
        ("Anglès", "en"),
        ("Inglés", "en"),
        ("Japonès", "other"),
        ("Español", "other"),
        ("", None),
        ("   ", None),
    ],
)
def test_normalize_audio_lang(raw: str, expected: str | None) -> None:
    assert normalize_audio_lang(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("English", "en"),
        ("Anglès", "en"),
        ("Español", "es"),
        ("Castellano", "es"),
        ("Espanyol", "es"),
        ("Català", "ca"),
        ("Catalan", "ca"),
        ("Francès", None),  # recognized-but-other subtitle → unknown
        ("", None),
    ],
)
def test_normalize_subtitle_lang(raw: str, expected: str | None) -> None:
    assert normalize_subtitle_lang(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Imax", "imax"),
        ("IMAX", "imax"),
        ("IMAX 3D", "imax"),
        ("Sala IMAX", "imax"),
        ("The IMAX Experience", "imax"),
        ("Digital", None),
        ("DIGITAL", None),
        ("ScreenX", None),  # unmapped premium format → unknown, never raises
        ("", None),
    ],
)
def test_normalize_premium_format(raw: str, expected: str | None) -> None:
    assert normalize_premium_format(raw) == expected


# ── madrid_today ─────────────────────────────────────────────────────────────


def test_madrid_today_rolls_over_before_utc_midnight_in_summer() -> None:
    """22:30 UTC on a CEST evening is already past midnight in Madrid (UTC+2)."""
    now = datetime(2026, 7, 14, 22, 30, tzinfo=UTC)
    assert madrid_today(now) == date(2026, 7, 15)


def test_madrid_today_matches_utc_day_when_not_near_midnight() -> None:
    now = datetime(2026, 7, 14, 8, 0, tzinfo=UTC)
    assert madrid_today(now) == date(2026, 7, 14)


def test_madrid_today_treats_naive_datetime_as_utc() -> None:
    now = datetime(2026, 7, 14, 22, 30)
    assert madrid_today(now) == date(2026, 7, 15)


def test_madrid_today_winter_offset_is_one_hour() -> None:
    """In CET (UTC+1) the rollover happens at 23:00 UTC, not 22:00 as in summer."""
    assert madrid_today(datetime(2026, 1, 14, 22, 30, tzinfo=UTC)) == date(2026, 1, 14)
    assert madrid_today(datetime(2026, 1, 14, 23, 30, tzinfo=UTC)) == date(2026, 1, 15)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Vengadores: Endgame (Reestreno)", ("Vengadores: Endgame", True, None)),
        ("La Odisea: The IMAX Experience", ("La Odisea", False, "imax")),
        ("Rocky - The IMAX Experience", ("Rocky", False, "imax")),
        ("Dune (IMAX)", ("Dune", False, "imax")),
        ("Dune (VOSE)", ("Dune", False, None)),
        ("Dune (V.O.S.E.)", ("Dune", False, None)),
        ("Dune (VO)", ("Dune", False, None)),
        ("Dune (3D)", ("Dune", False, None)),
        # Suffixes stack.
        ("La Odisea: The IMAX Experience (VOSE)", ("La Odisea", False, "imax")),
        ("Alien (Reestreno) (VOSE)", ("Alien", True, None)),
        # A title that is only a suffix, or merely contains one, stays as it is.
        ("(VOSE)", ("(VOSE)", False, None)),
        ("Festive Fun with Peppa Cinema Experience", ("Festive Fun with Peppa Cinema Experience", False, None)),
        ("Vosotros", ("Vosotros", False, None)),
    ],
)
def test_clean_title(raw: str, expected: tuple[str, bool, str | None]) -> None:
    assert tuple(clean_title(raw)) == expected


def _showtime(**fields: object) -> Showtime:
    showtime = Showtime(cinema="CinDigMar", neighborhood="N", address="A", date="2026-10-14", time="21:50")
    showtime.update(fields)  # type: ignore[typeddict-item]
    return showtime


def test_base_movie_marks_imax_suffix_showtimes_and_keeps_their_own_format() -> None:
    movie = base_movie(
        "La Odisea: The IMAX Experience",
        None,
        [_showtime(), _showtime(time="18:00", premium_format="imax")],
    )
    assert movie["title"] == "La Odisea"
    assert [st.get("premium_format") for st in movie["showtimes"]] == ["imax", "imax"]
    assert "rerelease" not in movie


def test_base_movie_records_source_hints() -> None:
    movie = base_movie(
        "Vengadores: Endgame (Reestreno)",
        None,
        [_showtime()],
        original_title="Avengers: Endgame",
        source_year=2019,
        source_runtime_mins=181,
    )
    assert movie["rerelease"] is True
    assert movie["original_title"] == "Avengers: Endgame"
    assert movie["source_year"] == 2019
    assert movie["source_runtime_mins"] == 181


def test_base_movie_omits_original_title_equal_to_title() -> None:
    assert "original_title" not in base_movie("Street Fighter", None, [_showtime()], original_title="Street Fighter")
