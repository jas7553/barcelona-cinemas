from collections.abc import Mapping
from unittest.mock import MagicMock, patch

from models import CinemaInfo, CinemaRegistry
from providers.sensacine_provider import (
    SensacineProvider,
    _booking_url,
    _subtitle_lang,
)

CINEMAS: CinemaRegistry = {
    "CinDiag": CinemaInfo(
        id="diagonal",
        name="Cinesa Diagonal",
        address="Carrer de Santa Fe de Nou Mèxic, s/n",
        neighborhood="Les Corts",
        website_url="https://www.cinesa.es/cines/diagonal/",
        maps_url="https://maps.google.com/?q=Cinesa+Diagonal",
    ),
    "Malda": CinemaInfo(
        id="malda",
        name="Cinema Maldà",
        address="Carrer del Pi, 5",
        neighborhood="Gothic Quarter",
        website_url="https://www.cinemamalda.com",
        maps_url="https://maps.google.com/?q=Cinema+Maldà",
    ),
}

_SUPERGIRL_ENGLISH = {
    "movie": {
        "title": "Supergirl",
        "internalId": 266720,
        "languages": ["ENGLISH"],
        "poster": None,
    },
    "showtimes": {
        "dubbed": [],
        "original": [
            {
                "startsAt": "2026-06-29T16:00:00",
                "tags": [
                    "Localization.Version.Original",
                    "Localization.Subtitle.Spanish",
                    "Format.Projection.Digital",
                ],
                "data": {
                    "ticketing": [
                        {
                            "provider": "relay",
                            "urls": ["https://relay.mvtx.us/ticketing/dbz?code=Vose"],
                        },
                        {
                            "provider": "default",
                            "urls": ["https://www.cinesa.es/compra/butacas/?showtimeId=012-51716"],
                        },
                    ]
                },
            },
            {
                "startsAt": "2026-06-29T21:10:00",
                "tags": [
                    "Localization.Version.Original",
                    "Localization.Subtitle.Spanish",
                    "Format.Projection.Digital",
                ],
                "data": {
                    "ticketing": [
                        {
                            "provider": "default",
                            "urls": ["https://www.cinesa.es/compra/butacas/?showtimeId=012-51718"],
                        },
                    ]
                },
            },
        ],
        "local": [],
    },
}

_SPANISH_FILM = {
    "movie": {
        "title": "Película en Español",
        "internalId": 999,
        "languages": ["SPANISH"],
        "poster": None,
    },
    "showtimes": {
        "dubbed": [],
        "original": [
            {
                "startsAt": "2026-06-29T19:00:00",
                "tags": ["Localization.Version.Original", "Localization.Subtitle.Spanish"],
                "data": {"ticketing": []},
            }
        ],
        "local": [],
    },
}

_UNKNOWN_LANG_FILM = {
    "movie": {
        "title": "Mystery Film",
        "internalId": 777,
        "languages": [],
        "poster": None,
    },
    "showtimes": {
        "dubbed": [],
        "original": [
            {
                "startsAt": "2026-06-29T20:00:00",
                "tags": ["Localization.Version.Original", "Localization.Subtitle.Catalan"],
                "data": {"ticketing": [{"provider": "relay", "urls": ["https://relay.mvtx.us/ticketing/xyz"]}]},
            }
        ],
        "local": [],
    },
}

_API_RESPONSE = {
    "error": False,
    "results": [_SUPERGIRL_ENGLISH, _SPANISH_FILM, _UNKNOWN_LANG_FILM],
    "nextDate": None,
}


def _mock_response(data: object) -> MagicMock:
    mock = MagicMock()
    mock.raise_for_status = MagicMock()
    mock.json.return_value = data
    return mock


