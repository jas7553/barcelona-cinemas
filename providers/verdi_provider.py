"""
Verdi + Verdi Park booking-link provider.

Scrapes barcelona.cines-verdi.com for VO (original-version) showtimes and
attaches session-specific admit-one.eu seat-picker URLs to each showtime.

Cinema detection: the admit-one seat page shows "Cines Verdi Barcelona | Sala N"
for Verdi main (numeric sala) and "Cines Verdi Barcelona | Sala A V.Park" (or
similar letter + V.Park suffix) for Verdi Park. One lookup per unique time-slot
per film covers the whole weekly run.

admit-one is the slowest and least reliable dependency in the pipeline: a bad
spell there once ate the entire 120s Lambda budget in 10s timeouts and killed
the whole refresh. Two guards: a short per-request timeout, and a session ->
cinema map recovered from the previous run's cached showtimes, which skips the
network entirely for any session already resolved once.

That second guard is a read-behind on the previous refresh's Listings, and it is
injected, not fetched: `sala_map_from_cache` is a pure function of a Listings
payload and the provider takes the resulting map as a constructor argument. The
provider never touches the cache module, so the ordering constraint it implies
(build the providers from the cache read, before the refresh overwrites it) is
visible in `pipeline._refresh` rather than hidden behind an import.
"""

from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING

import requests

from models import CinemaRegistry, Listings, Movie, Showtime
from providers.common import DEFAULT_HEADERS, base_movie, normalize_subtitle_lang
from reconcile import reconcile

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = logging.getLogger(__name__)

_VERDI_BASE = "https://barcelona.cines-verdi.com"
_ADMIT_ONE_BASE = "https://verdibcn.admit-one.eu"

# Seat pages answer in well under a second when healthy. The ceiling exists to
# bound a hung host, not to wait out a slow one — every second here is spent
# serially, once per unique time slot, inside a 120s Lambda.
_SALA_TIMEOUT = 3

# Session id inside a stored booking_url, for rebuilding the sala map from cache.
_BOOKING_SESSION_RE = re.compile(r"/seats/(\d+)/")

_VERDI_CINEMA_KEYS = frozenset({"Verdi", "VP"})

# href="/some-slug" class="group" — film cards on the cartellera page.
_FILM_LINK_RE = re.compile(r'href="(/[a-z][a-z0-9-]+)"\s+class="group"')

# Showtime buttons embedded in each film page:
#   <a href="https://verdibcn.admit-one.eu/seats/217082/"
#      x-show="!isPast(&#039;20260628180000&#039;)" x-cloak target="_blank">
#     <time>18:00</time><small>CASTELLÀ</small>
#   </a>
_SHOWTIME_RE = re.compile(
    r'href="https://verdibcn\.admit-one\.eu/seats/(\d+)/"'
    r'[^>]*x-show="!isPast\(&#039;(\d{14})&#039;\)"'
    r"[^>]*>\s*<time>(\d{2}:\d{2})</time>\s*<small>([^<]+)</small>",
)

# Sala label on the admit-one seat page: numeric → Verdi, letter + "V.Park" → VP.
_VP_SALA_RE = re.compile(r"Sala [A-Z] V\.Park")
_VERDI_SALA_RE = re.compile(r"Cines Verdi Barcelona \| Sala \d")

# IMDb title ID in the film page's JSON-LD sameAs value.
_IMDB_RE = re.compile(r"imdb\.com/title/(tt\d+)")


def _extract_film_meta(html: str) -> tuple[str | None, str | None]:
    """Return (title, imdb_id) from the film page JSON-LD, or (None, None)."""
    for m in re.finditer(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    ):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        for item in data.get("@graph", []):
            if not isinstance(item, dict) or item.get("@type") != "Movie":
                continue
            title = item.get("name")
            same_as = item.get("sameAs", "")
            # sameAs may be a string or a list of URLs per schema.org spec.
            if isinstance(same_as, list):
                same_as = " ".join(s for s in same_as if isinstance(s, str))
            imdb_m = _IMDB_RE.search(same_as) if isinstance(same_as, str) else None
            if isinstance(title, str) and title.strip():
                return title.strip(), (imdb_m.group(1) if imdb_m else None)
    return None, None


def _parse_sessions(html: str) -> list[tuple[str, str, str, str, str]]:
    """
    Return [(date, time, session_id, booking_url, language), ...] from
    the film page HTML. date is YYYY-MM-DD, time is HH:MM.
    """
    sessions = []
    for m in _SHOWTIME_RE.finditer(html):
        sess_id = m.group(1)
        ts = m.group(2)  # YYYYMMDDHHMMSS
        time_str = m.group(3)  # HH:MM
        lang = m.group(4).strip()
        date = f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]}"
        booking_url = f"{_ADMIT_ONE_BASE}/seats/{sess_id}/"
        sessions.append((date, time_str, sess_id, booking_url, lang))
    return sessions


def _is_vo(language: str) -> bool:
    """True for V.O. (original-version) screenings; False for dubbed."""
    return language.strip().upper().startswith("V.O")


