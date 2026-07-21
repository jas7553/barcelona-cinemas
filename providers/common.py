"""Helpers shared by listing providers."""

from models import Movie, Showtime

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
_IMAX = ("imax",)


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
    Normalize a source premium-format label to "imax", or None (not premium).

    Substring-matched: the upstream labels are human-authored ("IMAX 3D",
    "Sala IMAX"), and premium brand names are distinctive enough that a
    false positive is implausible. Never raises.
    """
    value = raw.casefold()
    if _matches(value, _IMAX):
        return "imax"
    return None


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
