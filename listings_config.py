"""Helpers for runtime-resolved configuration values."""

import os
from typing import Any, cast

_cached_listings_feed_url: str | None = None


def listings_feed_url() -> str:
    """Return the configured listings feed URL."""
    global _cached_listings_feed_url
    if _cached_listings_feed_url:
        return _cached_listings_feed_url

    url = os.environ.get("LISTINGS_FEED_URL", "").strip()
    if url:
        _cached_listings_feed_url = url
        return url

    param_name = os.environ.get("LISTINGS_FEED_SSM_PARAMETER", "").strip()
    if not param_name:
        raise OSError("Neither LISTINGS_FEED_URL nor LISTINGS_FEED_SSM_PARAMETER is set")

    import boto3  # type: ignore[import-untyped]  # imported lazily for local dev

    ssm: Any = boto3.client("ssm")
    response = ssm.get_parameter(Name=param_name, WithDecryption=True)
    parameter = cast(dict[str, Any], response.get("Parameter", {}))
    url = cast(str, parameter.get("Value", ""))
    if not url:
        raise OSError(f"Listings feed SSM parameter {param_name!r} did not contain a value")

    _cached_listings_feed_url = url
    return url
