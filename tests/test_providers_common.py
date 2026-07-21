"""Tests for the shared provider language normalizers."""

import pytest

from providers.common import normalize_audio_lang, normalize_premium_format, normalize_subtitle_lang


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
