from __future__ import annotations

from typing import Protocol

from models import CinemaRegistry, Listings, Movie
from providers.listings_provider import ListingsProvider as ListingsProvider
from providers.secondary_provider import SecondaryProvider as SecondaryProvider
from providers.sensacine_provider import SensacineProvider as SensacineProvider
from providers.verdi_provider import VerdiProvider as VerdiProvider
from providers.verdi_provider import sala_map_from_cache


class ListingsSource(Protocol):
    name: str

    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]: ...


def all_providers(cached: Listings | None) -> list[ListingsSource]:
    """
    Build every Provider for one refresh.

    `cached` is the previous refresh's Listings — required, not optional,
    because the Verdi Provider reads behind on it for its admit-one sala map.
    Pass None for a cold cache; passing it explicitly is what keeps that
    dependency from silently disappearing.
    """
    return [
        ListingsProvider(),
        SecondaryProvider(),
        VerdiProvider(sala_map=sala_map_from_cache(cached)),
        SensacineProvider(),
    ]
