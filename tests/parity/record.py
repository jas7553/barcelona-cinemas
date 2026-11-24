"""
Record a live set of the public, hard-coded sources: Verdi (cartellera, a few
film pages, the admit-one seat pages those sessions need) and SensaCine (a few
theatres, today and tomorrow).

    python tests/parity/record.py [--films 5] [--theatres Balmes,Aribau,...] [--days 2]

Writes `app/pipeline/fixtures/recorded/live-<today, Madrid>/` and refuses to
overwrite one, so a rerun is safe (delete the directory to redo a day). The
providers run unmodified, narrowed the same way `golden.py` narrows them, with
`requests.get` wrapped to save each response; their own URLs and headers are
what is recorded. The listings feed, the secondary feed and TMDb are not
recorded: their URLs and keys come from secrets.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from datetime import datetime, time
from pathlib import Path
from typing import Any

import requests

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.parity.common import RECORDED, ROOT, strip_credentials  # noqa: E402
from tests.parity.golden import provider_overrides  # noqa: E402

DEFAULT_THEATRES = ("Balmes", "Aribau", "Bosque", "Verdi", "Malda")  # three Mooby (admit-one) cinemas, Verdi, Maldà

_real_get = requests.get


class Recorder:
    """`requests.get` that saves every response it passes through."""

    def __init__(self) -> None:
        self.saved: dict[str, tuple[int, str, bytes]] = {}
        self.errors: list[str] = []
        self._lock = threading.Lock()

    def get(self, url: str, params: dict[str, str] | None = None, **kwargs: Any) -> requests.Response:
        try:
            response = _real_get(url, params=params, **kwargs)
        except Exception as exc:
            with self._lock:
                self.errors.append(f"{url}: {exc}")
            raise
        with self._lock:
            self.saved[strip_credentials(url)] = (
                response.status_code,
                response.headers.get("Content-Type", "application/octet-stream"),
                response.content,
            )
        return response


def _file_for(url: str) -> str:
    path = url.split("://", 1)[1]
    host, _, rest = path.partition("/")
    leaf = rest.strip("/").replace("/", "-") or "index"
    if "admit-one" in host:
        return f"admit-one/{leaf}.html"
    if "sensacine" in host:
        return f"sensacine/{leaf.removeprefix('_-showtimes-')}.json"
    return f"verdi/{leaf}.html"


def _choose_verdi_slugs(count: int) -> list[str]:
    """The first `count` cartellera films that have V.O. sessions (a few pages are fetched, none recorded)."""
    from providers.verdi_provider import VerdiProvider

    provider = VerdiProvider()
    chosen: list[str] = []
    for slug in provider._fetch_slugs():
        if provider._fetch_film(slug) is not None:
            chosen.append(slug)
        if len(chosen) == count:
            break
    return chosen


def record(films: int, theatres: list[str], days: int) -> Path:
    from providers import SensacineProvider, VerdiProvider
    from providers.common import MADRID_TZ, madrid_today
    from providers.sensacine_provider import _SENSACINE_IDS

    today = madrid_today()
    target = RECORDED / f"live-{today.isoformat()}"
    if target.exists():
        raise SystemExit(f"{target} exists; delete it to record again")

    case = {
        "description": "Live recording of the public sources: Verdi cartellera + film and admit-one seat pages, "
        "SensaCine theatre pages. The providers are narrowed to the recorded slugs/theatres/days.",
        "source": "tests/parity/record.py",
        "recordedAt": datetime.now(MADRID_TZ).isoformat(timespec="seconds"),
        "now": datetime.combine(today, time(10, 0), MADRID_TZ).isoformat(),
        "sensacine": {"ids": {key: _SENSACINE_IDS[key] for key in theatres}, "daysAhead": days},
        "verdi": {"slugs": _choose_verdi_slugs(films)},
    }
    cinemas = json.loads((ROOT / "cinemas.json").read_text(encoding="utf-8"))

    recorder = Recorder()
    requests.get = recorder.get  # type: ignore[assignment]
    try:
        with provider_overrides(case):
            for provider in (VerdiProvider(), SensacineProvider()):
                movies = provider.fetch(cinemas)
                print(
                    f"{provider.name}: {len(movies)} movie(s), {sum(len(m['showtimes']) for m in movies)} showtime(s)"
                )
    finally:
        requests.get = _real_get
    if recorder.errors:
        raise SystemExit("requests failed, nothing written:\n" + "\n".join(recorder.errors))

    manifest = []
    for url, (status, content_type, body) in sorted(recorder.saved.items()):
        file = _file_for(url)
        (target / file).parent.mkdir(parents=True, exist_ok=True)
        (target / file).write_bytes(body)
        manifest.append({"method": "GET", "url": url, "status": status, "contentType": content_type, "file": file})
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (target / "case.json").write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(len(body) for _, _, body in recorder.saved.values())
    print(f"recorded {len(manifest)} responses ({total / 1e6:.2f} MB) into {target}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--films", type=int, default=5, help="Verdi film pages to record")
    parser.add_argument("--theatres", default=",".join(DEFAULT_THEATRES), help="SensaCine cinema keys, comma-separated")
    parser.add_argument("--days", type=int, default=2, help="days from today per SensaCine theatre")
    args = parser.parse_args()
    record(args.films, args.theatres.split(","), args.days)


if __name__ == "__main__":
    main()
