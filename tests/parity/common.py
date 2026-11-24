"""
Shared plumbing for the parity tooling: the recorded-HTTP format, a fake HTTP
layer that serves it, a frozen clock, and deterministic JSON output.

A recording set is a directory holding `manifest.json` (an array of
`{method, url, status, contentType, file}`) plus the body files it names.
"""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "app" / "pipeline" / "fixtures"
RECORDED = FIXTURES / "recorded"
GOLDENS = FIXTURES / "goldens"

# Query parameters that carry a credential; they are never stored or matched.
_CREDENTIAL_PARAMS = frozenset({"api_key", "apikey", "token", "access_token", "key"})


class RecordingGap(BaseException):
    """
    A request no recording answers. A BaseException so the providers'
    `except Exception` handlers cannot swallow it: a gap must fail the run.
    """


def strip_credentials(url: str) -> str:
    """`url` without credential query parameters, the rest left exactly as it was."""
    base, sep, query = url.partition("?")
    if not sep:
        return url
    kept = [pair for pair in query.split("&") if pair.split("=", 1)[0].lower() not in _CREDENTIAL_PARAMS]
    return f"{base}?{'&'.join(kept)}" if kept else base


def request_url(url: str, params: dict[str, str] | None) -> str:
    """The URL `requests` would send for `url` + `params`, minus credentials."""
    prepared = requests.Request("GET", url, params=params).prepare()
    assert prepared.url is not None
    return strip_credentials(prepared.url)


def dump_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_json(value), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class Recording:
    """A recording set served as a fake HTTP layer; logs every URL requested."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        manifest_path = directory / "manifest.json"
        entries = read_json(manifest_path) if manifest_path.exists() else []
        self._entries: dict[str, dict[str, Any]] = {}
        for entry in entries:
            if entry["method"] != "GET":
                raise ValueError(f"{directory}: only GET is supported, got {entry['method']}")
            self._entries[entry["url"]] = entry
        self.requested: list[str] = []

    def _respond(self, url: str) -> requests.Response:
        self.requested.append(url)
        entry = self._entries.get(url)
        if entry is None:
            raise RecordingGap(f"no recording for GET {url} in {self.directory}")
        response = requests.Response()
        response.status_code = entry["status"]
        response._content = (self.directory / entry["file"]).read_bytes()
        response.url = url
        response.headers["Content-Type"] = entry["contentType"]
        response.encoding = requests.utils.get_encoding_from_headers(response.headers)
        response.reason = "OK" if entry["status"] < 400 else "Error"
        return response

    def get(self, url: str, params: dict[str, str] | None = None, **_: object) -> requests.Response:
        return self._respond(request_url(url, params))

    @contextmanager
    def serving(self) -> Iterator[Recording]:

        def session_get(_session: requests.Session, url: str, **kwargs: Any) -> requests.Response:
            return self.get(url, **kwargs)

        with patch.object(requests, "get", self.get), patch.object(requests.Session, "get", session_get):
            yield self


def _frozen_datetime(instant: datetime) -> type[datetime]:
    class Frozen(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:
            return instant.astimezone(tz) if tz else instant.astimezone(UTC).replace(tzinfo=None)

    return Frozen


@contextmanager
def frozen_clock(now: str) -> Iterator[None]:
    """
    Freeze every clock the pipeline reads: `providers.common` (Madrid "today",
    used by the providers and the enricher) and `enricher` (`enriched_at`, TTL).
    """
    import enricher
    import providers.common

    frozen = _frozen_datetime(datetime.fromisoformat(now))
    with patch.object(providers.common, "datetime", frozen), patch.object(enricher, "datetime", frozen):
        yield


class EventLog(logging.Handler):
    """The structured `log_event` payloads emitted while attached to the "observability" logger."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            payload = json.loads(record.getMessage())
        except ValueError:
            return
        if isinstance(payload, dict) and "event" in payload:
            payload.pop("environment", None)
            self.events.append(payload)

    @contextmanager
    def capturing(self) -> Iterator[EventLog]:
        logger = logging.getLogger("observability")
        previous = logger.level
        logger.setLevel(logging.INFO)
        logger.addHandler(self)
        try:
            yield self
        finally:
            logger.removeHandler(self)
            logger.setLevel(previous)


def error_payload(exc: BaseException) -> dict[str, str]:
    return {"type": type(exc).__name__, "message": str(exc)}
