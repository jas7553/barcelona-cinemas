"""Tests for validation.py normalization helpers and payload safety."""

import logging

import pytest

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


def _showtime_payload(**extra: object) -> dict[str, object]:
    return {
        "cinema": "Verdi",
        "neighborhood": "Gràcia",
        "address": "Carrer de Verdi, 32",
        "date": "2026-03-28",
        "time": "18:00",
        **extra,
    }


def test_normalize_movie_keeps_valid_subtitle_fields() -> None:
    movie = normalize_movie(
        {
            "title": "Anatomy of a Fall",
            "showtimes": [_showtime_payload(audio_lang="other", subtitle_lang="es")],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["showtimes"][0]["audio_lang"] == "other"
    assert movie["showtimes"][0]["subtitle_lang"] == "es"


def test_normalize_movie_discards_invalid_subtitle_fields() -> None:
    movie = normalize_movie(
        {
            "title": "Anatomy of a Fall",
            "showtimes": [_showtime_payload(audio_lang="klingon", subtitle_lang="fr")],
        },
        source="test movie",
    )

    assert movie is not None
    assert "audio_lang" not in movie["showtimes"][0]
    assert "subtitle_lang" not in movie["showtimes"][0]


def test_normalize_movie_keeps_valid_premium_format() -> None:
    movie = normalize_movie(
        {
            "title": "Odyssey",
            "showtimes": [_showtime_payload(premium_format="imax")],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["showtimes"][0]["premium_format"] == "imax"


def test_normalize_movie_discards_unknown_premium_format() -> None:
    movie = normalize_movie(
        {
            "title": "Odyssey",
            "showtimes": [_showtime_payload(premium_format="4dx")],
        },
        source="test movie",
    )

    assert movie is not None
    assert "premium_format" not in movie["showtimes"][0]


def test_normalize_movie_keeps_valid_booking_url() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "showtimes": [_showtime_payload(booking_url="https://tickets.example/?perfCode=1")],
        },
        source="test movie",
    )

    assert movie is not None
    assert movie["showtimes"][0]["booking_url"] == "https://tickets.example/?perfCode=1"


def test_normalize_movie_discards_non_http_booking_url() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "showtimes": [_showtime_payload(booking_url="javascript:alert(1)")],
        },
        source="test movie",
    )

    assert movie is not None
    assert "booking_url" not in movie["showtimes"][0]


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


def test_normalize_tmdb_payload_keeps_tagline() -> None:
    payload = normalize_tmdb_payload(
        {"id": 42, "tagline": "He who controls the spice controls the universe."},
        title="Dune: Part Two",
    )

    assert payload is not None
    assert payload["tagline"] == "He who controls the spice controls the universe."


def test_normalize_tmdb_payload_drops_empty_tagline() -> None:
    payload = normalize_tmdb_payload({"id": 42, "tagline": "   "}, title="Dune: Part Two")

    assert payload is not None
    assert "tagline" not in payload


def test_normalize_tmdb_payload_extracts_director_and_cast() -> None:
    credits = {
        "cast": [{"name": "A"}, {"name": "B"}, {"name": "C"}, {"name": "D"}, {"name": "E"}, {"name": "F"}],
        "crew": [{"name": "Dir One", "job": "Director"}, {"name": "Comp", "job": "Composer"}],
    }
    payload = normalize_tmdb_payload({"id": 42}, title="Film", credits=credits)

    assert payload is not None
    assert payload["director"] == "Dir One"
    # Capped at top 5 billing order.
    assert payload["cast"] == ["A", "B", "C", "D", "E"]


def test_normalize_tmdb_payload_joins_multiple_directors() -> None:
    credits = {
        "crew": [
            {"name": "Joel Coen", "job": "Director"},
            {"name": "Ethan Coen", "job": "Director"},
        ],
    }
    payload = normalize_tmdb_payload({"id": 42}, title="Film", credits=credits)

    assert payload is not None
    assert payload["director"] == "Joel Coen, Ethan Coen"


def test_normalize_tmdb_payload_omits_credits_when_absent() -> None:
    payload = normalize_tmdb_payload({"id": 42}, title="Film")

    assert payload is not None
    assert "director" not in payload
    assert "cast" not in payload