class TestHelpers:
    def test_subtitle_lang_spanish(self) -> None:
        assert _subtitle_lang(["Localization.Subtitle.Spanish"]) == "es"

    def test_subtitle_lang_catalan(self) -> None:
        assert _subtitle_lang(["Localization.Subtitle.Catalan"]) == "ca"

    def test_subtitle_lang_english(self) -> None:
        assert _subtitle_lang(["Localization.Subtitle.English"]) == "en"

    def test_subtitle_lang_absent(self) -> None:
        assert _subtitle_lang(["Format.Projection.Digital"]) is None

    def test_booking_url_prefers_default_provider(self) -> None:
        ticketing: list[Mapping[str, object]] = [
            {"provider": "relay", "urls": ["https://relay.example.com/x"]},
            {"provider": "default", "urls": ["https://direct.example.com/y"]},
        ]
        assert _booking_url(ticketing) == "https://direct.example.com/y"

    def test_booking_url_falls_back_to_relay(self) -> None:
        ticketing: list[Mapping[str, object]] = [
            {"provider": "relay", "urls": ["https://relay.example.com/x"]},
        ]
        assert _booking_url(ticketing) == "https://relay.example.com/x"

    def test_booking_url_empty(self) -> None:
        assert _booking_url([]) is None


class TestSensacineProvider:
    def test_fetch_returns_english_films_only(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        titles = {m["title"] for m in movies}
        assert "Supergirl" in titles
        assert "Mystery Film" in titles  # unknown lang: included
        assert "Película en Español" not in titles

    def test_fetch_sets_booking_url_from_default_provider(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        supergirl = next(m for m in movies if m["title"] == "Supergirl")
        st_16 = next(s for s in supergirl["showtimes"] if s["time"] == "16:00")
        assert st_16["booking_url"] == "https://www.cinesa.es/compra/butacas/?showtimeId=012-51716"

    def test_fetch_sets_subtitle_lang_from_tags(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        supergirl = next(m for m in movies if m["title"] == "Supergirl")
        assert all(s.get("subtitle_lang") == "es" for s in supergirl["showtimes"])

    def test_fetch_sets_audio_lang_english_for_english_film(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        supergirl = next(m for m in movies if m["title"] == "Supergirl")
        assert all(s.get("audio_lang") == "en" for s in supergirl["showtimes"])

    def test_fetch_sets_language_vo(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        supergirl = next(m for m in movies if m["title"] == "Supergirl")
        assert all(s["language"] == "vo" for s in supergirl["showtimes"])

    def test_fetch_uses_relay_url_when_no_default(self) -> None:
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(CINEMAS)

        mystery = next(m for m in movies if m["title"] == "Mystery Film")
        st = mystery["showtimes"][0]
        assert st.get("booking_url") == "https://relay.mvtx.us/ticketing/xyz"

    def test_fetch_degrades_gracefully_on_http_error(self) -> None:
        def raise_error(*args: object, **kwargs: object) -> None:
            raise RuntimeError("connection refused")

        with patch("providers.sensacine_provider.requests.get", side_effect=raise_error):
            movies = SensacineProvider().fetch(CINEMAS)

        assert movies == []

    def test_fetch_skips_missing_cinema_keys(self) -> None:
        # Only CinDiag is in cinemas, Malda is absent
        cinemas_partial: CinemaRegistry = {
            "CinDiag": CINEMAS["CinDiag"],
        }
        with patch(
            "providers.sensacine_provider.requests.get",
            return_value=_mock_response(_API_RESPONSE),
        ):
            movies = SensacineProvider().fetch(cinemas_partial)

        # Should still return movies for the cinemas that exist (CinDiag)
        cinema_keys = {s["cinema"] for m in movies for s in m["showtimes"]}
        assert "Malda" not in cinema_keys

    def test_fetch_dedupes_same_movie_across_dates(self) -> None:
        # Two calls to the same movie (different dates, same cinema) should be merged
        call_count = 0

        def multi_date_response(*args: object, **kwargs: object) -> MagicMock:
            nonlocal call_count
            call_count += 1
            return _mock_response(_API_RESPONSE)

        with patch("providers.sensacine_provider.requests.get", side_effect=multi_date_response):
            movies = SensacineProvider().fetch(CINEMAS)

        # Supergirl should appear once even across multiple date fetches
        supergirl_entries = [m for m in movies if m["title"] == "Supergirl"]
        assert len(supergirl_entries) == 1
