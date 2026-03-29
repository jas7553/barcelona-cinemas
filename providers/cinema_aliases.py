from __future__ import annotations

import re
from collections.abc import Iterable

from models import CinemaInfo, CinemaRegistry


def normalize_alias(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def iter_cinema_aliases(info: CinemaInfo, source: str) -> Iterable[str]:
    yield info["name"]
    yield info["id"]
    yield from info.get("aliases", {}).get(source, [])


def build_cinema_alias_lookup(cinemas: CinemaRegistry, source: str) -> dict[str, str]:
    alias_lookup: dict[str, str] = {}
    for cinema_key, info in cinemas.items():
        for alias in iter_cinema_aliases(info, source):
            normalized = normalize_alias(alias)
            if normalized:
                alias_lookup[normalized] = cinema_key
    return alias_lookup
