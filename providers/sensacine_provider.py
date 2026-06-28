from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from datetime import date, timedelta

import requests

from models import CinemaInfo, CinemaRegistry, Movie, Showtime
from providers.common import DEFAULT_HEADERS, base_movie
from reconcile import reconcile

logger = logging.getLogger(__name__)

_BASE_URL = "https://www.sensacine.com"

# Maps cinemas.json registry keys to SensaCine theater IDs.
# Cinemas absent here (Maquinista, FdC, Filmax) are not listed on SensaCine.
_SENSACINE_IDS: dict[str, str] = {
    "CinDiag": "E0381",
    "CinDigMar": "E0382",
    "SOM": "E0388",
    "Malda": "E0682",
    "Verdi": "E0608",
    "VP": "E0610",
    "Glòries": "E0442",
    "Aribau": "E0091",
    "Arenas": "E0764",
    "Balmes": "E0808",
    "Bosque": "E0136",
    "Sarrià": "E0447",
    "Girona": "E0747",
    "RenFlo": "E0581",
    "EspaiTexas": "E0873",
    "Zumzeig": "E0850",
}

_SUBTITLE_TAG_MAP: dict[str, str] = {
    "Localization.Subtitle.Spanish": "es",
    "Localization.Subtitle.Catalan": "ca",
    "Localization.Subtitle.English": "en",
}

_DAYS_AHEAD = int(os.environ.get("SENSACINE_DAYS_AHEAD", "7"))


def _fetch_dates() -> list[date]:
    today = date.today()
    return [today + timedelta(days=i) for i in range(_DAYS_AHEAD)]


def _booking_url(ticketing: list[Mapping[str, object]]) -> str | None:
    """Return the most direct booking URL from SensaCine ticketing entries.

    Prefers the 'default' provider (direct cinema URL) over relay trackers.
    Falls back to the first relay URL if no direct link exists.
    """
    relay_url: str | None = None
    for entry in ticketing:
        provider = entry.get("provider", "")
        raw_urls = entry.get("urls")
        urls = list(raw_urls) if isinstance(raw_urls, list) else []
        if not urls:
            continue
        url = str(urls[0]).strip()
        if not url:
            continue
        if provider == "default":
            return url
        if relay_url is None:
            relay_url = url
    return relay_url


def _subtitle_lang(tags: list[str]) -> str | None:
    for tag in tags:
        lang = _SUBTITLE_TAG_MAP.get(tag)
        if lang is not None:
            return lang
    return None


def _is_english_or_unknown(languages: list[str]) -> bool:
    """True if the film's original audio is English or unknown."""
    if not languages:
        return True
    return "ENGLISH" in languages


def _audio_lang(languages: list[str]) -> str | None:
    if not languages:
        return None
    if "ENGLISH" in languages:
        return "en"
    return None


def _fetch_showtimes_for_cinema_date(
    sensacine_id: str,
    cinema_key: str,
    cinema: CinemaInfo,
    show_date: date,
) -> list[Movie]:
    url = f"{_BASE_URL}/_/showtimes/theater-{sensacine_id}/d-{show_date.isoformat()}/"
    try:
        resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        logger.warning("sensacine: failed %s on %s: %s", cinema_key, show_date, exc)
        return []

    results = payload.get("results") or []
    movies: list[Movie] = []

    for entry in results:
        if not isinstance(entry, Mapping):
            continue

        movie_info = entry.get("movie") or {}
        title = (movie_info.get("title") or "").strip()
        if not title:
            continue

        languages = [str(lang) for lang in (movie_info.get("languages") or [])]
        if not _is_english_or_unknown(languages):
            continue

        audio = _audio_lang(languages)

        showtimes_by_version = entry.get("showtimes") or {}
        original_sts = showtimes_by_version.get("original") or []

        showtimes: list[Showtime] = []
        for st in original_sts:
            if not isinstance(st, Mapping):
                continue

            starts_at = st.get("startsAt") or ""
            if not starts_at or "T" not in starts_at:
                continue

            date_part, time_part = starts_at.split("T", 1)
            time_str = time_part[:5]  # HH:MM

            tags: list[str] = [str(t) for t in (st.get("tags") or [])]
            sub_lang = _subtitle_lang(tags)

            ticketing_entries = (st.get("data") or {}).get("ticketing") or []
            booking = _booking_url(ticketing_entries)

            showtime = Showtime(
                cinema=cinema_key,
                neighborhood=cinema["neighborhood"],
                address=cinema["address"],
                date=date_part,
                time=time_str,
                language="vo",
            )
            if audio is not None:
                showtime["audio_lang"] = audio
            if sub_lang is not None:
                showtime["subtitle_lang"] = sub_lang
            if booking is not None:
                showtime["booking_url"] = booking
            showtimes.append(showtime)

        if not showtimes:
            continue

        movies.append(base_movie(title, None, showtimes))

    return movies


class SensacineProvider:
    name = "sensacine"

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        dates = _fetch_dates()
        all_movies: list[Movie] = []
        missing_keys: list[str] = []

        for cinema_key, sensacine_id in _SENSACINE_IDS.items():
            cinema = cinemas.get(cinema_key)
            if cinema is None:
                missing_keys.append(cinema_key)
                continue

            for show_date in dates:
                day_movies = _fetch_showtimes_for_cinema_date(sensacine_id, cinema_key, cinema, show_date)
                all_movies.extend(day_movies)

        if missing_keys:
            logger.warning(
                "sensacine: cinema keys not in registry (update _SENSACINE_IDS or cinemas.json): %s",
                sorted(missing_keys),
            )

        return reconcile(all_movies)
