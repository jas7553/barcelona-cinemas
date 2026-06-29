from typing import NotRequired, TypedDict


class Showtime(TypedDict):
    cinema: str
    neighborhood: str
    address: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    language: NotRequired[str]
    audio_lang: NotRequired[str | None]  # "en" | "other" | None (unknown)
    subtitle_lang: NotRequired[str | None]  # "en" | "es" | "ca" | None (unknown)
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
    vote_count: NotRequired[int | None]  # TMDb vote count; absent in caches predating this field
    runtime_mins: int | None
    genres: list[str] | None
    english_title: NotRequired[str | None]  # TMDb English title; absent when same as scraper title or unknown
    original_lang: NotRequired[str | None]  # ISO 639-1 code, e.g. "fr"
    director: NotRequired[str | None]
    cast: NotRequired[list[str] | None]
    enriched_at: NotRequired[str]  # ISO 8601; when TMDb metadata was last fetched
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
