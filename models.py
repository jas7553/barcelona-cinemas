from typing import TypedDict


class Showtime(TypedDict):
    cinema: str
    neighborhood: str
    address: str
    date: str   # YYYY-MM-DD
    time: str   # HH:MM


class Movie(TypedDict):
    title: str
    tmdb_id: int | None
    imdb_id: str | None
    year: int | None
    poster_url: str | None
    synopsis: str | None
    rating: float | None
    runtime_mins: int | None
    genres: list[str] | None
    showtimes: list[Showtime]


class Listings(TypedDict):
    fetched_at: str  # ISO 8601 datetime
    stale: bool
    movies: list[Movie]


class CinemaInfo(TypedDict):
    id: str
    name: str
    address: str
    neighborhood: str
    website_url: str
    maps_url: str


CinemaRegistry = dict[str, CinemaInfo]
