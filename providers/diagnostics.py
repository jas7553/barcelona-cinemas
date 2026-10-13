"""
Classify a Provider fetch failure, and gather what tells "host down" or "host
blocking our egress IP" apart from an honest empty result. Never raises.
"""

from __future__ import annotations

import logging
import socket
from contextvars import ContextVar
from urllib.parse import urlsplit

import requests

from http_errors import http_status

logger = logging.getLogger(__name__)

_EGRESS_IP_URL = "https://checkip.amazonaws.com"
_EGRESS_IP_TIMEOUT = 3

_RETRYABLE_STATUSES = frozenset({403, 429})

_BODY_HEAD_CHARS = 300

# The page a Provider's listings hang off. A ContextVar so Providers fetching
# in parallel, each in its own context, don't see each other's.
_entry_response: ContextVar[requests.Response | None] = ContextVar("entry_response", default=None)


def is_retryable(exc: BaseException) -> bool:
    """
    Transient network failures and the statuses an overloaded or blocking host
    answers with (bot filters answer with 403). Parse errors fail the same way
    twice.
    """
    if isinstance(exc, requests.ConnectionError | requests.Timeout):
        return True
    if isinstance(exc, requests.HTTPError):
        status = http_status(exc)
        return status is not None and (status in _RETRYABLE_STATUSES or status >= 500)
    return False


def _target_host(exc: requests.RequestException) -> str | None:
    url = getattr(exc.request, "url", None) or getattr(exc.response, "url", None)
    if not isinstance(url, str):
        return None
    return urlsplit(url).hostname


def _resolve(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except Exception as exc:
        logger.warning("Could not resolve %s: %s", host, exc)
        return []
    return sorted({str(info[4][0]) for info in infos})


def egress_ip() -> str | None:
    try:
        resp = requests.get(_EGRESS_IP_URL, timeout=_EGRESS_IP_TIMEOUT)
        resp.raise_for_status()
        return resp.text.strip() or None
    except Exception as exc:
        logger.warning("Could not determine egress IP: %s", exc)
        return None


def failure_diagnostics(exc: BaseException) -> dict[str, object]:
    """Fields for a failure log event: HTTP status, target host + IPs, egress IP."""
    fields: dict[str, object] = {"http_status": http_status(exc)}
    if not isinstance(exc, requests.RequestException):
        return fields
    fields.update(_host_fields(_target_host(exc)))
    fields["egress_ip"] = egress_ip()
    return fields


def _host_fields(host: str | None) -> dict[str, object]:
    return {"host": host, "host_ips": _resolve(host) if host else []}


def record_entry_response(response: requests.Response) -> None:
    """Note the Provider's entry page (feed or index) for `zero_result_diagnostics`."""
    _entry_response.set(response)


def clear_entry_response() -> None:
    _entry_response.set(None)


def zero_result_diagnostics() -> dict[str, object]:
    """Fields for a zero-result log event: the entry page's status, host and opening text, plus the egress IP."""
    fields: dict[str, object] = {"egress_ip": egress_ip()}
    response = _entry_response.get()
    if response is None:
        return fields
    fields["http_status"] = response.status_code
    fields.update(_host_fields(urlsplit(response.url).hostname))
    fields["content_type"] = response.headers.get("Content-Type")
    fields["body_bytes"] = len(response.content)
    fields["body_head"] = " ".join(response.text[: _BODY_HEAD_CHARS * 2].split())[:_BODY_HEAD_CHARS]
    return fields
