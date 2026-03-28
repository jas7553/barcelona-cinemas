import logging
from datetime import date

import requests
from bs4 import BeautifulSoup, Tag

from listings_config import listings_feed_url
from models import CinemaRegistry, Movie, Showtime

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}

_MONTH_MAP = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
    "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
    "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}

_TITLE_SUFFIX = " in English at cinemas in Barcelona"


def _parse_date(header: str) -> str:
    """
    Convert a header like "Sat, 28 Mar" to "YYYY-MM-DD".
    Infers year from today; handles Dec→Jan rollover.
    """
    # header format: "Sat, 28 Mar" or "Sat 28 Mar" (strip day name)
    parts = header.replace(",", "").split()
    # parts: ["Sat", "28", "Mar"]  or  ["Movie/Date"] for the first column
    if len(parts) < 3:
        return ""
    try:
        day = int(parts[1])
        month = _MONTH_MAP[parts[2]]
    except (ValueError, KeyError, IndexError):
        return ""

    today = date.today()
    year = today.year
    # If the parsed month is earlier than today's month by more than 2 months,
    # the listing is rolling into next year (e.g., listing in Dec shows Jan dates).
    candidate = date(year, month, day)
    # If candidate is more than 8 days in the past, bump to next year
    if (today - candidate).days > 8:
        year += 1
        candidate = date(year, month, day)

    return candidate.isoformat()


def _extract_cinema_name(badge: Tag) -> str:
    """
    Extract the cinema short-name from a showtime badge.
    The badge HTML is roughly:
      <a ...><i class="fi-clock ..."></i><strong>18:00</strong> Yelmo Icaria</a>
    We want only NavigableString nodes after the <strong> tag (skip child tags
    like the IMAX <span> so they don't pollute the cinema name).
    """
    from bs4 import NavigableString

    parts: list[str] = []
    found_strong = False
    for child in badge.children:
        if hasattr(child, "name") and child.name == "strong":
            found_strong = True
            continue
        if found_strong and isinstance(child, NavigableString):
            text = str(child).strip()
            if text:
                parts.append(text)
    return " ".join(parts).strip()


class ListingsProvider:
    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]:
        """Fetch and parse the current listings feed."""
        resp = requests.get(listings_feed_url(), headers=_HEADERS, timeout=15)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", class_="table")
        if not table or not isinstance(table, Tag):
            raise RuntimeError("Could not find listings table on page")

        thead = table.find("thead")
        tbody = table.find("tbody")
        if not thead or not isinstance(thead, Tag):
            raise RuntimeError("Could not find table header")
        if not tbody or not isinstance(tbody, Tag):
            raise RuntimeError("Could not find table body")

        # Build the date list from the table header, skipping the title column.
        header_cells = thead.find_all("th")
        dates: list[str] = []
        for th in header_cells[1:]:
            dates.append(_parse_date(th.get_text(strip=True)))

        movies: list[Movie] = []
        seen_cinema_names: set[str] = set()

        for row in tbody.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue

            # The first cell carries the movie title in the poster alt text.
            img = cells[0].find("img")
            if not img:
                continue
            title: str = img.get("alt", "").strip()
            title = title.removesuffix(_TITLE_SUFFIX)
            if not title:
                continue

            showtimes: list[Showtime] = []

            for col_idx, cell in enumerate(cells[1:]):
                if col_idx >= len(dates):
                    break
                show_date = dates[col_idx]
                if not show_date:
                    continue

                for badge in cell.find_all("a", class_="badge-s"):
                    strong = badge.find("strong")
                    if not strong:
                        continue
                    time_str = strong.get_text(strip=True)

                    cinema_name = _extract_cinema_name(badge)
                    seen_cinema_names.add(cinema_name)

                    if cinema_name not in cinemas:
                        continue

                    showtimes.append(
                        Showtime(
                            cinema=cinema_name,
                            neighborhood=cinemas[cinema_name]["neighborhood"],
                            address=cinemas[cinema_name]["address"],
                            date=show_date,
                            time=time_str,
                        )
                    )

            movies.append(
                Movie(
                    title=title,
                    tmdb_id=None,
                    synopsis=None,
                    rating=None,
                    runtime_mins=None,
                    genres=None,
                    showtimes=showtimes,
                )
            )

        # Log unrecognized cinema names to help tune cinemas.json.
        unrecognized = seen_cinema_names - set(cinemas.keys())
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
