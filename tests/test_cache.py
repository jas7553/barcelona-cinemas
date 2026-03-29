"""Tests for cache.py — read/write round-trip and age_hours()."""

import json
import logging
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import cache
from models import Listings


@pytest.fixture()
def tmp_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect cache module to use a temporary directory."""
    cache_file = tmp_path / "listings.json"
    monkeypatch.setattr(cache, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache, "_CACHE_FILE", cache_file)
    return cache_file


def _make_listings(hours_ago: float = 0) -> Listings:
    fetched_at = datetime.now(UTC) - timedelta(hours=hours_ago)
    return Listings(
        fetched_at=fetched_at.isoformat(),
        stale=False,
        movies=[],
    )


def test_read_returns_none_when_no_file(tmp_cache: Path) -> None:
    assert cache.read() is None


def test_read_logs_invalid_cache_payload(tmp_cache: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    tmp_cache.write_text(
        json.dumps({"fetched_at": "not-a-date", "stale": False, "movies": "bad-shape"})
    )

    assert cache.read() is None
    assert '"event": "cache_invalid"' in caplog.text


def test_write_then_read_round_trips(tmp_cache: Path) -> None:
    listings = _make_listings()
    cache.write(listings)
    result = cache.read()
    assert result is not None
    assert result["fetched_at"] == listings["fetched_at"]
    assert result["movies"] == []


def test_write_creates_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    nested = tmp_path / "a" / "b"
    monkeypatch.setattr(cache, "_CACHE_DIR", nested)
    monkeypatch.setattr(cache, "_CACHE_FILE", nested / "listings.json")
    cache.write(_make_listings())
    assert (nested / "listings.json").exists()


def test_age_hours_returns_inf_when_no_file(tmp_cache: Path) -> None:
    assert cache.age_hours() == math.inf


def test_age_hours_returns_correct_value(tmp_cache: Path) -> None:
    cache.write(_make_listings(hours_ago=3))
    age = cache.age_hours()
    assert 2.9 < age < 3.1


def test_age_hours_returns_inf_for_missing_fetched_at(tmp_cache: Path) -> None:
    tmp_cache.write_text(json.dumps({"stale": False, "movies": []}))
    assert cache.age_hours() == math.inf


def test_read_returns_none_for_invalid_cache_payload(tmp_cache: Path) -> None:
    tmp_cache.write_text(
        json.dumps({"fetched_at": "not-a-date", "stale": False, "movies": "bad-shape"})
    )

    assert cache.read() is None


def test_read_normalizes_cache_by_dropping_invalid_movies_and_showtimes(tmp_cache: Path) -> None:
    tmp_cache.write_text(
        json.dumps(
            {
                "fetched_at": "2026-03-28T12:00:00+00:00",
                "stale": False,
                "movies": [
                    {
                        "title": "Valid Film",
                        "tmdb_id": 42,
                        "synopsis": "A synopsis",
                        "rating": 8.1,
                        "runtime_mins": 120,
                        "genres": ["Drama"],
                        "showtimes": [
                            {
                                "cinema": "Verdi",
                                "neighborhood": "Gracia",
                                "address": "Carrer de Verdi, 32",
                                "date": "2026-03-28",
                                "time": "18:00",
                            },
                            {
                                "cinema": "Verdi",
                                "neighborhood": "Gracia",
                                "address": "Carrer de Verdi, 32",
                                "date": "bad-date",
                                "time": "18:00",
                            },
                        ],
                    },
                    {
                        "title": "",
                        "showtimes": [],
                    },
                ],
            }
        )
    )

    result = cache.read()

    assert result is not None
    assert result["movies"] == [
        {
            "title": "Valid Film",
            "tmdb_id": 42,
            "imdb_id": None,
            "year": None,
            "synopsis": "A synopsis",
            "rating": 8.1,
            "runtime_mins": 120,
            "genres": ["Drama"],
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gracia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-28",
                    "time": "18:00",
                }
            ],
        }
    ]
