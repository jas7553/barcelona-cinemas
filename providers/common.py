"""Helpers shared by listing providers."""

from models import Movie, Showtime

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}


def base_movie(title: str, imdb_id: str | None, showtimes: list[Showtime]) -> Movie:
    """Movie with only provider-known fields set; enrichment fills the rest."""
    return Movie(
        title=title,
        tmdb_id=None,
        imdb_id=imdb_id,
        year=None,
        poster_url=None,
        synopsis=None,
        rating=None,
        runtime_mins=None,
        genres=None,
        showtimes=showtimes,
    )
