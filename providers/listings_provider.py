import logging
from datetime import date
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

from listings_config import listings_feed_url
from models import CinemaRegistry, Movie, Showtime
from providers.cinema_aliases import build_cinema_alias_lookup, normalize_alias
from providers.common import DEFAULT_HEADERS, base_movie, normalize_premium_format

logger = logging.getLogger(__name__)

_MONTH_MAP = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


def _parse_showtime_label(label: str) -> tuple[str, str]:
    """
    Convert a showtime-chip's `data-showtime-label`, e.g. "Sun 13 Sept 20:45",
    to a `(date, time)` pair of ("YYYY-MM-DD", "HH:MM"). Infers year from
    today; handles Dec→Jan rollover. The month token is matched on its first
    three letters since the site spells September "Sept" (4 letters) but
    every other month with the usual 3-letter abbreviation.
    """
    parts = label.split()
    if len(parts) != 4:
        return "", ""
    try:
        day = int(parts[1])
        month = _MONTH_MAP[parts[2][:3]]
    except (ValueError, KeyError, IndexError):
        return "", ""
    time_str = parts[3]

    today = date.today()
    year = today.year
    try:
        # If candidate is more than 8 days in the past, the listing is rolling
        # into next year (e.g. a Dec listing showing Jan dates) — bump the year.
        candidate = date(year, month, day)
        if (today - candidate).days > 8:
            candidate = date(year + 1, month, day)
    except ValueError:
        # Impossible day/month (e.g. Feb 29 in a non-leap year from a garbled
        # label) — skip this showtime rather than crash the whole fetch.
        return "", ""

    return candidate.isoformat(), time_str


def _premium_format(chip: Tag) -> str | None:
    """
    Extract the premium format from a showtime chip, if it carries one.
    The chip HTML is roughly:
      <a class="showtime-chip" ...><span class="showtime-chip-time">18:05</span>
        <span class="showtime-tags"><span class="showtime-tag">IMAX</span></span></a>
    All tag spans are scanned: a chip may carry several (e.g. a version label
    beside the format), and only one of them is the premium format.
    """
    for span in chip.find_all("span", class_="showtime-tag"):
        premium_format = normalize_premium_format(span.get_text())
        if premium_format is not None:
            return premium_format
    return None


class ListingsProvider:
    name = "english_cinema_bcn"

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        """
        Fetch and parse the current listings feed.

        The feed URL is now a film-catalog page (one card per currently
        showing film, no per-showtime detail); the full schedule lives on
        each film's own detail page, which is fetched in turn.
        """
        resp = requests.get(listings_feed_url(), headers=DEFAULT_HEADERS, timeout=15)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        film_cards = soup.find_all("a", class_="film-card")
        if not film_cards:
            raise RuntimeError("Could not find film listing cards on page")

        movies: list[Movie] = []
        seen_cinema_names: set[str] = set()
        alias_lookup = build_cinema_alias_lookup(cinemas, self.name)

        for card in film_cards:
            if not isinstance(card, Tag):
                continue
            title = card.get("data-title", "")
            title = title.strip() if isinstance(title, str) else ""
            href = card.get("href")
            if not title or not isinstance(href, str) or not href:
                continue

            film_resp = requests.get(urljoin(resp.url, href), headers=DEFAULT_HEADERS, timeout=15)
            film_resp.raise_for_status()
            film_soup = BeautifulSoup(film_resp.text, "html.parser")

            showtimes: list[Showtime] = []

            for block in film_soup.find_all("div", class_="cinema-block"):
                name_tag = block.find("h3", class_="cinema-block-name")
                if not name_tag:
                    continue
                cinema_name = name_tag.get_text(strip=True)
                seen_cinema_names.add(cinema_name)
                cinema_key = alias_lookup.get(normalize_alias(cinema_name))

                for chip in block.find_all("a", class_="showtime-chip"):
                    show_date, time_str = _parse_showtime_label(chip.get("data-showtime-label", ""))
                    if not show_date:
                        continue
                    if cinema_key is None:
                        continue

                    showtime = Showtime(
                        cinema=cinema_key,
                        neighborhood=cinemas[cinema_key]["neighborhood"],
                        address=cinemas[cinema_key]["address"],
                        date=show_date,
                        time=time_str,
                        language="vo",
                    )
                    premium_format = _premium_format(chip)
                    if premium_format is not None:
                        showtime["premium_format"] = premium_format
                    showtimes.append(showtime)

            if not showtimes:
                continue

            movies.append(base_movie(title, None, showtimes))

        # Log unrecognized cinema names to help tune cinemas.json.
        unrecognized = {
            cinema_name for cinema_name in seen_cinema_names if normalize_alias(cinema_name) not in alias_lookup
        }
        if unrecognized:
            logger.warning(
                "Unrecognized cinema names (not in cinemas.json): %s",
                sorted(unrecognized),
            )

        return movies


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO, stream=sys.stderr)

    cinemas_path = "cinemas.json"
    try:
        with open(cinemas_path) as f:
            cinemas: CinemaRegistry = json.load(f)
    except FileNotFoundError:
        cinemas = {}

    provider = ListingsProvider()
    print("Fetching current listings page ...\n", file=sys.stderr)
    movies = provider.fetch(cinemas)

    if not movies:
        print("No movies found.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(movies)} film(s):\n")
    for m in movies:
        suffix = f"  [{len(m['showtimes'])} showtimes at tracked cinemas]" if m["showtimes"] else ""
        print(f"  {m['title']}{suffix}")
        for s in m["showtimes"]:
            print(f"    {s['date']}  {s['time']}  {s['cinema']}")

    print("\n--- All cinema names seen on current listings page ---", file=sys.stderr)
    print("(Run with cinemas.json populated to filter to your area)\n", file=sys.stderr)
