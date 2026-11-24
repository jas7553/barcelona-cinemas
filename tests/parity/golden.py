"""
Regenerate the Python goldens the TypeScript port is checked against.

    python tests/parity/golden.py [--out DIR]

Reads every recording set under app/pipeline/fixtures/recorded/, serves it as
the HTTP layer with the clock frozen, runs the legacy Python code, and writes
`goldens/` (and a snapshot of cinemas.json, the registry the goldens used)
under DIR (default app/pipeline/fixtures). Running it twice writes identical
bytes. See app/pipeline/fixtures/recorded/inline/README.md for the layout.
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import os
import shutil
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import patch

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.parity.common import (  # noqa: E402
    FIXTURES,
    RECORDED,
    EventLog,
    Recording,
    error_payload,
    frozen_clock,
    read_json,
    write_json,
)

ROOT = Path(__file__).resolve().parents[2]

PROVIDERS = ("english_cinema_bcn", "secondary", "verdi", "sensacine")

# Stand-ins for the secrets the real providers read; neither value is stored in a recording.
_ENV = {"TMDB_API_KEY": "parity-test-key"}


@contextmanager
def _environment(config: dict[str, str]) -> Iterator[None]:
    import listings_config

    env = {**_ENV, **config}
    with patch.dict(os.environ, env):
        listings_config._resolved_cache.clear()
        try:
            yield
        finally:
            listings_config._resolved_cache.clear()


def _provider_config(case: dict[str, Any]) -> dict[str, str]:
    config = case.get("config", {})
    env = {}
    if "listingsFeedUrl" in config:
        env["LISTINGS_FEED_URL"] = config["listingsFeedUrl"]
    if "secondaryListingsUrl" in config:
        env["SECONDARY_LISTINGS_URL"] = config["secondaryListingsUrl"]
    return env


@contextmanager
def provider_overrides(case: dict[str, Any]) -> Iterator[None]:
    """
    The case's narrowing of what the provider visits: SensaCine's theatres and
    days, Verdi's film slugs. Without them a provider asks for every page it
    knows of, and a small recording could not answer.
    """
    from providers import sensacine_provider
    from providers.verdi_provider import VerdiProvider

    patches = []
    if "sensacine" in case:
        patches.append(patch.object(sensacine_provider, "_SENSACINE_IDS", case["sensacine"]["ids"]))
        patches.append(patch.object(sensacine_provider, "_DAYS_AHEAD", case["sensacine"]["daysAhead"]))
    if "verdi" in case:
        wanted = case["verdi"]["slugs"]
        fetch_slugs = VerdiProvider._fetch_slugs

        def limited(self: VerdiProvider) -> list[str]:
            return [slug for slug in fetch_slugs(self) if slug in wanted]

        patches.append(patch.object(VerdiProvider, "_fetch_slugs", limited))
    for p in patches:
        p.start()
    try:
        yield
    finally:
        for p in reversed(patches):
            p.stop()


def _make_provider(name: str, case: dict[str, Any]) -> Any:
    from providers import ListingsProvider, SecondaryProvider, SensacineProvider, VerdiProvider

    if name == "verdi":
        return VerdiProvider(sala_map=case.get("salaMap"))
    return {"english_cinema_bcn": ListingsProvider, "secondary": SecondaryProvider, "sensacine": SensacineProvider}[
        name
    ]()


def fetch_provider(name: str, directory: Path, case: dict[str, Any], cinemas: dict[str, Any]) -> dict[str, Any]:
    """One provider's fetch over one recording: its movies or the error it raised, the requests made, the events."""
    recording = Recording(directory)
    events = EventLog()
    movies: list[Any] | None = None
    error: dict[str, str] | None = None
    with (
        _environment(_provider_config(case)),
        frozen_clock(case["now"]),
        provider_overrides(case),
        recording.serving(),
        events.capturing(),
    ):
        try:
            movies = _make_provider(name, case).fetch(copy.deepcopy(cinemas))
        except Exception as exc:
            error = error_payload(exc)
    return {
        "result": movies,
        "error": error,
        # Parallel fetches finish in any order; the set of requests is what matters.
        "requests": sorted(recording.requested),
        "events": events.events,
    }


def reconcile_movies(movies: list[Any], stage: str | None) -> tuple[list[Any], list[dict[str, Any]]]:
    from reconcile import reconcile

    events = EventLog()
    with events.capturing():
        merged = reconcile(copy.deepcopy(movies), stage=stage)
    return merged, events.events


