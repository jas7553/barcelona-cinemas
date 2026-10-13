"""Helpers shared by listing providers."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from models import PREMIUM_FORMATS, Movie, Showtime

MADRID_TZ = ZoneInfo("Europe/Madrid")


def assume_utc(instant: datetime) -> datetime:
    """`instant` made aware, reading a naive value as UTC (how `fetched_at` and `enriched_at` are written)."""
    return instant if instant.tzinfo is not None else instant.replace(tzinfo=UTC)


def madrid_now(now: datetime | None = None) -> datetime:
    """
    `now` (default: the real current instant) as Madrid wall-clock time.

    Showtime `date`/`time` strings are Madrid-local, but the Lambda runs on UTC
    (see template.yaml), so the system clock's calendar day and hour are wrong
    for comparing against them. Naive input is read as UTC (`assume_utc`).
    """
    if now is None:
        return datetime.now(MADRID_TZ)
    return assume_utc(now).astimezone(MADRID_TZ)


def madrid_today(now: datetime | None = None) -> date:
    """Return "today" as a Madrid calendar date (see `madrid_now`)."""
    return madrid_now(now).date()


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0.0.0 Safari/537.36"
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
