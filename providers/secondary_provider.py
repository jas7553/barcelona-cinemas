from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping

import requests

from models import CinemaInfo, CinemaRegistry, Movie, Showtime
from providers.cinema_aliases import build_cinema_alias_lookup, normalize_alias

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}
_SECONDARY_LISTINGS_URL = "https://www.moobycinemas.com/cartelera"
_WINDOW_SHOPS_RE = re.compile(r"window\.shops\s*=\s*(\{.*?\});", re.DOTALL)


def _extract_shops_payload(html: str) -> dict[str, object]:
    match = _WINDOW_SHOPS_RE.search(html)
    if match is None:
        raise RuntimeError("Could not find window.shops payload on listings page")

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Could not decode shops payload") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("Shops payload was not an object")
    return payload


def _includes_english(value: str) -> bool:
    normalized = value.lower()
    return "english" in normalized or "ingles" in normalized or "angl" in normalized


def _is_english_screening(event: Mapping[str, object]) -> bool:
    language = str(event.get("language", ""))
    subtitles = str(event.get("subtitles_lang", ""))
    return _includes_english(language) or _includes_english(subtitles)


def _parse_showtime(
    performance: Mapping[str, object],
    cinema_key: str,
    cinema: CinemaInfo,
) -> Showtime | None:
    schedule_date = performance.get("schedule_date")
    raw_time = performance.get("time")
    if not isinstance(schedule_date, str) or len(schedule_date) != 8:
        return None
    if not isinstance(raw_time, str) or len(raw_time) < 12:
        return None

    return Showtime(
        cinema=cinema_key,
        neighborhood=cinema["neighborhood"],
        address=cinema["address"],
        date=f"{schedule_date[0:4]}-{schedule_date[4:6]}-{schedule_date[6:8]}",
        time=f"{raw_time[8:10]}:{raw_time[10:12]}",
        language="vo",
    )


def _movie_template(title: str, imdb_id: str | None, showtimes: list[Showtime]) -> Movie:
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


class SecondaryProvider:
    name = "secondary"

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        response = requests.get(_SECONDARY_LISTINGS_URL, headers=_HEADERS, timeout=20)
        response.raise_for_status()

        shops_payload = _extract_shops_payload(response.text)
        alias_lookup = build_cinema_alias_lookup(cinemas, self.name)

        movies_by_key: dict[tuple[str, str], Movie] = {}
        unrecognized_shop_values: set[str] = set()

        for shop in shops_payload.values():
            if not isinstance(shop, Mapping):
                continue

            shop_aliases = [
                str(shop.get("label", "")),
                str(shop.get("name", "")),
                str(shop.get("slug", "")),
                str(shop.get("code", "")),
            ]
            cinema_key: str | None = None
            for alias in shop_aliases:
                normalized = normalize_alias(alias)
                if not normalized:
                    continue
                cinema_key = alias_lookup.get(normalized)
                if cinema_key is not None:
                    break

            if cinema_key is None:
                unrecognized_shop_values.update(alias for alias in shop_aliases if alias)
                continue

            cinema = cinemas[cinema_key]
            events = shop.get("events")
            if not isinstance(events, list):
                continue

            for event in events:
                if not isinstance(event, Mapping):
                    continue
                if not _is_english_screening(event):
                    continue

                title = event.get("name")
                performances = event.get("performances")
                if not isinstance(title, str) or not title.strip():
                    continue
                if not isinstance(performances, list) or not performances:
                    continue

                showtimes: list[Showtime] = []
                for performance in performances:
                    if not isinstance(performance, Mapping):
                        continue
                    showtime = _parse_showtime(performance, cinema_key, cinema)
                    if showtime is not None:
                        showtimes.append(showtime)
                if not showtimes:
                    continue

                imdb_id_value = event.get("imdbid")
                imdb_id = imdb_id_value.strip() if isinstance(imdb_id_value, str) and imdb_id_value.strip() else None
                movie_key = (imdb_id or "", title.strip().casefold())
                movie = movies_by_key.get(movie_key)
                if movie is None:
                    movies_by_key[movie_key] = _movie_template(title.strip(), imdb_id, showtimes)
                    continue

                movie["showtimes"].extend(showtimes)
                if movie["imdb_id"] is None:
                    movie["imdb_id"] = imdb_id

        if unrecognized_shop_values:
            logger.warning(
                "Unrecognized secondary provider cinema labels (not in cinemas.json aliases): %s",
                sorted(unrecognized_shop_values),
            )

        return list(movies_by_key.values())
