"""Tests for providers/listings_provider.py — HTML parsing logic."""

import json
import pathlib
from collections.abc import Callable
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from bs4 import BeautifulSoup, Tag

from models import CinemaInfo, CinemaRegistry
from providers.cinema_aliases import build_cinema_alias_lookup, normalize_alias
from providers.listings_provider import (
    ListingsProvider,
    _parse_showtime_label,
    _premium_format,
)

_CINEMAS_PATH = pathlib.Path(__file__).parent.parent / "cinemas.json"

# ── _parse_showtime_label ───────────────────────────────────────────────────


def test_parse_showtime_label_standard():
    with patch("providers.listings_provider.madrid_today", return_value=date(2026, 9, 13)):
        show_date, time_str = _parse_showtime_label("Sun 13 Sept 20:45")
    assert show_date == "2026-09-13"
    assert time_str == "20:45"


def test_parse_showtime_label_next_year_rollover():
    """A Jan listing date seen in December should resolve to next year's January."""
    with patch("providers.listings_provider.madrid_today", return_value=date(2026, 12, 28)):
        show_date, time_str = _parse_showtime_label("Mon 5 Jan 18:00")
    # Jan 5 relative to Dec 28: candidate(2026-01-05) is ~357 days in the past → bump to 2027
    assert show_date == "2027-01-05"
    assert time_str == "18:00"


def test_parse_showtime_label_invalid_returns_empty():
    assert _parse_showtime_label("garbled") == ("", "")
    assert _parse_showtime_label("") == ("", "")


# ── _premium_format ───────────────────────────────────────────────────────────


def _chip(html: str) -> Tag:
    """Parse a showtime-chip `<a>` out of an HTML snippet."""
    tag = BeautifulSoup(html, "html.parser").find("a")
    assert isinstance(tag, Tag)
    return tag


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        (
            '<a><span class="showtime-chip-time">18:05</span>'
            '<span class="showtime-tags"><span class="showtime-tag">IMAX</span></span></a>',
            "imax",
        ),
        ('<a><span class="showtime-chip-time">18:00</span></a>', None),  # no tags at all
        (
            '<a><span class="showtime-chip-time">18:00</span>'
            '<span class="showtime-tags"><span class="showtime-tag">VOSE</span></span></a>',
            None,
        ),  # unmapped
        # Several tags: the format is not necessarily the first one.
        (
            '<a><span class="showtime-chip-time">18:00</span>'
            '<span class="showtime-tags"><span class="showtime-tag">VOSE</span>'
            '<span class="showtime-tag">IMAX</span></span></a>',
            "imax",
        ),
    ],
)
def test_premium_format(html: str, expected: str | None) -> None:
    assert _premium_format(_chip(html)) == expected


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

# The catalog page: one <a class="film-card"> per currently showing film,
# linking off to that film's own detail page for the full schedule.
CATALOG_HTML = """
<html><body>
<div class="film-grid">
  <a class="film-card" data-title="Project Hail Mary" href="/m/project-hail-mary/in-english-in-barcelona"></a>
</div>
</body></html>
"""

# The per-film detail page: schedule grouped by day, then by cinema block,
# with one <a class="showtime-chip"> per showtime.
FILM_DETAIL_HTML = """
<html><body>
<section id="showtimes">
  <div class="day-group" data-day-index="0">
    <div class="cinema-block" data-cinema-id="28">
      <div class="cinema-block-info">
        <h3 class="cinema-block-name"><a href="/cinema/cinemes-verdi">Verdi</a></h3>
      </div>
      <div class="cinema-block-times">
        <a class="showtime-chip" data-showtime-id="1" data-showtime-label="Sat 28 Mar 18:00" href="/r/cinemes-verdi/project-hail-mary/1">
          <span class="showtime-chip-time">18:00</span>
        </a>
      </div>
    </div>
  </div>
</section>
</body></html>
"""


def _mock_response(html: str, url: str = "https://example.com/films") -> MagicMock:
    resp = MagicMock()
    resp.text = html
    resp.url = url
    resp.raise_for_status = MagicMock()
    return resp


def _mock_get(catalog_html: str, detail_html: str) -> Callable[..., MagicMock]:
    """requests.get side_effect: first call returns the catalog, the rest the film detail page."""
    responses = [_mock_response(catalog_html)]

    def side_effect(url: str, **kwargs: object) -> MagicMock:
        if responses:
            return responses.pop(0)
        return _mock_response(detail_html, url=url)

    return side_effect


