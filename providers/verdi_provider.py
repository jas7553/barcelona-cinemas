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
the whole refresh. Three guards: a short per-request timeout, a session ->
cinema map recovered from the previous run's cached showtimes, which skips the
network entirely for any session already resolved once, and the remaining
lookups run a few at a time, after every film page is in. The film pages
themselves stay one at a time: their host has blocked this client before.

A showtime whose sala can't be resolved is left out and reported
(`report_partial_failure`); past its limit the whole fetch fails, so the
refresh retries and then falls back to the last good snapshot.

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
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, NamedTuple

import requests

from models import CinemaRegistry, Listings, Movie, Showtime
from providers.common import DEFAULT_HEADERS, base_movie, normalize_subtitle_lang
from providers.diagnostics import record_entry_response, report_partial_failure
from reconcile import reconcile

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = logging.getLogger(__name__)

_VERDI_BASE = "https://barcelona.cines-verdi.com"
_ADMIT_ONE_BASE = "https://verdibcn.admit-one.eu"

# Seat pages answer in well under a second when healthy. The ceiling exists to
# bound a hung host, not to wait out a slow one: every unique time slot not in
# the cached map costs up to this long, inside the refresh Lambda's timeout.
_SALA_TIMEOUT = 3
_SALA_WORKERS = 4

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

    Reads this Provider's snapshot as well as the published Movies: the
    snapshot still has the films the English filter dropped, whose sessions
    would otherwise be looked up again on every refresh.
    """
    if cached is None:
        return {}

    snapshot = cached.get("provider_snapshots", {}).get(VerdiProvider.name)
    sala_map: dict[str, str] = {}
    for movie in [*cached.get("movies", []), *(snapshot["movies"] if snapshot else [])]:
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


class _Session(NamedTuple):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    id: str
    booking_url: str
    language: str


class _Film(NamedTuple):
    title: str
    imdb_id: str | None
    sessions: list[_Session]  # V.O. only

    def slots(self) -> list[list[str]]:
        """
        Session ids grouped by time slot, each slot's latest date first. A
        slot's sessions all sit in the same sala.
        """
        by_time: dict[str, list[_Session]] = {}
        for session in self.sessions:
            by_time.setdefault(session.time, []).append(session)
        return [
            [session.id for session in sorted(slot, key=lambda session: session.date, reverse=True)]
            for slot in by_time.values()
        ]


class VerdiProvider:
    name = "verdi"

    def __init__(self, sala_map: Mapping[str, str] | None = None) -> None:
        """
        `sala_map` is {session_id: cinema_key} recovered from the previous
        refresh (see `sala_map_from_cache`). Omitting it is a cold start: every
        time slot costs one admit-one lookup.
        """
        # Copied: lookups are added to it, and the injected map belongs to the
        # caller. Kept on the instance so a retried fetch repeats only the
        # lookups that failed.
        self._salas: dict[str, str] = dict(sala_map or {})

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        # The cartellera fetch is the one failure mode that means "Verdi is
        # unreachable" (network/HTTP error) rather than "Verdi genuinely has
        # no English screenings this week". Letting it propagate lets
        # refresh.py's _fetch_provider_movies classify it as ProviderFailure
        # instead of ProviderZeroResult — swallowed here, it previously looked
        # identical to an honest empty cartellera and never tripped the
        # degradation alarm. One bad film page shouldn't fail the whole
        # provider, so those are skipped and counted.
        slugs = self._fetch_slugs()
        logger.info("Verdi sala map seeded with %d cached session(s)", len(self._salas))

        films: list[_Film] = []
        failed_pages = 0
        for slug in slugs:
            try:
                film = self._fetch_film(slug)
            except Exception as exc:
                logger.warning("Verdi film %s skipped: %s", slug, exc)
                failed_pages += 1
                continue
            if film is not None:
                films.append(film)
        report_partial_failure(self.name, "film pages", failed=failed_pages, total=len(slugs))

        self._resolve_salas(films)

        movies: list[Movie] = []
        unresolved = 0
        for film in films:
            showtimes: list[Showtime] = []
            for session in film.sessions:
                cinema_key = self._salas.get(session.id)
                if cinema_key is None:
                    unresolved += 1
                elif cinema_key in cinemas:
                    showtimes.append(_showtime(session, cinema_key, cinemas))
            if showtimes:
                movies.append(base_movie(film.title, film.imdb_id, showtimes))
        report_partial_failure(
            self.name,
            "showtimes without a sala",
            failed=unresolved,
            total=sum(len(film.sessions) for film in films),
        )

        return reconcile(movies)

    def _fetch_slugs(self) -> list[str]:
        resp = requests.get(f"{_VERDI_BASE}/cartellera", headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()
        record_entry_response(resp)
        return list(dict.fromkeys(_FILM_LINK_RE.findall(resp.text)))

    def _fetch_film(self, slug: str) -> _Film | None:
        """A film page's title and V.O. sessions, or None if it has neither."""
        resp = requests.get(f"{_VERDI_BASE}{slug}", headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()
        html = resp.text

        title, imdb_id = _extract_film_meta(html)
        if not title:
            return None
        sessions = [_Session(*session) for session in _parse_sessions(html) if _is_vo(session[4])]
        return _Film(title, imdb_id, sessions) if sessions else None

    def _resolve_salas(self, films: list[_Film]) -> None:
        """
        Fill `self._salas` for every session of `films` whose slot can be
        resolved: from a slot-mate already in the map, else by one admit-one
        lookup per slot, a few at a time.

        The lookup asks about the slot's latest session. Film pages still list
        today's sessions that have started, and admit-one answers for those
        with a "session expired" page that names no sala.
        """
        slots = [session_ids for film in films for session_ids in film.slots()]
        unknown = [ids[0] for ids in slots if not any(session_id in self._salas for session_id in ids)]
        with ThreadPoolExecutor(max_workers=_SALA_WORKERS) as executor:
            resolved = list(executor.map(_resolve_cinema_key, unknown))
        self._salas.update({sid: key for sid, key in zip(unknown, resolved, strict=True) if key is not None})

        for session_ids in slots:
            cinema_key = next((self._salas[sid] for sid in session_ids if sid in self._salas), None)
            if cinema_key is not None:
                self._salas.update(dict.fromkeys(session_ids, cinema_key))


def _showtime(session: _Session, cinema_key: str, cinemas: CinemaRegistry) -> Showtime:
    cinema_info = cinemas[cinema_key]
    showtime = Showtime(
        cinema=cinema_key,
        neighborhood=cinema_info["neighborhood"],
        address=cinema_info["address"],
        date=session.date,
        time=session.time,
        language="vo",
        booking_url=session.booking_url,
    )
    subtitle_lang = normalize_subtitle_lang(session.language)
    if subtitle_lang is not None:
        showtime["subtitle_lang"] = subtitle_lang
    return showtime