def enrich_case(directory: Path, case: dict[str, Any]) -> dict[str, Any]:
    import enricher

    movies = case["movies"]
    events = EventLog()
    recording = Recording(directory)
    collected = None
    with _environment({}), frozen_clock(case["now"]), recording.serving(), events.capturing():
        if case.get("reconcileFirst"):
            movies, _ = reconcile_movies(movies, "collection")
            collected = movies
        enriched, stats = enricher.enrich(copy.deepcopy(movies), copy.deepcopy(case.get("cached", [])))
        reconciled, _ = reconcile_movies(enriched, "post_enrichment")
    return {
        "collected": collected,
        "enriched": enriched,
        "reconciled": reconciled,
        "stats": stats,
        "requests": recording.requested,  # sequential, so the order is part of the behavior
        "events": events.events,
    }


def rank_case(case: dict[str, Any]) -> dict[str, Any]:
    import enricher

    today = date.fromisoformat(case["today"])
    out: dict[str, Any] = {}
    if "results" in case:
        first_run, ordered = enricher._rank_candidates(
            case["title"], case["results"], year=case.get("year"), today=today
        )
        out["firstRun"] = [r["id"] for r in first_run]
        out["ordered"] = [r["id"] for r in ordered]
    if "details" in case:
        out["inSpanishFirstRun"] = [enricher._in_spanish_first_run(d, today) for d in case["details"]]
    return out


def _matches(enriched: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "title": movie["title"],
            "tmdb_id": movie.get("tmdb_id"),
            "english_title": movie.get("english_title"),
            "imdb_id": movie.get("imdb_id"),
            "year": movie.get("year"),
        }
        for movie in enriched
    ]


def _inline_goldens(cinemas: dict[str, Any]) -> Iterator[tuple[str, Any]]:
    inline = RECORDED / "inline"
    tmdb_matches: dict[str, Any] = {}
    for kind_dir in sorted(p for p in inline.iterdir() if p.is_dir()):
        kind = kind_dir.name
        for case_dir in sorted(p for p in kind_dir.iterdir() if p.is_dir()):
            case = read_json(case_dir / "case.json")
            if kind in PROVIDERS:
                golden: Any = fetch_provider(kind, case_dir, case, cinemas)
            elif kind == "reconcile":
                merged, events = reconcile_movies(case["movies"], case.get("stage"))
                golden = {"result": merged, "events": events}
            elif kind == "tmdb":
                golden = enrich_case(case_dir, case)
                tmdb_matches[case_dir.name] = _matches(golden["enriched"])
            elif kind == "tmdb-rank":
                golden = rank_case(case)
            else:
                raise ValueError(f"unknown inline kind {kind!r} in {case_dir}")
            yield f"inline/{kind}/{case_dir.name}.json", golden
    yield "inline/tmdb-matches.json", tmdb_matches


def _live_goldens(cinemas: dict[str, Any]) -> Iterator[tuple[str, Any]]:
    for set_dir in sorted(RECORDED.glob("live-*")):
        case = read_json(set_dir / "case.json")
        name = set_dir.name
        # Every provider recorded here shares the one manifest; each fetch asks only for its own pages.
        per_provider = {}
        for provider in ("verdi", "sensacine"):
            fetched = fetch_provider(provider, set_dir, case, cinemas)
            if fetched["error"]:
                raise RuntimeError(f"{name}: {provider} failed: {fetched['error']}")
            per_provider[provider] = fetched["result"]
            yield f"{name}/{provider}.json", fetched["result"]
        collected, _ = reconcile_movies([*per_provider["verdi"], *per_provider["sensacine"]], "collection")
        yield f"{name}/reconciled.json", collected


def generate(out_root: Path) -> None:
    """Write `goldens/` and the cinemas.json snapshot under `out_root`."""
    logging.getLogger().addHandler(logging.NullHandler())  # providers warn; keep the run quiet
    cinemas = json.loads((ROOT / "cinemas.json").read_text(encoding="utf-8"))
    goldens = out_root / "goldens"
    if goldens.exists():
        shutil.rmtree(goldens)
    for relative, golden in (*_inline_goldens(cinemas), *_live_goldens(cinemas)):
        write_json(goldens / relative, golden)
    shutil.copyfile(ROOT / "cinemas.json", out_root / "cinemas.json")  # verbatim: key order is behavior


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=FIXTURES, help="directory to write goldens/ into")
    generate(parser.parse_args().out)


if __name__ == "__main__":
    main()