def test_fetch_returns_movie_with_title_from_catalog():
    with (
        patch("providers.listings_provider.madrid_today", return_value=date(2026, 3, 28)),
        patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/films"),
        patch(
            "providers.listings_provider.requests.get",
            side_effect=_mock_get(CATALOG_HTML, FILM_DETAIL_HTML),
        ),
    ):
        movies = ListingsProvider().fetch(CINEMAS)

    assert len(movies) == 1
    assert movies[0]["title"] == "Project Hail Mary"


def test_fetch_returns_correct_showtime():
    with (
        patch("providers.listings_provider.madrid_today", return_value=date(2026, 3, 28)),
        patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/films"),
        patch(
            "providers.listings_provider.requests.get",
            side_effect=_mock_get(CATALOG_HTML, FILM_DETAIL_HTML),
        ),
    ):
        movies = ListingsProvider().fetch(CINEMAS)

    st = movies[0]["showtimes"][0]
    assert st["date"] == "2026-03-28"
    assert st["time"] == "18:00"
    assert st["cinema"] == "Verdi"
    assert st["neighborhood"] == "Gràcia"


def test_fetch_ignores_unknown_cinemas(caplog):
    """Cinema names not in cinemas.json are excluded from showtimes and logged."""
    with (
        patch("providers.listings_provider.madrid_today", return_value=date(2026, 3, 28)),
        patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/films"),
        patch(
            "providers.listings_provider.requests.get",
            side_effect=_mock_get(CATALOG_HTML, FILM_DETAIL_HTML),
        ),
    ):
        movies = ListingsProvider().fetch({})  # empty cinemas -> all unknown

    assert movies == []


def test_fetch_maps_alias_cinema_names_and_sets_vo_language():
    detail_html = """
    <html><body>
    <section id="showtimes">
      <div class="day-group" data-day-index="0">
        <div class="cinema-block" data-cinema-id="40">
          <div class="cinema-block-info">
            <h3 class="cinema-block-name"><a href="/cinema/cinesa-diagonal">Cin Diag</a></h3>
          </div>
          <div class="cinema-block-times">
            <a class="showtime-chip" data-showtime-id="1" data-showtime-label="Sat 28 Mar 18:00" href="/r/cinesa-diagonal/project-hail-mary/1">
              <span class="showtime-chip-time">18:00</span>
            </a>
          </div>
        </div>
      </div>
    </section>
    </body></html>
    """

    with (
        patch("providers.listings_provider.madrid_today", return_value=date(2026, 3, 28)),
        patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/films"),
        patch(
            "providers.listings_provider.requests.get",
            side_effect=_mock_get(CATALOG_HTML, detail_html),
        ),
    ):
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
    with (
        patch("providers.listings_provider.madrid_today", return_value=date(2026, 3, 28)),
        patch("providers.listings_provider.listings_feed_url", return_value="https://example.com/films") as mock_url,
        patch(
            "providers.listings_provider.requests.get",
            side_effect=_mock_get(CATALOG_HTML, FILM_DETAIL_HTML),
        ) as mock_get,
    ):
        ListingsProvider().fetch(CINEMAS)

    mock_url.assert_called_once_with()
    assert mock_get.call_args_list[0].args[0] == "https://example.com/films"


# ── Real cinemas.json alias coverage ────────────────────────────────────────
# The source site redesign started showing full official
# cinema names (e.g. "Cinemes Verdi" instead of "Verdi") in `cinema-block-name`.
# These names must resolve via `english_cinema_bcn` aliases in cinemas.json,
# or their showtimes are silently dropped.


class TestRedesignedSiteCinemaNames:
    _NAMES_TO_KEYS = {
        "Arenas de Barcelona Multicines": "Arenas",
        "Cinemes Verdi": "Verdi",
        "Mooby Gran Sarrià": "Sarrià",
        "Zumzeig Cinema": "Zumzeig",
    }

    def test_redesigned_site_names_resolve_to_registry_keys(self) -> None:
        registry: CinemaRegistry = json.loads(_CINEMAS_PATH.read_text())
        alias_lookup = build_cinema_alias_lookup(registry, "english_cinema_bcn")
        for site_name, expected_key in self._NAMES_TO_KEYS.items():
            assert alias_lookup.get(normalize_alias(site_name)) == expected_key
