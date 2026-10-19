"""cinemas.json neighbourhoods and the map's area labels spell each place one way."""

import json
import pathlib
import re
import unicodedata

_ROOT = pathlib.Path(__file__).parent.parent
_NEIGHBOURHOODS = sorted({c["neighborhood"] for c in json.loads((_ROOT / "cinemas.json").read_text()).values()})
_MAP_LABELS = re.findall(r'\["([^"]+)", [\d.]+, [\d.]+\]', (_ROOT / "src/domain/map.ts").read_text())


def _letters(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    return "".join(ch for ch in decomposed if ch.isalnum())


def test_map_labels_were_found() -> None:
    assert "Poblenou" in _MAP_LABELS


def test_a_map_label_inside_a_neighbourhood_name_is_spelled_the_same() -> None:
    # "Poble-Nou" in a list beside "Poblenou" on the map is the drift this catches.
    for label in _MAP_LABELS:
        for neighbourhood in _NEIGHBOURHOODS:
            if _letters(label) in _letters(neighbourhood):
                assert label in neighbourhood, f"map says {label!r}, cinemas.json says {neighbourhood!r}"


def test_neighbourhoods_drop_the_leading_article() -> None:
    # Official names start "el Raval", "la Vila de Gràcia"; the site writes "Raval".
    for neighbourhood in _NEIGHBOURHOODS:
        assert not re.match(r"(?:el|la|les|els) |l'", neighbourhood), neighbourhood
