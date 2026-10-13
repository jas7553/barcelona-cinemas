"""Helpers for inspecting HTTP client exceptions."""

from __future__ import annotations


def http_status(exc: BaseException) -> int | None:
    """The response status carried by an exception (e.g. `requests.HTTPError`), if any."""
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None
