from unittest.mock import MagicMock, patch

import pytest

from models import CinemaInfo, CinemaRegistry
from providers.secondary_provider import (
    SecondaryProvider,
    _extract_shops_payload,
)

CINEMAS: CinemaRegistry = {
    "Aribau": CinemaInfo(
        id="aribau",
        name="Cinemes Aribau",
        address="Carrer d'Aribau, 8-10",
        neighborhood="Eixample",
        website_url="https://example.com/aribau",
        maps_url="https://maps.google.com/?q=Aribau",
        aliases={"secondary": ["ARIBAU", "/aribau", "BAL-ARIBAU"]},
    ),
    "Bosque": CinemaInfo(
        id="bosque",
        name="Mooby Bosque",
        address="Rambla del Prat, 16",
        neighborhood="Gràcia",
        website_url="https://example.com/bosque",
        maps_url="https://maps.google.com/?q=Bosque",
        aliases={"secondary": ["BOSQUE", "/bosque", "BAL-BOSQUE"]},
    ),
}

SECONDARY_PROVIDER_HTML = """
<html><head><script>
window.shops = {
  "25": {
    "label": "ARIBAU",
    "name": "Aribau",
    "slug": "/aribau",
    "code": "BAL-ARIBAU",
    "events": [
      {
        "name": "Project Hail Mary",
        "imdbid": "tt12042730",
        "language": "Anglès",
        "subtitles_lang": "Español",
        "performances": [
          {"schedule_date": "20260329", "time": "20260329183000"}
        ]
      },
      {
        "name": "Other Language Film",
        "imdbid": "tt7654321",
        "language": "Japonès",
        "subtitles_lang": "English",
        "performances": [
          {"schedule_date": "20260330", "time": "20260330210000"}
        ]
      },
      {
        "name": "Dubbed Film",
        "imdbid": "tt9999999",
        "language": "Español",
        "subtitles_lang": "",
        "performances": [
          {"schedule_date": "20260329", "time": "20260329160000"}
        ]
      }
    ]
  },
  "26": {
    "label": "BOSQUE",
    "name": "Bosque",
    "slug": "/bosque",
    "code": "BAL-BOSQUE",
    "events": [
      {
        "name": "Project Hail Mary",
        "imdbid": "tt12042730",
        "language": "Anglès",
        "subtitles_lang": "Español",
        "performances": [
          {"schedule_date": "20260330", "time": "20260330200000"}
        ]
      }
    ]
  }
};
</script></head></html>
"""


def _mock_response(text: str) -> MagicMock:
    response = MagicMock()
    response.text = text
    response.raise_for_status = MagicMock()
    return response


def test_extract_shops_payload_raises_for_missing_blob() -> None:
    with pytest.raises(RuntimeError, match="window.shops"):
        _extract_shops_payload("<html></html>")


def test_fetch_parses_english_audio_and_english_subtitles() -> None:
    with patch("providers.secondary_provider.requests.get", return_value=_mock_response(SECONDARY_PROVIDER_HTML)):
        movies = SecondaryProvider().fetch(CINEMAS)

    assert len(movies) == 2
    hail_mary = next(movie for movie in movies if movie["title"] == "Project Hail Mary")
    assert hail_mary["imdb_id"] == "tt12042730"
    assert len(hail_mary["showtimes"]) == 2
    assert hail_mary["showtimes"][0]["language"] == "vo"

    subtitled = next(movie for movie in movies if movie["title"] == "Other Language Film")
    assert subtitled["showtimes"][0]["date"] == "2026-03-30"
    assert subtitled["showtimes"][0]["time"] == "21:00"


def test_fetch_skips_non_english_entries() -> None:
    with patch("providers.secondary_provider.requests.get", return_value=_mock_response(SECONDARY_PROVIDER_HTML)):
        movies = SecondaryProvider().fetch(CINEMAS)

    titles = {movie["title"] for movie in movies}
    assert "Dubbed Film" not in titles


def test_fetch_maps_slug_and_code_aliases_without_branded_names() -> None:
    html = """
    <html><head><script>
    window.shops = {
      "25": {
        "label": "",
        "name": "",
        "slug": "/aribau",
        "code": "BAL-ARIBAU",
        "events": [
          {
            "name": "Project Hail Mary",
            "imdbid": "tt12042730",
            "language": "Anglès",
            "subtitles_lang": "",
            "performances": [
              {"schedule_date": "20260329", "time": "20260329183000"}
            ]
          }
        ]
      }
    };
    </script></head></html>
    """

    with patch("providers.secondary_provider.requests.get", return_value=_mock_response(html)):
        movies = SecondaryProvider().fetch(CINEMAS)

    assert len(movies) == 1
    assert movies[0]["showtimes"][0]["cinema"] == "Aribau"
