"""Helpers shared by listing providers."""

from models import PREMIUM_FORMATS, Movie, Showtime

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}


# Source feeds label audio/subtitle languages in mixed Catalan, Spanish, and
# English free text (e.g. "Anglès", "Español", "English"). Substring matching
# tolerates accents and the -s/-és variants without a full locale table.
def _matches(value: str, needles: tuple[str, ...]) -> bool:
    return any(needle in value for needle in needles)


_ENGLISH = ("english", "ingl", "angl")
_SPANISH = ("españ", "espan", "castell", "spanish")
_CATALAN = ("català", "catal")


def normalize_audio_lang(raw: str) -> str | None:
    """Normalize a source audio-language label to "en", "other", or None (unknown)."""
    value = raw.strip().lower()
    if not value:
        return None
    if _matches(value, _ENGLISH):
        return "en"
    return "other"


def normalize_subtitle_lang(raw: str) -> str | None:
    """Normalize a source subtitle-language label to "en"/"es"/"ca", or None (unknown)."""
    value = raw.strip().lower()
    if not value:
        return None
    if _matches(value, _ENGLISH):
        return "en"
    if _matches(value, _CATALAN):  # check Catalan before Spanish: "català" has no Spanish needle
        return "ca"
    if _matches(value, _SPANISH):
        return "es"
    return None


def normalize_premium_format(raw: str) -> str | None:
    """
    Normalize a source premium-format label to a `PREMIUM_FORMATS` slug, or
    None (not premium).

    The slug doubles as the needle: upstream labels are human-authored ("IMAX
    3D", "Sala IMAX"), and premium brand names are distinctive enough that
    substring matching cannot plausibly produce a false positive. Adding a
    format is then a one-line edit to `PREMIUM_FORMATS`. Never raises.
    """
    value = raw.strip().lower()
    if not value:
        return None
    return next((slug for slug in PREMIUM_FORMATS if slug in value), None)


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
