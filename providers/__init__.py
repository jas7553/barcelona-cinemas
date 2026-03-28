from typing import Protocol

from models import CinemaRegistry, Movie


class Provider(Protocol):
    def fetch(self, cinemas: CinemaRegistry) -> list[Movie]: ...


def get_providers() -> list[Provider]:
    """Ordered list of providers. First success wins."""
    from providers.listings_provider import ListingsProvider

    return [ListingsProvider()]
