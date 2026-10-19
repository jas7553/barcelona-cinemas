from typing import NotRequired, TypedDict

# Premium large-format screening slugs. The single Python-side vocabulary:
# providers/common.py matches source labels against it, validation.py gates on
# it at ingest, transform.py at publish. Adding one here also needs a label in
# src/utils.ts (PREMIUM_FORMAT_LABELS) to render a chip.
PREMIUM_FORMATS: tuple[str, ...] = ("imax",)


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
    premium_format: NotRequired[str | None]  # PREMIUM_FORMATS | None; absent in caches predating this field


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
    match_version: NotRequired[int]  # enricher.MATCH_VERSION that picked the TMDb match; absent means 1
    # What the Providers say about the film, kept to pick the right TMDb match.
    # Internal: never published.
    original_title: NotRequired[str]  # original-language title, e.g. "The Odyssey" for "La Odisea"
    source_year: NotRequired[int]  # first release year
    source_runtime_mins: NotRequired[int]
    rerelease: NotRequired[bool]  # a source title carried a re-release suffix, e.g. "(Reestreno)"
    showtimes: list[Showtime]


class EndedMovie(Movie):
    """A Movie no longer in the listings, kept so its film page outlives the run."""

    last_showing: str  # YYYY-MM-DD, Madrid calendar date


class ProviderSnapshot(TypedDict):
    """One Provider's last non-empty output, pre-Reconciliation and pre-Enrichment."""

    fetched_at: str  # ISO 8601; when this Provider last answered, not when the cache was written
    movies: list[Movie]


class Listings(TypedDict):
    fetched_at: str  # ISO 8601 datetime
    movies: list[Movie]
    ended: NotRequired[list[EndedMovie]]  # absent in caches predating film retention
    # Keyed by Provider name. Internal to the cache; never published.
    provider_snapshots: NotRequired[dict[str, ProviderSnapshot]]


class CinemaInfo(TypedDict):
    id: str
    name: str
    short_name: NotRequired[str]  # "Verdi" for "Cines Verdi"; chips and maps
    address: str
    neighborhood: str
    website_url: str
    maps_url: str
    lat: NotRequired[float | None]
    lng: NotRequired[float | None]
    aliases: NotRequired[dict[str, list[str]]]


CinemaRegistry = dict[str, CinemaInfo]
