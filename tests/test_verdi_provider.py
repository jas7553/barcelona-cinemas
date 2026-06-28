from unittest.mock import MagicMock, patch

from models import CinemaInfo, CinemaRegistry
from providers.verdi_provider import (
    VerdiProvider,
    _extract_film_meta,
    _is_vo,
    _parse_sessions,
    _resolve_cinema_key,
)

CINEMAS: CinemaRegistry = {
    "Verdi": CinemaInfo(
        id="verdi",
        name="Cines Verdi",
        address="Carrer de Verdi, 32",
        neighborhood="Gràcia",
        website_url="https://barcelona.cines-verdi.com",
        maps_url="https://maps.google.com/?q=Cines+Verdi",
        aliases={"english_cinema_bcn": ["Verdi"]},
    ),
    "VP": CinemaInfo(
        id="verdi-park",
        name="Verdi Park",
        address="Carrer de Torrijos, 49",
        neighborhood="Gràcia",
        website_url="https://barcelona.cines-verdi.com",
        maps_url="https://maps.google.com/?q=Verdi+Park",
        aliases={"english_cinema_bcn": ["VP"]},
    ),
}

# Minimal JSON-LD embedded in a film page.
_LDJSON_BLOCK = """
<script type="application/ld+json" id="ldjson-movie">{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MovieTheater",
      "@id": "https://barcelona.cines-verdi.com#cinema",
      "name": "Cinemes Verdi Barcelona"
    },
    {
      "@type": "Movie",
      "@id": "https://barcelona.cines-verdi.com/obsession",
      "name": "Obsession",
      "sameAs": "https://www.imdb.com/title/tt12345678",
      "event": []
    }
  ]
}</script>
"""

# Two VO sessions and one dubbed session (CASTELLÀ without V.O. prefix).
_FILM_HTML = (
    _LDJSON_BLOCK
    + """
<a href="https://verdibcn.admit-one.eu/seats/100001/" x-show="!isPast(&#039;20260628183000&#039;)" x-cloak target="_blank"><time>18:30</time><small>V.O. SUB. CASTELLÀ</small></a>
<a href="https://verdibcn.admit-one.eu/seats/100002/" x-show="!isPast(&#039;20260628203000&#039;)" x-cloak target="_blank"><time>20:30</time><small>V.O. SUB. CASTELLÀ</small></a>
<a href="https://verdibcn.admit-one.eu/seats/100003/" x-show="!isPast(&#039;20260628160000&#039;)" x-cloak target="_blank"><time>16:00</time><small>CASTELLÀ</small></a>
"""
)

# Minimal seat page for a Verdi main cinema session (numeric sala).
_SEAT_PAGE_VERDI = "<p>Cines Verdi Barcelona | Sala 3</p>"

# Minimal seat page for a Verdi Park session (letter sala + V.Park suffix).
_SEAT_PAGE_VP = "<p>Cines Verdi Barcelona | Sala D V.Park</p>"

# Cartellera page with two film slugs.
_CARTELLERA_HTML = """
<a href="/obsession" class="group"><figure></figure></a>
<a href="/toy-story-5" class="group"><figure></figure></a>
"""


def _film_html_with_sessions(sessions: str) -> str:
    return _LDJSON_BLOCK + sessions


def _mock_response(text: str) -> MagicMock:
    r = MagicMock()
    r.text = text
    r.raise_for_status = MagicMock()
    return r


# --- Unit tests for pure helpers ---


def test_extract_film_meta_returns_title_and_imdb_id() -> None:
    title, imdb_id = _extract_film_meta(_FILM_HTML)
    assert title == "Obsession"
    assert imdb_id == "tt12345678"


def test_extract_film_meta_returns_none_when_no_ldjson() -> None:
    title, imdb_id = _extract_film_meta("<html></html>")
    assert title is None
    assert imdb_id is None


def test_extract_film_meta_tolerates_json_ld_array_root() -> None:
    html = '<script type="application/ld+json">[{"@type":"Movie"}]</script>'
    title, imdb_id = _extract_film_meta(html)
    assert title is None  # skipped gracefully, no AttributeError


