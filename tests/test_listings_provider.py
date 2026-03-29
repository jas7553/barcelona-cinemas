"""Tests for providers/listings_provider.py — HTML parsing logic."""

from datetime import date
from unittest.mock import MagicMock, patch

from bs4 import Tag

from models import CinemaInfo, CinemaRegistry
from providers.listings_provider import (
    ListingsProvider,
    _extract_cinema_name,
    _parse_date,
)

# ── _parse_date ───────────────────────────────────────────────────────────────

def test_parse_date_standard():
    today = date.today()
    # Use today's month/day to get a stable year result
    header = today.strftime("Mon, %d %b")
    result = _parse_date(header)
    assert result == today.isoformat()


def test_parse_date_next_year_rollover():
    """A Jan listing date seen in December should resolve to next year's January."""
    with patch("providers.listings_provider.date") as mock_date:
        mock_date.today.return_value = date(2026, 12, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        result = _parse_date("Mon, 05 Jan")
    # Jan 5 relative to Dec 28: candidate(2026-01-05) is ~357 days in the past → bump to 2027
    assert result == "2027-01-05"


def test_parse_date_invalid_returns_empty():
    assert _parse_date("Movie/Date") == ""
    assert _parse_date("") == ""


# ── _extract_cinema_name ──────────────────────────────────────────────────────

def test_extract_cinema_name_plain():
    from bs4 import BeautifulSoup
    html = '<a><strong>18:00</strong> Verdi</a>'
    badge = BeautifulSoup(html, "html.parser").find("a")
    assert isinstance(badge, Tag)
    assert _extract_cinema_name(badge) == "Verdi"


def test_extract_cinema_name_strips_imax_span():
    from bs4 import BeautifulSoup
    html = '<a><strong>18:00</strong> Glòries<span class="badge">IMAX</span></a>'
    badge = BeautifulSoup(html, "html.parser").find("a")
    assert isinstance(badge, Tag)
    assert _extract_cinema_name(badge) == "Glòries"


# ── ListingsProvider.fetch ────────────────────────────────────────────────────

CINEMAS: CinemaRegistry = {
    "Verdi": CinemaInfo(
        id="verdi",
        name="Cinemes Verdi",
        address="Carrer de Verdi, 32",
        neighborhood="Gràcia",
        website_url="https://www.cines-verdi.com/barcelona/",
        maps_url="https://maps.google.com/?q=Cinemes+Verdi+Barcelona",
        aliases={"english_cinema_bcn": ["Verdi"]},
    ),
    "Glòries": CinemaInfo(
        id="glories",
        name="Cinesa Diagonal Mar",
        address="Avinguda Diagonal, 208",
        neighborhood="Poble-Nou",
        website_url="https://www.cinesa.es/cines/diagonal-mar/",
        maps_url="https://maps.google.com/?q=Avinguda+Diagonal+208+Barcelona",
        aliases={"english_cinema_bcn": ["Glòries"]},
    ),
    "CinDiag": CinemaInfo(
        id="diagonal",
        name="Cinesa Diagonal",
        address="Carrer de Santa Fe de Nou Mèxic, s/n",
        neighborhood="Les Corts",
        website_url="https://www.cinesa.es/cines/barcelona/diagonal",
        maps_url="https://maps.google.com/?q=Cinesa+Diagonal",
        aliases={"english_cinema_bcn": ["Cin Diag", "Cinesa Diagonal"]},
    ),
}

MINIMAL_HTML = """
<html><body>
<table class="table">
  <thead>
    <tr>
      <th>Movie/Date</th>
      <th>Sat, 28 Mar</th>
      <th>Sun, 29 Mar</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <div class="poster-container">
          <img alt="Project Hail Mary in English at cinemas in Barcelona" />
        </div>
      </td>
      <td>
        <a class="badge badge-s bg-gradient2">
          <strong>18:00</strong> Verdi
        </a>
      </td>
      <td></td>
    </tr>
  </tbody>
</table>
</body></html>
"""


def _mock_response(html: str) -> MagicMock:
    resp = MagicMock()
    resp.text = html
    resp.raise_for_status = MagicMock()
    return resp


def test_fetch_returns_movie_with_stripped_title():
    with patch("providers.listings_provider.date") as mock_date, \
         patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/listings"), \
         patch("providers.listings_provider.requests.get", return_value=_mock_response(MINIMAL_HTML)):
        mock_date.today.return_value = date(2026, 3, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        movies = ListingsProvider().fetch(CINEMAS)

    assert len(movies) == 1
    assert movies[0]["title"] == "Project Hail Mary"


def test_fetch_returns_correct_showtime():
    with patch("providers.listings_provider.date") as mock_date, \
         patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/listings"), \
         patch("providers.listings_provider.requests.get", return_value=_mock_response(MINIMAL_HTML)):
        mock_date.today.return_value = date(2026, 3, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        movies = ListingsProvider().fetch(CINEMAS)

    st = movies[0]["showtimes"][0]
    assert st["date"] == "2026-03-28"
    assert st["time"] == "18:00"
    assert st["cinema"] == "Verdi"
    assert st["neighborhood"] == "Gràcia"


def test_fetch_ignores_unknown_cinemas(caplog):
    """Cinema names not in cinemas.json are excluded from showtimes and logged."""
    with patch("providers.listings_provider.date") as mock_date, \
         patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/listings"), \
         patch("providers.listings_provider.requests.get", return_value=_mock_response(MINIMAL_HTML)):
        mock_date.today.return_value = date(2026, 3, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        movies = ListingsProvider().fetch({})  # empty cinemas -> all unknown

    assert movies == []


def test_fetch_maps_alias_cinema_names_and_sets_vo_language():
    html = """
    <html><body>
    <table class="table">
      <thead>
        <tr>
          <th>Movie/Date</th>
          <th>Sat, 28 Mar</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><div class="poster-container"><img alt="Project Hail Mary in English at cinemas in Barcelona" /></div></td>
          <td><a class="badge badge-s bg-gradient2"><strong>18:00</strong> Cin Diag</a></td>
        </tr>
      </tbody>
    </table>
    </body></html>
    """

    with patch("providers.listings_provider.date") as mock_date, \
         patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/listings"), \
         patch("providers.listings_provider.requests.get", return_value=_mock_response(html)):
        mock_date.today.return_value = date(2026, 3, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        movies = ListingsProvider().fetch(CINEMAS)

    assert len(movies) == 1
    assert movies[0]["showtimes"] == [
        {
            "cinema": "CinDiag",
            "neighborhood": "Les Corts",
            "address": "Carrer de Santa Fe de Nou Mèxic, s/n",
            "date": "2026-03-28",
            "time": "18:00",
            "language": "vo",
        }
    ]


def test_fetch_uses_runtime_configured_url():
    with patch("providers.listings_provider.date") as mock_date, \
         patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/listings") as mock_url, \
         patch("providers.listings_provider.requests.get", return_value=_mock_response(MINIMAL_HTML)) as mock_get:
        mock_date.today.return_value = date(2026, 3, 28)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        ListingsProvider().fetch(CINEMAS)

    mock_url.assert_called_once_with()
    mock_get.assert_called_once()
    assert mock_get.call_args.args[0] == "https://example.com/listings"
