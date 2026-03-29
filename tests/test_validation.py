"""Tests for validation.py normalization helpers and payload safety."""

from validation import normalize_movie, normalize_tmdb_payload


def test_normalize_movie_keeps_valid_imdb_id() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "imdb_id": "  tt15239678  ",
            "showtimes": [],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["imdb_id"] == "tt15239678"


def test_normalize_movie_keeps_poster_url() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "poster_url": "https://image.tmdb.org/t/p/w342/dune.jpg",
            "showtimes": [],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["poster_url"] == "https://image.tmdb.org/t/p/w342/dune.jpg"


def test_normalize_movie_discards_malformed_imdb_id() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "imdb_id": "imdb-15239678",
            "showtimes": [],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["imdb_id"] is None


def test_normalize_movie_discards_non_string_imdb_id() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "imdb_id": 15239678,
            "showtimes": [],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["imdb_id"] is None


def test_normalize_movie_keeps_valid_showtime_language() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "showtimes": [
                {
                    "cinema": "Verdi",
                    "neighborhood": "Gràcia",
                    "address": "Carrer de Verdi, 32",
                    "date": "2026-03-28",
                    "time": "18:00",
                    "language": "vo",
                }
            ],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["showtimes"][0]["language"] == "vo"


def test_normalize_tmdb_payload_keeps_valid_imdb_id() -> None:
    payload = normalize_tmdb_payload(
        {
            "id": 42,
            "imdb_id": "tt15239678",
            "poster_path": "/dune.jpg",
        },
        title="Dune: Part Two",
    )

    assert payload is not None
    assert payload["imdb_id"] == "tt15239678"
    assert payload["poster_url"] == "https://image.tmdb.org/t/p/w342/dune.jpg"


def test_normalize_tmdb_payload_discards_malformed_imdb_id() -> None:
    payload = normalize_tmdb_payload(
        {
            "id": 42,
            "imdb_id": "bad-id",
            "poster_path": "bad-path",
        },
        title="Dune: Part Two",
    )

    assert payload is not None
    assert "imdb_id" not in payload
    assert "poster_url" not in payload
