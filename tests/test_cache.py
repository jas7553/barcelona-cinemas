"""Tests for cache.py — read/write round-trip."""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import pytest

import cache
from models import Listings


@pytest.fixture()
def tmp_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect cache module to use a temporary directory."""
    cache_file = tmp_path / "listings.json"
    monkeypatch.setattr(cache, "_backend", cache._FileBackend(tmp_path, cache_file))
    return cache_file


def _make_listings() -> Listings:
    return Listings(
        fetched_at=datetime.now(UTC).isoformat(),
        stale=False,
        movies=[],
    )


def test_read_returns_none_when_no_file(tmp_cache: Path) -> None:
    assert cache.read() is None


def test_read_logs_invalid_cache_payload(tmp_cache: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    tmp_cache.write_text(json.dumps({"fetched_at": "not-a-date", "stale": False, "movies": "bad-shape"}))

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
    monkeypatch.setattr(cache, "_backend", cache._FileBackend(nested, nested / "listings.json"))
    cache.write(_make_listings())
    assert (nested / "listings.json").exists()


def test_read_returns_none_for_invalid_cache_payload(tmp_cache: Path) -> None:
    tmp_cache.write_text(json.dumps({"fetched_at": "not-a-date", "stale": False, "movies": "bad-shape"}))

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
                        "poster_url": "https://image.tmdb.org/t/p/w342/valid-film.jpg",
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
            "poster_url": "https://image.tmdb.org/t/p/w342/valid-film.jpg",
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


def test_read_keeps_older_showtimes_without_language_field(tmp_cache: Path) -> None:
    tmp_cache.write_text(
        json.dumps(
            {
                "fetched_at": "2026-03-28T12:00:00+00:00",
                "stale": False,
                "movies": [
                    {
                        "title": "Valid Film",
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
                ],
            }
        )
    )

    result = cache.read()

    assert result is not None
    assert result["movies"][0]["showtimes"] == [
        {
            "cinema": "Verdi",
            "neighborhood": "Gracia",
            "address": "Carrer de Verdi, 32",
            "date": "2026-03-28",
            "time": "18:00",
        }
    ]


def _ended_payload(**overrides: object) -> dict[str, object]:
    return {
        "title": "Aftersun",
        "tmdb_id": 965150,
        "imdb_id": None,
        "year": 2022,
        "poster_url": None,
        "synopsis": None,
        "rating": None,
        "runtime_mins": 102,
        "genres": ["Drama"],
        "showtimes": [],
        "last_showing": "2026-03-20",
        **overrides,
    }


def test_read_round_trips_ended_films(tmp_cache: Path) -> None:
    listings = _make_listings()
    tmp_cache.write_text(json.dumps({**listings, "ended": [_ended_payload()]}))

    result = cache.read()

    assert result is not None
    assert [(m["title"], m["last_showing"]) for m in result.get("ended", [])] == [("Aftersun", "2026-03-20")]


def test_read_drops_ended_films_without_a_valid_last_showing(tmp_cache: Path) -> None:
    listings = _make_listings()
    ended = [_ended_payload(last_showing="soon"), _ended_payload(title="Kept"), {"last_showing": "2026-03-20"}]
    tmp_cache.write_text(json.dumps({**listings, "ended": ended}))

    result = cache.read()

    assert result is not None
    assert [m["title"] for m in result.get("ended", [])] == ["Kept"]


def test_read_accepts_a_cache_predating_ended_films(tmp_cache: Path) -> None:
    tmp_cache.write_text(json.dumps(_make_listings()))

    result = cache.read()

    assert result is not None
    assert "ended" not in result
