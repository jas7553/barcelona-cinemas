"""
Write the public listings JSON the SSG renderer consumes.

Reuses transform.to_api_response (the same internal→public mapping the retired
/api/listings route used) so the Node renderer never duplicates that logic.

Local use:   python3 scripts/export_listings.py   (reads ./cache/listings.json)
Production:  the refresh Lambda calls export_public_listings() after writing the
            cache, uploads the result to the frontend bucket, then invokes the
            Node SSG renderer.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache  # noqa: E402
import pipeline  # noqa: E402
import transform  # noqa: E402


def export_public_listings() -> dict[str, Any]:
    """Read the cache and return the public API-shape listings dict."""
    listings = cache.read()
    if listings is None:
        raise SystemExit("No cache to export — run a refresh first.")
    return transform.to_api_response(listings, pipeline.load_cinemas())


def main() -> None:
    public = export_public_listings()
    out_path = os.path.join("static", "data", "listings.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(public, f)
    print(f"Wrote {out_path}: {len(public['movies'])} movies, {len(public['theaters'])} theaters")


if __name__ == "__main__":
    main()