def test_normalize_tmdb_payload_extracts_original_language() -> None:
    payload = normalize_tmdb_payload({"id": 42, "original_language": "FR"}, title="Anatomy of a Fall")

    assert payload is not None
    assert payload["original_lang"] == "fr"  # lowercased


def test_normalize_tmdb_payload_discards_malformed_original_language() -> None:
    payload = normalize_tmdb_payload({"id": 42, "original_language": "français"}, title="Film")

    assert payload is not None
    assert "original_lang" not in payload


def test_normalize_movie_keeps_cached_original_lang() -> None:
    movie = normalize_movie(
        {"title": "Anatomy of a Fall", "original_lang": "fr", "showtimes": []},
        source="cache",
    )

    assert movie is not None
    assert movie["original_lang"] == "fr"


def test_normalize_tmdb_payload_extracts_english_title() -> None:
    payload = normalize_tmdb_payload(
        {"id": 42, "title": "Close Encounters of the Third Kind"},
        title="Encuentros en la tercera fase",
    )

    assert payload is not None
    assert payload["title"] == "Close Encounters of the Third Kind"


def test_normalize_tmdb_payload_omits_title_when_absent() -> None:
    payload = normalize_tmdb_payload({"id": 42}, title="Some Film")

    assert payload is not None
    assert "title" not in payload


def test_normalize_movie_round_trips_english_title() -> None:
    movie = normalize_movie(
        {
            "title": "Encuentros en la tercera fase",
            "english_title": "Close Encounters of the Third Kind",
            "showtimes": [],
        },
        source="cache",
    )

    assert movie is not None
    assert movie["title"] == "Encuentros en la tercera fase"
    assert movie.get("english_title") == "Close Encounters of the Third Kind"


def test_normalize_movie_english_title_absent_when_not_provided() -> None:
    movie = normalize_movie({"title": "Some Film", "showtimes": []}, source="cache")

    assert movie is not None
    assert "english_title" not in movie


def test_normalize_movie_keeps_cached_director_and_cast() -> None:
    movie = normalize_movie(
        {
            "title": "Dune: Part Two",
            "director": "Denis Villeneuve",
            "cast": ["Timothée Chalamet", "Zendaya"],
            "showtimes": [],
        },
        source="cache",
    )

    assert movie is not None
    assert movie["director"] == "Denis Villeneuve"
    assert movie["cast"] == ["Timothée Chalamet", "Zendaya"]


# ── TMDb "no votes yet" (vote_average / vote_count == 0) ──────────────────────


def test_normalize_tmdb_payload_keeps_zero_vote_average_without_warning(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    payload = normalize_tmdb_payload({"id": 42, "vote_average": 0.0}, title="Unreleased Film")

    assert payload is not None
    assert payload["vote_average"] == 0.0
    assert caplog.text == ""


def test_normalize_tmdb_payload_keeps_zero_vote_count_without_warning(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    payload = normalize_tmdb_payload({"id": 42, "vote_count": 0}, title="Unreleased Film")

    assert payload is not None
    assert payload["vote_count"] == 0
    assert caplog.text == ""


def test_normalize_tmdb_payload_discards_negative_vote_average(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    payload = normalize_tmdb_payload({"id": 42, "vote_average": -1.0}, title="Some Film")

    assert payload is not None
    assert "vote_average" not in payload
    assert "rating is out of range" in caplog.text


def test_normalize_tmdb_payload_discards_vote_average_above_ten(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    payload = normalize_tmdb_payload({"id": 42, "vote_average": 10.5}, title="Some Film")

    assert payload is not None
    assert "vote_average" not in payload
    assert "rating is out of range" in caplog.text


def test_normalize_tmdb_payload_discards_negative_vote_count(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    payload = normalize_tmdb_payload({"id": 42, "vote_count": -3}, title="Some Film")

    assert payload is not None
    assert "vote_count" not in payload
    assert "expected non-negative integer" in caplog.text


def test_normalize_movie_keeps_zero_vote_count_without_warning(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    movie = normalize_movie(
        {"title": "Unreleased Film", "vote_count": 0, "showtimes": []},
        source="cache",
    )

    assert movie is not None
    assert movie.get("vote_count") == 0
    assert caplog.text == ""
