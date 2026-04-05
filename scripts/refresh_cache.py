#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _require_env(name: str) -> str:
    import os

    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


def main() -> int:
    import pipeline

    load_dotenv()

    try:
        _require_env("LISTINGS_FEED_URL")
    except RuntimeError as exc:
        print(f"Cannot refresh cache: {exc}. Set it in your shell or .env.", file=sys.stderr)
        return 1

    try:
        _require_env("TMDB_API_KEY")
    except RuntimeError as exc:
        print(
            "TMDb enrichment is disabled because "
            f"{exc}. Set it in your shell or .env if you want posters and metadata.",
            file=sys.stderr,
        )
        return 1

    result = pipeline.force_refresh()
    poster_count = sum(1 for movie in result["movies"] if movie.get("poster_url"))

    print("refreshed at:", result["fetched_at"])
    print("movies:", len(result["movies"]))
    print("with posters:", poster_count)

    if poster_count == 0:
        print(
            "Refresh completed, but no poster URLs were returned. Double-check your TMDB_API_KEY "
            "and the upstream movie titles.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
