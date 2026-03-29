from __future__ import annotations

from typing import Protocol

from models import CinemaRegistry, Movie
from providers.listings_provider import ListingsProvider as ListingsProvider
from providers.secondary_provider import SecondaryProvider as SecondaryProvider


class ListingsSource(Protocol):
    name: str

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]: ...


def all_providers() -> list[ListingsSource]:
    return [ListingsProvider(), SecondaryProvider()]
