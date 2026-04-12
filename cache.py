"""
Cache for movie listings. Supports two backends:

  file (default): reads/writes CACHE_DIR/listings.json (env default: ./cache/).
  s3:             reads/writes S3_BUCKET/S3_KEY using boto3.

Set CACHE_BACKEND=s3 plus S3_BUCKET (and optionally S3_KEY) to use S3.
No other files need to change when switching backends.
"""

import json
import math
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from models import Listings
from observability import log_event
from validation import normalize_listings

_CACHE_BACKEND = os.environ.get("CACHE_BACKEND", "file")

# --- file backend config ---
_CACHE_DIR = Path(os.environ.get("CACHE_DIR", "./cache"))
_CACHE_FILE = _CACHE_DIR / "listings.json"

# --- s3 backend config ---
_S3_BUCKET = os.environ.get("S3_BUCKET", "")
_S3_KEY = os.environ.get("S3_KEY", "listings.json")


class _FileBackend:
    def __init__(self, cache_dir: Path, cache_file: Path) -> None:
        self._cache_dir = cache_dir
        self._cache_file = cache_file

    def read(self) -> Listings | None:
        try:
            with self._cache_file.open() as f:
                listings = normalize_listings(json.load(f), source="file cache")
                if listings is None:
                    log_event("cache_invalid", backend="file", path=str(self._cache_file))
                    return None
                return listings
        except FileNotFoundError:
            log_event("cache_missing", backend="file", path=str(self._cache_file))
            return None
        except Exception as exc:
            log_event(
                "cache_read_failure",
                backend="file",
                path=str(self._cache_file),
                exception_type=type(exc).__name__,
            )
            return None

    def write(self, listings: Listings) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        with self._cache_file.open("w") as f:
            json.dump(listings, f, indent=2, ensure_ascii=False)


def _is_s3_missing(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    error = response.get("Error", {}) if isinstance(response, dict) else {}
    return error.get("Code") in {"NoSuchKey", "404"}


class _S3Backend:
    def __init__(self, client: Any, bucket: str, key: str) -> None:
        self._client = client
        self._bucket = bucket
        self._key = key

    def read(self) -> Listings | None:
        try:
            body = self._client.get_object(Bucket=self._bucket, Key=self._key)["Body"].read()
            listings = normalize_listings(json.loads(body), source="S3 cache")
            if listings is None:
                log_event("cache_invalid", backend="s3", bucket=self._bucket, key=self._key)
                return None
            return listings
        except Exception as exc:
            if _is_s3_missing(exc):
                log_event("cache_missing", backend="s3", bucket=self._bucket, key=self._key)
                return None
            log_event(
                "cache_read_failure",
                backend="s3",
                bucket=self._bucket,
                key=self._key,
                exception_type=type(exc).__name__,
            )
            return None

    def write(self, listings: Listings) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=self._key,
            Body=json.dumps(listings, ensure_ascii=False).encode(),
            ContentType="application/json",
        )


# Select the backend once at module load. Tests can monkeypatch `_backend`
# directly to redirect reads/writes without touching the file system.
if _CACHE_BACKEND == "s3":
    import boto3  # type: ignore[import-untyped]

    # Eagerly create the S3 client so boto3's import cost and the initial
    # TCP/TLS handshake are paid during Lambda Init, not on the first handler
    # invocation. The singleton is reused across all warm invocations.
    _backend: _FileBackend | _S3Backend = _S3Backend(boto3.client("s3"), _S3_BUCKET, _S3_KEY)
else:
    _backend = _FileBackend(_CACHE_DIR, _CACHE_FILE)


def read() -> Listings | None:
    """Return cached listings, or None if the cache does not exist."""
    return _backend.read()


def write(listings: Listings) -> None:
    """Write listings to the cache."""
    _backend.write(listings)


def age_hours(cached: Listings | None = None) -> float:
    """
    Return the age of the cache in hours.
    Returns math.inf if the cache does not exist or has no fetched_at field.
    """
    if cached is None:
        cached = read()
    if cached is None:
        return math.inf
    fetched_at_str = cached.get("fetched_at")
    if not fetched_at_str:
        return math.inf
    try:
        fetched_at = datetime.fromisoformat(fetched_at_str)
        now = datetime.now(UTC)
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=UTC)
        return (now - fetched_at).total_seconds() / 3600
    except ValueError:
        return math.inf
