"""Tests for transform.py — internal Listings → public API shape."""

from datetime import UTC, datetime, timedelta
from typing import Any

from models import CinemaInfo, CinemaRegistry, Listings, Movie, Showtime
from transform import to_api_response

# ── Fixtures ──────────────────────────────────────────────────────────────────

CINEMAS: CinemaRegistry = {
    "Verdi": CinemaInfo(
        id="verdi",
        name="Cinemes Verdi",
        address="Carrer de Verdi, 32",
        neighborhood="Gràcia",
        website_url="https://cinesesverdi.com",
        maps_url="https://maps.google.com/?q=Verdi",
    ),
    "FdC": CinemaInfo(
        id="filmoteca",
        name="Filmoteca de Catalunya",
        address="Plaça de Salvador Seguí, 1-9",
        neighborhood="El Raval",
        website_url="https://filmoteca.cat",
        maps_url="https://maps.google.com/?q=Filmoteca",
    ),
}


def _today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def _listings(movies: list[Movie] | None = None, stale: bool = False) -> Listings:
    return Listings(
        fetched_at=datetime.now(UTC).isoformat(),
        stale=stale,
        movies=movies or [],
    )


def _showtime(cinema: str = "Verdi", date: str | None = None, time: str = "19:00") -> Showtime:
    return Showtime(
        cinema=cinema,
        neighborhood="Gràcia",
        address="Carrer de Verdi, 32",
        date=date or _today_iso(),
        time=time,
    )


def _movie(title: str = "Test Film", showtimes: list[Showtime] | None = None, **kwargs: Any) -> Movie:
    movie_data: dict[str, Any] = {
        "title": title,
        "tmdb_id": None,
        "imdb_id": None,
        "year": None,
        "poster_url": None,
        "synopsis": None,
        "rating": None,
        "runtime_mins": None,
        "genres": None,
        "showtimes": showtimes or [],
    }
    movie_data.update(kwargs)
    return Movie(
        title=movie_data["title"],
        tmdb_id=movie_data["tmdb_id"],
        imdb_id=movie_data["imdb_id"],
        year=movie_data["year"],
        poster_url=movie_data["poster_url"],
        synopsis=movie_data["synopsis"],
        rating=movie_data["rating"],
        runtime_mins=movie_data["runtime_mins"],
        genres=movie_data["genres"],
        showtimes=movie_data["showtimes"],
    )


# ── Top-level shape ───────────────────────────────────────────────────────────

def test_renames_fetched_at_to_generated_at():
    listings = _listings()
    result = to_api_response(listings, CINEMAS)
    assert "generated_at" in result
    assert result["generated_at"] == listings["fetched_at"]
    assert "fetched_at" not in result


def test_preserves_stale_flag():
    result = to_api_response(_listings(stale=True), CINEMAS)
    assert result["stale"] is True


def test_returns_theaters_and_movies_keys():
    result = to_api_response(_listings(), CINEMAS)
    assert "theaters" in result
    assert "movies" in result


# ── Theater list ──────────────────────────────────────────────────────────────

def test_theaters_only_include_cinemas_with_showtimes():
    movie = _movie(showtimes=[_showtime(cinema="Verdi")])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    theater_ids = {t["id"] for t in result["theaters"]}
    assert theater_ids == {"verdi"}
    assert "filmoteca" not in theater_ids


def test_theaters_include_all_required_fields():
    movie = _movie(showtimes=[_showtime(cinema="Verdi")])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    theater = result["theaters"][0]
    assert theater["id"] == "verdi"
    assert theater["name"] == "Cinemes Verdi"
    assert theater["neighborhood"] == "Gràcia"
    assert "website_url" in theater
    assert "maps_url" in theater


def test_empty_theaters_when_no_showtimes():
    result = to_api_response(_listings(movies=[_movie()]), CINEMAS)
    assert result["theaters"] == []


# ── Showtime transformation ───────────────────────────────────────────────────

def test_showtime_uses_theater_id_slug():
    movie = _movie(showtimes=[_showtime(cinema="Verdi")])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    st = result["movies"][0]["showtimes"][0]
    assert st["theater_id"] == "verdi"
    assert "cinema" not in st


def test_showtime_injects_language_vo():
    movie = _movie(showtimes=[_showtime(cinema="Verdi")])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    st = result["movies"][0]["showtimes"][0]
    assert st["language"] == "vo"


def test_showtime_preserves_explicit_language():
    st_data: Showtime = {**_showtime(cinema="Verdi"), "language": "dub"}
    movie = _movie(showtimes=[st_data])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["showtimes"][0]["language"] == "dub"


def test_deduplicates_showtimes():
    dup_showtime = _showtime(cinema="Verdi", date=_today_iso(), time="19:00")
    movie = _movie(showtimes=[dup_showtime, dup_showtime])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert len(result["movies"][0]["showtimes"]) == 1


def test_filters_showtimes_beyond_7_days():
    far_future = (datetime.now(UTC) + timedelta(days=8)).date().isoformat()
    movie = _movie(showtimes=[_showtime(cinema="Verdi", date=far_future)])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["showtimes"] == []


def test_keeps_showtimes_within_7_days():
    near = (datetime.now(UTC) + timedelta(days=3)).date().isoformat()
    movie = _movie(showtimes=[_showtime(cinema="Verdi", date=near)])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert len(result["movies"][0]["showtimes"]) == 1


def test_ignores_unknown_cinema_names():
    unknown_st = _showtime(cinema="UnknownCinema")
    movie = _movie(showtimes=[unknown_st])
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["showtimes"] == []


# ── Movie field mapping ───────────────────────────────────────────────────────

def test_movie_fields_mapped_correctly():
    movie = _movie(
        title="Dune: Part Two",
        tmdb_id=693134,
        imdb_id="tt15239678",
        year=2024,
        poster_url="https://image.tmdb.org/t/p/w342/dune.jpg",
        synopsis="Paul Atreides unites...",
        rating=8.1,
        runtime_mins=166,
        genres=["Action", "Sci-Fi"],
    )
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    m = result["movies"][0]
    assert m["title"] == "Dune: Part Two"
    assert m["year"] == 2024
    assert m["runtime_minutes"] == 166
    assert m["poster_url"] == "https://image.tmdb.org/t/p/w342/dune.jpg"
    assert m["rating"] == 8.1
    assert m["genres"] == ["Action", "Sci-Fi"]
    assert m["synopsis"] == "Paul Atreides unites..."


def test_imdb_link_constructed_from_imdb_id():
    movie = _movie(imdb_id="tt15239678")
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["links"]["imdb"] == "https://www.imdb.com/title/tt15239678"


def test_no_imdb_link_when_imdb_id_missing():
    movie = _movie(imdb_id=None)
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["links"]["imdb"] is None


def test_no_imdb_link_when_imdb_id_is_malformed():
    movie = _movie(imdb_id="not-an-imdb-id")
    result = to_api_response(_listings(movies=[movie]), CINEMAS)
    assert result["movies"][0]["links"]["imdb"] is None


def test_letterboxd_and_filmaffinity_are_null():
    result = to_api_response(_listings(movies=[_movie()]), CINEMAS)
    links = result["movies"][0]["links"]
    assert links["letterboxd"] is None
    assert links["filmaffinity"] is None


def test_empty_movies_returned_when_no_movies():
    result = to_api_response(_listings(movies=[]), CINEMAS)
    assert result["movies"] == []
