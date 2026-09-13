"""Tests for the shared provider language normalizers."""

from datetime import UTC, date, datetime

import pytest

from providers.common import madrid_today, normalize_audio_lang, normalize_premium_format, normalize_subtitle_lang


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