def test_extract_film_meta_handles_same_as_as_list() -> None:
    html = (
        '<script type="application/ld+json">{"@context":"https://schema.org",'
        '"@graph":[{"@type":"Movie","name":"Obsession",'
        '"sameAs":["https://www.imdb.com/title/tt12345678","https://www.wikidata.org/wiki/Q1"]}]}</script>'
    )
    title, imdb_id = _extract_film_meta(html)
    assert title == "Obsession"
    assert imdb_id == "tt12345678"


def test_parse_sessions_extracts_all_three() -> None:
    sessions = _parse_sessions(_FILM_HTML)
    assert len(sessions) == 3
    dates = {s[0] for s in sessions}
    assert dates == {"2026-06-28"}
    times = {s[1] for s in sessions}
    assert times == {"18:30", "20:30", "16:00"}


def test_parse_sessions_builds_admit_one_urls() -> None:
    sessions = _parse_sessions(_FILM_HTML)
    by_time = {s[1]: s[3] for s in sessions}
    assert by_time["18:30"] == "https://verdibcn.admit-one.eu/seats/100001/"
    assert by_time["20:30"] == "https://verdibcn.admit-one.eu/seats/100002/"


def test_is_vo_true_for_vo_prefix() -> None:
    assert _is_vo("V.O. SUB. CASTELLÀ") is True
    assert _is_vo("V.O.") is True
    assert _is_vo("v.o. sub. español") is True


def test_is_vo_false_for_dubbed() -> None:
    assert _is_vo("CASTELLÀ") is False
    assert _is_vo("CATALÁN") is False
    assert _is_vo("Español") is False


def test_resolve_cinema_key_returns_verdi_for_numeric_sala() -> None:
    with patch(
        "providers.verdi_provider.requests.get",
        return_value=_mock_response(_SEAT_PAGE_VERDI),
    ):
        assert _resolve_cinema_key("100001") == "Verdi"


def test_resolve_cinema_key_returns_vp_for_letter_sala() -> None:
    with patch(
        "providers.verdi_provider.requests.get",
        return_value=_mock_response(_SEAT_PAGE_VP),
    ):
        assert _resolve_cinema_key("100002") == "VP"


def test_resolve_cinema_key_returns_none_on_http_error() -> None:
    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = Exception("connection error")
    with patch("providers.verdi_provider.requests.get", return_value=mock_resp):
        assert _resolve_cinema_key("100003") is None


def test_resolve_cinema_key_returns_none_for_unrecognized_page() -> None:
    with patch(
        "providers.verdi_provider.requests.get",
        return_value=_mock_response("<html>No sala info here</html>"),
    ):
        assert _resolve_cinema_key("100004") is None


# --- Integration tests for VerdiProvider.fetch ---


def _make_get(responses: dict[str, str]) -> MagicMock:
    """Return a mock requests.get that dispatches by URL."""

    def _get(url: str, **kwargs: object) -> MagicMock:
        text = responses.get(url, "")
        return _mock_response(text)

    return MagicMock(side_effect=_get)


def test_fetch_returns_vo_movie_with_booking_url() -> None:
    responses = {
        "https://barcelona.cines-verdi.com/cartellera": _CARTELLERA_HTML,
        "https://barcelona.cines-verdi.com/obsession": _FILM_HTML,
        "https://barcelona.cines-verdi.com/toy-story-5": "<html></html>",
        "https://verdibcn.admit-one.eu/seats/100001/": _SEAT_PAGE_VERDI,
        "https://verdibcn.admit-one.eu/seats/100002/": _SEAT_PAGE_VERDI,
    }
    with patch("providers.verdi_provider.requests.get", side_effect=_make_get(responses)):
        movies = VerdiProvider().fetch(CINEMAS)

    assert len(movies) == 1
    movie = movies[0]
    assert movie["title"] == "Obsession"
    assert movie["imdb_id"] == "tt12345678"

    by_time = {st["time"]: st for st in movie["showtimes"]}
    assert "18:30" in by_time
    assert "20:30" in by_time
    assert "16:00" not in by_time  # dubbed session excluded

    assert by_time["18:30"]["booking_url"] == "https://verdibcn.admit-one.eu/seats/100001/"
    assert by_time["18:30"]["cinema"] == "Verdi"
    assert by_time["18:30"]["language"] == "vo"
    assert by_time["18:30"].get("subtitle_lang") == "es"  # from "V.O. SUB. CASTELLÀ"


