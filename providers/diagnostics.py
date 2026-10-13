"""
Classify a Provider fetch failure and gather what tells "host down" apart from
"host blocking our egress IP". Never raises.
"""

from __future__ import annotations

import logging
import socket
from urllib.parse import urlsplit

import requests

from http_errors import http_status

logger = logging.getLogger(__name__)

_EGRESS_IP_URL = "https://checkip.amazonaws.com"
_EGRESS_IP_TIMEOUT = 3

_RETRYABLE_STATUSES = frozenset({403, 429})


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
    host = _target_host(exc)
    fields["host"] = host
    fields["host_ips"] = _resolve(host) if host else []
    fields["egress_ip"] = egress_ip()
    return fields
