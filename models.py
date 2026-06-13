from typing import NotRequired, TypedDict


class Showtime(TypedDict):
    cinema: str
    neighborhood: str
    address: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    language: NotRequired[str]
    booking_url: NotRequired[str | None]


class Movie(TypedDict):
    title: str
    tmdb_id: int | None
    imdb_id: str | None
    year: int | None
    poster_url: str | None
    backdrop_url: NotRequired[str | None]
    trailer_url: NotRequired[str | None]
    tagline: NotRequired[str | None]
    synopsis: str | None
    rating: float | None
    runtime_mins: int | None
    genres: list[str] | None
    director: NotRequired[str | None]
    cast: NotRequired[list[str] | None]
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
    lat: NotRequired[float | None]
    lng: NotRequired[float | None]
    aliases: NotRequired[dict[str, list[str]]]


CinemaRegistry = dict[str, CinemaInfo]