def test_fetch_assigns_vp_cinema_key_for_letter_sala() -> None:
    film_html = _film_html_with_sessions(
        '\n<a href="https://verdibcn.admit-one.eu/seats/200001/" x-show="!isPast(&#039;20260628203000&#039;)" x-cloak target="_blank"><time>20:30</time><small>V.O. SUB. CASTELLÀ</small></a>\n'
    )
    responses = {
        "https://barcelona.cines-verdi.com/cartellera": '<a href="/obsession" class="group"></a>',
        "https://barcelona.cines-verdi.com/obsession": film_html,
        "https://verdibcn.admit-one.eu/seats/200001/": _SEAT_PAGE_VP,
    }
    with patch("providers.verdi_provider.requests.get", side_effect=_make_get(responses)):
        movies = VerdiProvider().fetch(CINEMAS)

    assert len(movies) == 1
    assert movies[0]["showtimes"][0]["cinema"] == "VP"


def test_fetch_skips_showtime_when_sala_lookup_fails() -> None:
    film_html = _film_html_with_sessions(
        '\n<a href="https://verdibcn.admit-one.eu/seats/300001/" x-show="!isPast(&#039;20260628183000&#039;)" x-cloak target="_blank"><time>18:30</time><small>V.O. SUB. CASTELLÀ</small></a>\n'
    )
    responses = {
        "https://barcelona.cines-verdi.com/cartellera": '<a href="/obsession" class="group"></a>',
        "https://barcelona.cines-verdi.com/obsession": film_html,
        "https://verdibcn.admit-one.eu/seats/300001/": "<html>No sala info</html>",
    }
    with patch("providers.verdi_provider.requests.get", side_effect=_make_get(responses)):
        movies = VerdiProvider().fetch(CINEMAS)

    # No showtimes → no movie returned.
    assert movies == []


def test_fetch_skips_film_when_cartellera_fetch_fails() -> None:
    mock_get = MagicMock(side_effect=Exception("timeout"))
    with patch("providers.verdi_provider.requests.get", mock_get):
        movies = VerdiProvider().fetch(CINEMAS)

    assert movies == []


def test_fetch_skips_film_when_film_page_fails() -> None:
    def _get(url: str, **kwargs: object) -> MagicMock:
        if "cartellera" in url:
            return _mock_response('<a href="/obsession" class="group"></a>')
        raise Exception("timeout")

    with patch("providers.verdi_provider.requests.get", side_effect=_get):
        movies = VerdiProvider().fetch(CINEMAS)

    assert movies == []


def test_fetch_deduplicates_same_time_slot_sala_lookup() -> None:
    """Only one sala request per unique time slot, not one per session."""
    film_html = _film_html_with_sessions("""
<a href="https://verdibcn.admit-one.eu/seats/400001/" x-show="!isPast(&#039;20260628203000&#039;)" x-cloak target="_blank"><time>20:30</time><small>V.O. SUB. CASTELLÀ</small></a>
<a href="https://verdibcn.admit-one.eu/seats/400002/" x-show="!isPast(&#039;20260629203000&#039;)" x-cloak target="_blank"><time>20:30</time><small>V.O. SUB. CASTELLÀ</small></a>
<a href="https://verdibcn.admit-one.eu/seats/400003/" x-show="!isPast(&#039;20260630203000&#039;)" x-cloak target="_blank"><time>20:30</time><small>V.O. SUB. CASTELLÀ</small></a>
""")
    seat_urls_fetched: list[str] = []

    def _get(url: str, **kwargs: object) -> MagicMock:
        if "cartellera" in url:
            return _mock_response('<a href="/obsession" class="group"></a>')
        if "cines-verdi.com" in url:
            return _mock_response(film_html)
        seat_urls_fetched.append(url)
        return _mock_response(_SEAT_PAGE_VERDI)

    with patch("providers.verdi_provider.requests.get", side_effect=_get):
        VerdiProvider().fetch(CINEMAS)

    # Three sessions at the same time → only ONE sala lookup.
    assert len(seat_urls_fetched) == 1
    assert "400001" in seat_urls_fetched[0]