def _resolve_cinema_key(sess_id: str) -> str | None:
    """
    Fetch the admit-one seat page and return "Verdi" or "VP".
    Returns None on any failure (seat page unavailable or unrecognized format).
    """
    url = f"{_ADMIT_ONE_BASE}/seats/{sess_id}/"
    try:
        resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=_SALA_TIMEOUT)
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("Sala lookup failed for session %s: %s", sess_id, exc)
        return None

    if _VP_SALA_RE.search(resp.text):
        return "VP"
    if _VERDI_SALA_RE.search(resp.text):
        return "Verdi"
    logger.warning("Could not determine cinema from seat page for session %s", sess_id)
    return None


def sala_map_from_cache(cached: Listings | None) -> dict[str, str]:
    """
    Rebuild {session_id: cinema_key} from the previous run's cached Showtimes.

    A session's sala never changes once assigned, so a resolution from any
    earlier refresh stays valid for the life of that session id. Returns an
    empty map on a cold cache — the provider then just does the lookups.
    """
    if cached is None:
        return {}

    sala_map: dict[str, str] = {}
    for movie in cached.get("movies", []):
        for showtime in movie.get("showtimes", []):
            cinema_key = showtime.get("cinema")
            booking_url = showtime.get("booking_url")
            if cinema_key not in _VERDI_CINEMA_KEYS or not booking_url:
                continue
            if not booking_url.startswith(_ADMIT_ONE_BASE):
                continue
            m = _BOOKING_SESSION_RE.search(booking_url)
            if m:
                sala_map[m.group(1)] = cinema_key
    return sala_map


class VerdiProvider:
    name = "verdi"

    def __init__(self, sala_map: Mapping[str, str] | None = None) -> None:
        """
        `sala_map` is {session_id: cinema_key} recovered from the previous
        refresh (see `sala_map_from_cache`). Omitting it is a cold start: every
        time slot costs one admit-one lookup.
        """
        self._sala_map: Mapping[str, str] = sala_map or {}

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        try:
            slugs = self._fetch_slugs()
        except Exception as exc:
            logger.warning("Verdi cartellera fetch failed: %s", exc)
            return []

        # Copied: the fetch memoizes newly resolved sessions into it across
        # films, and the injected map belongs to the caller.
        known_salas = dict(self._sala_map)
        logger.info("Verdi sala map seeded with %d cached session(s)", len(known_salas))

        movies: list[Movie] = []
        for slug in slugs:
            try:
                movie = self._process_film(slug, cinemas, known_salas)
            except Exception as exc:
                logger.warning("Verdi film %s skipped: %s", slug, exc)
                continue
            if movie is not None:
                movies.append(movie)

        return reconcile(movies)

    def _fetch_slugs(self) -> list[str]:
        resp = requests.get(f"{_VERDI_BASE}/cartellera", headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()
        return list(dict.fromkeys(_FILM_LINK_RE.findall(resp.text)))

    def _process_film(
        self,
        slug: str,
        cinemas: CinemaRegistry,
        known_salas: dict[str, str] | None = None,
    ) -> Movie | None:
        resp = requests.get(f"{_VERDI_BASE}{slug}", headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()
        html = resp.text

        title, imdb_id = _extract_film_meta(html)
        if not title:
            return None

        sessions = _parse_sessions(html)
        vo_sessions = [(d, t, sid, url, lang) for d, t, sid, url, lang in sessions if _is_vo(lang)]
        if not vo_sessions:
            return None

        # One sala lookup per unique time slot covers the whole run. A slot's
        # sessions all sit in the same sala, so any one of them already in the
        # cached map answers for the slot without touching the network.
        known = known_salas or {}
        sessions_by_time: dict[str, list[str]] = {}
        for _d, time_slot, sess_id, _url, _lang in vo_sessions:
            sessions_by_time.setdefault(time_slot, []).append(sess_id)

        cinema_by_time: dict[str, str | None] = {}
        for time_slot, sess_ids in sessions_by_time.items():
            cached_key = next((known[sid] for sid in sess_ids if sid in known), None)
            if cached_key is not None:
                cinema_by_time[time_slot] = cached_key
                continue
            resolved = _resolve_cinema_key(sess_ids[0])
            cinema_by_time[time_slot] = resolved
            if resolved is not None:
                known[sess_ids[0]] = resolved

        showtimes: list[Showtime] = []
        for date, time_str, _sess_id, booking_url, lang in vo_sessions:
            cinema_key = cinema_by_time.get(time_str)
            if cinema_key is None or cinema_key not in cinemas:
                continue
            cinema_info = cinemas[cinema_key]
            showtime = Showtime(
                cinema=cinema_key,
                neighborhood=cinema_info["neighborhood"],
                address=cinema_info["address"],
                date=date,
                time=time_str,
                language="vo",
                booking_url=booking_url,
            )
            subtitle_lang = normalize_subtitle_lang(lang)
            if subtitle_lang is not None:
                showtime["subtitle_lang"] = subtitle_lang
            showtimes.append(showtime)

        if not showtimes:
            return None

        return base_movie(title, imdb_id, showtimes)
