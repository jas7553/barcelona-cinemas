"""
Orchestration layer: coordinates listing retrieval, enrichment, and caching.
app.py calls this module; it knows nothing about HTTP.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any, cast

import cache
import transform
from models import CinemaRegistry, Listings
from observability import emit_metric, get_context, log_event, now_ms
from refresh import build_listings

logger = logging.getLogger(__name__)

_CINEMAS_FILE = "cinemas.json"
_CACHE_TTL_HOURS = int(os.environ.get("CACHE_TTL_HOURS", 12))


def _s3() -> Any:
    import boto3  # type: ignore[import-untyped]

    return boto3.client("s3")


def _lambda() -> Any:
    import boto3

    return boto3.client("lambda")


_cinemas_cache: CinemaRegistry | None = None


def load_cinemas() -> CinemaRegistry:
    global _cinemas_cache
    if _cinemas_cache is None:
        with open(_CINEMAS_FILE) as f:
            _cinemas_cache = cast(CinemaRegistry, json.load(f))
        if not (isinstance(_cinemas_cache, dict) and _cinemas_cache):
            raise RuntimeError(f"{_CINEMAS_FILE} loaded empty or non-dict — registry is corrupted")
    return _cinemas_cache


def get_listings() -> Listings:
    """
    Return cached listings for public requests.

    User-facing requests never trigger a refresh. If the cache is older than the
    configured TTL, the payload is marked stale so the frontend can surface that
    state while the scheduled refresh path repopulates the cache.
    """
    cached = cache.read()
    if cached is None:
        raise RuntimeError("Listings cache unavailable")

    cache_age = cache.age_hours(cached)
    emit_metric("CacheAgeHours", cache_age, unit="None")
    if cache_age >= _CACHE_TTL_HOURS:
        return {**cached, "stale": True}
    return cached


def force_refresh() -> Listings:
    """Ignore TTL and always fetch fresh listings."""
    started_ms = now_ms()
    try:
        result = _refresh()
    except Exception:
        emit_metric("RefreshFailure", 1)
        raise

    duration_ms = round(now_ms() - started_ms, 2)
    emit_metric("RefreshSuccess", 1)
    emit_metric("RefreshDurationMs", duration_ms, unit="Milliseconds")
    emit_metric("CacheAgeHours", 0, unit="None")
    log_event("refresh_summary", trigger="schedule", duration_ms=duration_ms, success=True)
    _publish_static_site(result)
    return result


def _publish_static_site(listings: Listings) -> None:
    """Regenerate the static SSG site from fresh listings (Option A).

    Writes the public listings JSON to the frontend bucket, then asynchronously
    invokes the Node SSG renderer Lambda, which re-renders every page and
    invalidates CloudFront. No-ops in local dev (env vars absent) and swallows
    all exceptions so a publish failure never masks a successful refresh — the
    old static pages keep serving and the age-based "out of date" banner appears
    naturally (reproducing the old stale-while-revalidate behaviour).

    Because the failures are swallowed, `refresh_summary` still reports success
    when publishing dies. The `SsgPublishFailure`/`SsgInvokeFailure` metrics are
    the only signal that the site has silently stopped updating, so every exit
    path here emits one.
    """
    bucket = os.environ.get("FRONTEND_BUCKET")
    if not bucket:
        return

    try:
        public = transform.to_api_response(listings, load_cinemas())
        _s3().put_object(
            Bucket=bucket,
            Key="data/listings.json",
            Body=json.dumps(public).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache",
        )
        log_event("ssg_data_published", bucket=bucket, movies=len(public["movies"]))
    except Exception as exc:
        logger.warning("Failed to publish SSG data to frontend bucket", exc_info=True)
        _report_publish_failure("SsgPublishFailure", "ssg_publish_failure", exc, bucket=bucket)
        return

    function_name = os.environ.get("SSG_FUNCTION_NAME")
    if not function_name:
        return
    try:
        # Async (Event): the renderer regenerates pages + invalidates CloudFront
        # on its own; the refresh need not block on it. The refresh_id rides
        # along so the renderer's logs can be joined back to this refresh —
        # nothing else correlates the two log groups.
        _lambda().invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=json.dumps({"source": "refresh", "refresh_id": get_context().get("refresh_id")}).encode(),
        )
        log_event("ssg_render_invoked", function=function_name)
    except Exception as exc:
        logger.warning("Failed to invoke SSG renderer Lambda", exc_info=True)
        _report_publish_failure("SsgInvokeFailure", "ssg_invoke_failure", exc, function=function_name)


def _report_publish_failure(metric: str, event: str, exc: Exception, **fields: Any) -> None:
    """Pair every swallowed publish failure with a metric an alarm can watch."""
    emit_metric(metric, 1)
    log_event(event, level=logging.WARNING, exception_type=type(exc).__name__, **fields)


def _refresh() -> Listings:
    """
    The refresh's I/O half: read the cache, build fresh Listings, write it back.

    Everything between the two cache calls lives in `refresh.build_listings`,
    which owns the step order. The single cache read here feeds both the
    Providers (the Verdi Provider recovers its admit-one sala map from the
    previous run's Showtimes) and Enrichment's reuse of already-fetched TMDb
    metadata — so the read must happen before `all_providers`, and the write
    only after the build has returned.
    """
    from providers import all_providers  # noqa: PLC0415  — deferred: providers pull in requests

    cinemas = load_cinemas()
    cached = cache.read()

    listings, _stats = build_listings(all_providers(cached), cinemas, cached, datetime.now(UTC))

    cache.write(listings)
    return listings
